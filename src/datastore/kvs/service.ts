import type {IDBPDatabase} from "idb";
import {openDB} from "idb";

import type {Event} from "../../util/event.js";
import event from "../../util/event.js";
import {AsyncTaskQueue} from "../../util/index.js";
import type {NanoService} from "../../util/nanoservice/index.js";
import type {KeyValueStore} from "./index.js";
import {genericList} from "./index.js";
import type * as Proto from "./proto.js";

export default class Service<K extends Proto.Key, V extends Proto.Value>
  implements
    KeyValueStore<K, V>,
    NanoService<Proto.ClientMsg<K, V>, Proto.ServiceMsg<K, V>>
{
  /* c8 ignore start -- opens a live IndexedDB, usable only in prod */
  static async open<K extends Proto.Key, V extends Proto.Value>(
    db_name: string,
    store_name: string,
  ): Promise<Service<K, V>> {
    // Magical incantation to make sure the browser doesn't spontaneously
    // delete our store.
    if (!(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }

    return new Service(
      await openDB(db_name, 1, {
        upgrade(db, oldVersion, newVersion, txn) {
          db.createObjectStore(store_name);
        },
      }),
      store_name,
    );
  }
  /* c8 ignore stop */

  readonly name: string;

  readonly onSet: Event<(entries: Proto.MaybeEntry<K, V>[]) => void>;
  readonly onSyncLost: Event<() => void>;

  private _db: IDBPDatabase;
  private _clients = new Set<Proto.ClientPort<K, V>>();

  /** We queue all write operations to the DB to avoid weirdnesses that seem to
   * happen with IndexedDB and concurrent transactions. */
  private _write_queue = new AsyncTaskQueue();

  constructor(db: IDBPDatabase, store_name: string) {
    this.name = store_name;
    this.onSet = event("KVS.Service.onSet", this.name);
    this.onSyncLost = event("KVS.Service.onSyncLost", this.name);
    this._db = db;
  }

  //
  // KeyValueStore implementation
  //

  async get(keys: K[]): Promise<Proto.Entry<K, V>[]> {
    const txn = this._db.transaction(this.name);
    const res: Proto.Entry<K, V>[] = [];
    for (const key of keys) {
      const value = await txn.store.get(key);
      if (value) res.push({key, value});
    }
    return res;
  }

  async getStartingFrom(
    bound: K | undefined,
    limit: number,
  ): Promise<Proto.Entry<K, V>[]> {
    const b =
      bound !== undefined ? IDBKeyRange.lowerBound(bound, true) : undefined;

    const txn = this._db.transaction(this.name);
    let cursor = await txn.store.openCursor(b);

    const res: Proto.Entry<K, V>[] = [];
    while (cursor && limit > 0) {
      // Cast needed because IDB keys can be non-JSON-serializable types,
      // but we shouldn't have any of those here (if the DB was only ever
      // interacted with using KVS, which precludes such keys).
      res.push({key: cursor.primaryKey as K, value: cursor.value});
      --limit;
      cursor = await cursor.continue();
    }
    await txn.done;
    return res;
  }

  async getEndingAt(
    bound: K | undefined,
    limit: number,
  ): Promise<Proto.Entry<K, V>[]> {
    const b =
      bound !== undefined ? IDBKeyRange.upperBound(bound, true) : undefined;

    const txn = this._db.transaction(this.name);
    let cursor = await txn.store.openCursor(b, "prev");

    const res: Proto.Entry<K, V>[] = [];
    while (cursor && limit > 0) {
      // Cast needed because IDB keys can be non-JSON-serializable types,
      // but we shouldn't have any of those here (if the DB was only ever
      // interacted with using KVS, which precludes such keys).
      res.push({key: cursor.primaryKey as K, value: cursor.value});
      --limit;
      cursor = await cursor.continue();
    }
    await txn.done;
    return res;
  }

  list(): AsyncIterable<Proto.Entry<K, V>> {
    return genericList((bound, limit) => this.getStartingFrom(bound, limit));
  }

  listReverse(): AsyncIterable<Proto.Entry<K, V>> {
    return genericList((bound, limit) => this.getEndingAt(bound, limit));
  }

  set(entries: Proto.MaybeEntry<K, V>[]): Promise<void> {
    return this._write_queue.run(async () => {
      /* c8 ignore next -- it's silly to set() with 0 entries */
      if (entries.length === 0) return;

      const txn = this._db.transaction(this.name, "readwrite");
      for (const {key, value} of entries) {
        if (value !== undefined) await txn.store.put(value, key);
        else await txn.store.delete(key);
      }
      await txn.done;

      this._broadcast({$type: "set", entries});
      this.onSet.send(entries);
    });
  }

  async deleteAll(): Promise<void> {
    // We delete in batches of 100 so as to report incremental progress to
    // any clients that might be listening (and avoid sending any one
    // message that's too big).
    while (true) {
      const deletes: {key: K}[] = [];

      await this._write_queue.run(async () => {
        const txn = this._db.transaction(this.name, "readwrite");
        let cursor = await txn.store.openCursor();

        while (cursor) {
          // Same cast as in set() above
          deletes.push({key: cursor.primaryKey as K});
          cursor.delete();
          cursor = await cursor.continue();
          if (deletes.length > 100) break;
        }
        await txn.done;
      });

      if (deletes.length > 0) {
        this._broadcast({$type: "set", entries: deletes});
        this.onSet.send(deletes);
      } else {
        break; // No more keys to delete
      }
    }
  }

  //
  // NanoService implementation (for remote KVS service)
  //

  onConnect(port: Proto.ClientPort<K, V>) {
    this._clients.add(port);
  }

  onDisconnect(port: Proto.ClientPort<K, V>) {
    this._clients.delete(port);
  }

  async onRequest(
    port: Proto.ClientPort<K, V>,
    msg: Proto.ClientMsg<K, V>,
  ): Promise<Proto.ServiceMsg<K, V>> {
    switch (msg?.$type) {
      case "get":
        return {
          $type: "entries",
          entries: await this.get(msg.keys),
        };
      case "getStartingFrom":
        return {
          $type: "entries",
          entries: await this.getStartingFrom(msg.bound, msg.limit),
        };
      case "getEndingAt":
        return {
          $type: "entries",
          entries: await this.getEndingAt(msg.bound, msg.limit),
        };
      case "set":
        await this.set(msg.entries);
        return null;
      case "deleteAll":
        await this.deleteAll();
        return null;
      default:
        return null;
    }
  }

  private _broadcast(msg: Proto.ServiceMsg<K, V>) {
    for (const c of this._clients) c.notify(msg);
  }
}

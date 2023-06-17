import {reactive} from "vue";
import type {Events} from "webextension-polyfill";

import {batchesOf, later} from "../../util";
import {logErrorsFrom} from "../../util/oops";

import Client from "./client";
import type {Entry, Key, MaybeEntry, Value} from "./proto";
import Service from "./service";

export {Client, Service};
export type {Entry, Key, MaybeEntry, Value};

export interface KeyValueStore<K extends Key, V extends Value> {
  readonly name: string;

  /** Fired whenever entries in the KVS are inserted, updated, or deleted,
   * either by this KeyValueStore or another user of the same KVS.  Entries
   * are provided in the same format in which they are passed to `set()`--that
   * is, an entry with a `.key` but not a `.value` was deleted. */
  readonly onSet: Events.Event<(entries: MaybeEntry<K, V>[]) => void>;

  /** Fired by a KVS client whenever it determines that it may have dropped an
   * event (e.g. if the service was disconnected for some reason).
   * (Reconnection is handled automatically by the client.) */
  readonly onSyncLost: Events.Event<() => void>;

  get(keys: K[]): Promise<Entry<K, V>[]>;
  getStartingFrom(bound: K | undefined, limit: number): Promise<Entry<K, V>[]>;
  getEndingAt(bound: K | undefined, limit: number): Promise<Entry<K, V>[]>;

  list(): AsyncIterable<Entry<K, V>>;
  listReverse(): AsyncIterable<Entry<K, V>>;

  /** Set (or delete) entries in the KVS.  To set an entry, pass it as a
   * `{key, value}` pair.  To delete an entry, pass just the `{key}` without a
   * `.value` property. */
  set(entries: MaybeEntry<K, V>[]): Promise<void>;

  deleteAll(): Promise<void>;
}

/** Provides lazy-update/caching semantics for KeyValueStore in a manner that's
 * friendly to Vue, by wrapping a KeyValueStore and keeping a cache of entries
 * in memory.
 *
 * The semantics of the KVSCache are optimized for minimum latency at the
 * expense of consistency, for use with Vue models/components.  This means:
 *
 * - There are no async methods.
 * - get() may return stale data (or an empty entry which is spontaneously
 *   filled in later), and the object returned by get() is Vue-reactive.
 * - set() may not take effect for some time, or at all, if another update is
 *   received before the background flush can be done.
 * - There is no delete() or list operations; use the regular KeyValueStore
 *   interface if you need those.
 * - If background I/O fails, dirty entries are dropped, and stale entries will
 *   remain stale.  At present there is no way to recover from this.
 */
export class KVSCache<K extends Key, V extends Value> {
  /** The underlying KVS which is backing the KVSCache.  If is perfectly fine
   * to do calls directly against ths KVS if you need to do something not
   * supported by the KVSCache, however some inconsistency with the cache may
   * result. */
  readonly kvs: KeyValueStore<K, V>;

  private readonly _entries = new Map<K, MaybeEntry<K, V>>();
  private _needs_flush = new Map<K, Entry<K, V>>();
  private _needs_fetch = new Map<K, MaybeEntry<K, V>>();

  private _pending_io: Promise<void> | null = null;
  private _crash_count: number = 0;

  constructor(kvs: KeyValueStore<K, V>) {
    this.kvs = kvs;

    this.kvs.onSet.addListener(entries => {
      for (const e of entries) this._update(e.key, e.value);
    });
    this.kvs.onSyncLost.addListener(() => {
      // If we missed any events from the KVS, we need to re-fetch
      // everything we're currently tracking because we don't know what's
      // changed in the meantime.
      for (const [k, v] of this._entries) {
        v.value = undefined; // In case the item was deleted
        this._needs_fetch.set(k, v);
      }
      this._io();
    });
  }

  /** Returns an entry from the KVS.  If the entry isn't in cache yet (or
   * isn't in the KVS at all), the entry's value will be `null` and the entry
   * will be fetched in the background.  The returned entry is reactive, so it
   * will be updated once the value is available. */
  get(key: K): MaybeEntry<K, V> {
    let e = this._entries.get(key);
    if (!e) {
      e = reactive({key, value: undefined}) as MaybeEntry<K, V>;
      this._entries.set(key, e);
      this._needs_fetch.set(key, e);
      this._io();
    }
    return e;
  }

  /** Returns an entry from the KVS, but only if it already
   * exists in the store. */
  getIfExists(key: K): MaybeEntry<K, V> | undefined {
    return this._entries.get(key);
  }

  /** Updates an entry in the KVS.  The cache is updated immediately, but
   * entries will be flushed in the background. */
  set(key: K, value: V): MaybeEntry<K, V> {
    const ent = this.get(key);
    ent.value = value;
    this._needs_flush.set(key, ent as Entry<K, V>);
    this._needs_fetch.delete(key);
    this._io();
    return ent;
  }

  /** Merges an entry in the KVS by fetching the item if it's not present in
   * the cache already, calling merge() with the old value, and setting the
   * result back into the cache.
   *
   * Note that the returned cache entry may be stale--if the entry wasn't
   * present in the cache previously, it will be fetched and merged in the
   * background.
   *
   * Also note that no attempt is made to ensure any kind of consistency--in
   * particular, merge() itself may still be called with stale data, there
   * could be multiple pending merges for the same entry, etc.  In general,
   * this should not be a problem IF merge() is idempotent--eventually the
   * cache should converge on the "right" value. */
  merge<U extends (v: V | undefined) => V>(key: K, merge: U): MaybeEntry<K, V> {
    const ent = this.get(key);

    const doMerge = () => {
      ent.value = merge(ent.value);
      this._needs_flush.set(key, ent as Entry<K, V>);
      this._needs_fetch.delete(key);
      this._io();
    };

    if (ent.value !== undefined) {
      doMerge();
    } else {
      this._needs_fetch.set(key, ent);
      this._io().then(doMerge);
    }

    return ent;
  }

  /** If `key` is not present in the KVS, adds `key` with `value`.  But if key
   * is already present, does nothing--that is, the `value` provided here will
   * not override any pre-existing value.
   *
   * If the value isn't loaded yet, the returned entry may momentarily appear
   * to have the provided value.
   *
   * Note that this is inherently racy; it's possible that in some situations,
   * maybeInsert() will still overwrite another recently-written value. */
  maybeInsert(key: K, value: V): MaybeEntry<K, V> {
    const ent = this.get(key);
    if (ent.value !== undefined) return ent;

    ent.value = value;

    // This works because we always fetch entries before flushing them, and
    // fetched entries always override flushes.  If the entry is not present
    // on the service, it will remain in _needs_flush until the flush phase
    // of _io().
    this._needs_fetch.set(key, ent);
    this._needs_flush.set(key, ent as Entry<K, V>);
    this._io();
    return ent;
  }

  /** Returns a promise that resolves once the cache has performed all pending
   * I/O to/from its underlying KVS. */
  sync(): Promise<void> {
    if (this._pending_io) return this._pending_io;
    return Promise.resolve();
  }

  /** Apply an update to an entry that was received from the service (which
   * always overrides any pending flush for that entry). */
  private _update(key: K, value: V | undefined) {
    const ent = this._entries.get(key);

    // istanbul ignore if -- trivial case; we don't want to update things
    // nobody has asked for.
    if (!ent) return;

    ent.value = value;
    this._needs_fetch.delete(key);
    this._needs_flush.delete(key);
  }

  private _io(): Promise<void> {
    if (this._pending_io) return this._pending_io;

    // If we crash 3 or more times while doing I/O, something is very wrong.
    // Stop doing I/O and just be an in-memory cache.  Lots of crashes are
    // likely to be annoying to users.
    if (this._crash_count >= 3) return Promise.resolve();

    this._pending_io = new Promise(resolve =>
      later(() =>
        logErrorsFrom(async () => {
          while (this._needs_fetch.size > 0 || this._needs_flush.size > 0) {
            await this._fetch();
            await this._flush();
          }
        })
          .catch(e => {
            ++this._crash_count;
            if (this._crash_count >= 3) {
              console.warn(
                `KVC[${this.kvs.name}]: Crashed too many times during I/O; stopping.`,
              );
            }
            throw e;
          })
          .finally(() => {
            this._pending_io = null;
            resolve();
          }),
      ),
    );
    return this._pending_io;
  }

  private async _fetch() {
    const map = this._needs_fetch;
    this._needs_fetch = new Map();
    for (const batch of batchesOf(25, map.keys())) {
      const entries = await this.kvs.get(batch);
      for (const e of entries) this._update(e.key, e.value);
    }
  }

  private async _flush() {
    const map = this._needs_flush;
    this._needs_flush = new Map();
    for (const batch of batchesOf(25, map.values())) {
      // Capture all values to write and strip off any reactivity.  If we
      // don't strip the reactivity, we will not be able to send the
      // values via IPC (if this.kvs is a KVSClient, for example).
      const dirty = JSON.parse(JSON.stringify(batch));

      await this.kvs.set(dirty as Entry<K, V>[]);
    }
  }
}

/** A function for iterating over a list of items returned in chunks; it's here
 * (and exported) for use in the KVS implementation mainly because I didn't want
 * to create a separate util file for something so small. */
export async function* genericList<K extends Key, V extends Value>(
  getChunk: (key: K | undefined, limit: number) => Promise<Entry<K, V>[]>,
): AsyncIterable<Entry<K, V>> {
  let bound: K | undefined;
  while (true) {
    const res = await getChunk(bound, 100);
    if (res.length == 0) break;
    yield* res;
    bound = res[res.length - 1].key;
  }
}

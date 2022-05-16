import {IDBPDatabase, openDB} from 'idb';

import {KeyValueStore, genericList} from '.';
import event, {Event} from '../../util/event';
import {NanoService} from '../../util/nanoservice';
import * as Proto from './proto';

export default class Service<K extends Proto.Key, V extends Proto.Value>
    implements KeyValueStore<K, V>,
               NanoService<Proto.ClientMsg<K, V>, Proto.ServiceMsg<K, V>>
{
    // istanbul ignore next
    static async open<K extends Proto.Key, V extends Proto.Value>(
        db_name: string,
        store_name: string,
    ): Promise<Service<K, V>> {
        // Magical incantation to make sure the browser doesn't spontaneously
        // delete our store.
        if (! await navigator.storage.persisted()) {
            await navigator.storage.persist();
        }

        return new Service(await openDB(db_name, 1, {
            upgrade(db, oldVersion, newVersion, txn) {
                db.createObjectStore(store_name);
            }
        }), store_name);
    }

    readonly name: string;

    readonly onSet: Event<(entries: Proto.Entry<K, V>[]) => void>;
    readonly onDelete: Event<(keys: K[]) => void>;
    readonly onSyncLost: Event<() => void>;

    private _db: IDBPDatabase;
    private _clients = new Set<Proto.ClientPort<K, V>>();

    constructor(db: IDBPDatabase, store_name: string) {
        this.name = store_name;
        this.onSet = event('KVS.Service.onSet', this.name);
        this.onDelete = event('KVS.Service.onDelete', this.name);
        this.onSyncLost = event('KVS.Service.onSyncLost', this.name);
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
        bound: K | undefined, limit: number
    ): Promise<Proto.Entry<K, V>[]> {
        const b = bound !== undefined ?
            IDBKeyRange.lowerBound(bound, true) : undefined;

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
        bound: K | undefined, limit: number
    ): Promise<Proto.Entry<K, V>[]> {
        const b = bound !== undefined ?
            IDBKeyRange.upperBound(bound, true) : undefined;

        const txn = this._db.transaction(this.name);
        let cursor = await txn.store.openCursor(b, 'prev');

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

    async set(entries: Proto.Entry<K, V>[]): Promise<void> {
        const txn = this._db.transaction(this.name, 'readwrite');
        for (const {key, value} of entries) await txn.store.put(value, key);
        await txn.done;

        // istanbul ignore else
        if (entries.length > 0) {
            this._broadcast({$type: 'set', entries});
            this.onSet.send(entries);
        }
    }

    async delete(keys: K[]): Promise<void> {
        const deleted: K[] = [];
        const txn = this._db.transaction(this.name, 'readwrite');
        for (const k of keys) {
            if (await txn.store.get(k)) deleted.push(k);
            await txn.store.delete(k);
        }
        await txn.done;

        // istanbul ignore else
        if (deleted.length > 0) {
            this._broadcast({$type: 'delete', keys: deleted});
            this.onDelete.send(deleted);
        }
    }

    async deleteAll(): Promise<void> {
        // We delete in batches of 100 so as to report incremental progress to
        // any clients that might be listening (and avoid sending any one
        // message that's too big).
        while (true) {
            const deleted_keys: K[] = [];
            const txn = this._db.transaction(this.name, 'readwrite');
            let cursor = await txn.store.openCursor();

            while (cursor) {
                // Same cast as in set() above
                deleted_keys.push(cursor.primaryKey as K);
                cursor.delete();
                cursor = await cursor.continue();
                if (deleted_keys.length > 100) break;
            }
            await txn.done;

            if (deleted_keys.length > 0) {
                this._broadcast({$type: 'delete', keys: deleted_keys});
                this.onDelete.send(deleted_keys);
            } else {
                break;   // No more keys to delete
            }
        }
    }

    //
    // NanoService implementation (for remote KVS service)
    //

    onConnect(port: Proto.ClientPort<K, V>) { this._clients.add(port); }

    // istanbul ignore next
    onDisconnect(port: Proto.ClientPort<K, V>) { this._clients.delete(port); }

    // istanbul ignore next - this is quite trivial overall and is type-checked
    async onRequest(
        port: Proto.ClientPort<K, V>, msg: Proto.ClientMsg<K, V>
    ): Promise<Proto.ServiceMsg<K, V>> {
        switch (msg?.$type) {
            case 'get':
                return {
                    $type: 'set',
                    entries: await this.get(msg.keys),
                };
            case 'getStartingFrom':
                return {
                    $type: 'set',
                    entries: await this.getStartingFrom(msg.bound, msg.limit),
                };
            case 'getEndingAt':
                return {
                    $type: 'set',
                    entries: await this.getEndingAt(msg.bound, msg.limit),
                };
            case 'set':
                await this.set(msg.entries);
                return null;
            case 'delete':
                await this.delete(msg.keys);
                return null;
            case 'deleteAll':
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

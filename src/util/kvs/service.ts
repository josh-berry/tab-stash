import {IDBPDatabase, openDB} from 'idb';

import {KeyValueStore, genericList} from '.';
import Listener from '../listener';
import {NanoService} from '../nanoservice';
import * as Proto from './proto';

export default class Service<K extends Proto.Key, V extends Proto.Value>
    implements KeyValueStore<K, V>,
               NanoService<Proto.ClientMsg<K, V>, Proto.ServiceMsg<K, V>>
{
    static async open<K extends Proto.Key, V extends Proto.Value>(
        db_name: string,
        store_name: string,
    ): Promise<Service<K, V>> {
        return new Service(await openDB(db_name, 1, {
            upgrade(db, oldVersion, newVersion, txn) {
                db.createObjectStore(store_name);
            }
        }), store_name);
    }

    readonly name: string;

    onSet = new Listener<(entries: Proto.Entry<K, V>[]) => void>();
    onDelete = new Listener<(keys: K[]) => void>();

    private _db: IDBPDatabase;
    private _clients = new Set<Proto.ClientPort<K, V>>();

    constructor(db: IDBPDatabase, store_name: string) {
        this.name = store_name;
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
        const b = bound ? IDBKeyRange.lowerBound(bound, true) : undefined;

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

    list(): AsyncIterable<Proto.Entry<K, V>> {
        return genericList(this);
    }

    async set(entries: Proto.Entry<K, V>[]): Promise<void> {
        const txn = this._db.transaction(this.name, 'readwrite');
        for (const {key, value} of entries) await txn.store.put(value, key);
        await txn.done;

        if (entries.length > 0) {
            this._broadcast({$type: 'set', entries});
            this.onSet.send(entries);
        }
    }

    async delete(keys: K[]): Promise<void> {
        const txn = this._db.transaction(this.name, 'readwrite');
        for (const k of keys) await txn.store.delete(k);
        await txn.done;

        if (keys.length > 0) {
            this._broadcast({$type: 'delete', keys});
            this.onDelete.send(keys);
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
    onDisconnect(port: Proto.ClientPort<K, V>) { this._clients.delete(port); }

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
            case 'set':
                await this.set(msg.entries);
                return;
            case 'delete':
                await this.delete(msg.keys);
                return;
            case 'deleteAll':
                await this.deleteAll();
                return;
            default:
                return;
        }
    }

    private _broadcast(msg: Proto.ServiceMsg<K, V>) {
        for (const c of this._clients) c.notify(msg);
    }
}

import {Events} from 'webextension-polyfill-ts';
import {reactive} from 'vue';

import {logErrors} from '../../util';

import {Entry, Key, Value} from './proto';
import Client from './client';
import Service from './service';

export {Client, Service, Entry, Key, Value};

export interface KeyValueStore<K extends Key, V extends Value> {
    readonly onSet: Events.Event<(entries: Entry<K, V>[]) => void>;
    readonly onDelete: Events.Event<(keys: K[]) => void>;

    get(keys: K[]): Promise<Entry<K, V>[]>;
    getStartingFrom(bound: K | undefined, limit: number): Promise<Entry<K, V>[]>;
    getEndingAt(bound: K | undefined, limit: number): Promise<Entry<K, V>[]>;

    list(): AsyncIterable<Entry<K, V>>;
    listReverse(): AsyncIterable<Entry<K, V>>;

    set(entries: Entry<K, V>[]): Promise<void>;

    delete(keys: K[]): Promise<void>;
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
 */
 export class KVSCache<K extends Key, V extends Value> {
    /** The underlying KVS which is backing the KVSCache.  If is perfectly fine
     * to do calls directly against ths KVS if you need to do something not
     * supported by the KVSCache, however some inconsistency with the cache may
     * result. */
    readonly kvs: KeyValueStore<K, V>;

    /** Tunable allowing users to adjust the max delay before flushing dirty
     * entries to the KVS.  (The actual delay is a random number of milliseconds
     * between 0 and `maxFlushTimeoutMS`.) Set this to 0 to flush as quickly as
     * possible (but still in the background). */
    maxFlushTimeoutMS: number = 100;

    private readonly _entries = new Map<K, Entry<K, V | null>>();
    private _needs_flush = new Map<K, Entry<K, V>>();
    private _needs_fetch = new Map<K, Entry<K, V | null>>();

    private _pending_flush: NodeJS.Timeout | null = null;
    private _pending_fetch: NodeJS.Timeout | null = null;

    constructor(kvs: KeyValueStore<K, V>) {
        this.kvs = kvs;

        this.kvs.onSet.addListener(entries => {
            for (const e of entries) this._update(e.key, e.value);
        });
        this.kvs.onDelete.addListener(keys => {
            for (const k of keys) this._update(k, null);
        });
    }

    /** Returns an entry from the KVS.  If the entry isn't in cache yet (or
     * isn't in the KVS at all), the entry's value will be `null` and the entry
     * will be fetched in the background.  The returned entry is reactive, so it
     * will be updated once the value is available. */
    get(key: K): Entry<K, V | null> {
        const e = this._ensure(key);
        if (e.value === null) {
            this._needs_fetch.set(key, e);
            this._fetch();
        }
        return e;
    }

    /** Updates an entry in the KVS.  The cache is updated immediately, but
     * entries will be flushed in the background. */
    set(key: K, value: V): Entry<K, V | null> {
        const ent = this._ensure(key);
        ent.value = value;
        this._needs_flush.set(key, ent as Entry<K, V>);
        this._needs_fetch.delete(key);
        this._flush();
        return ent;
    }

    private _ensure(key: K): Entry<K, V | null> {
        let e = this._entries.get(key);
        if (! e) {
            e = reactive({key, value: null}) as Entry<K, V | null>;
            this._entries.set(key, e);
        }
        return e;
    }

    private _update(key: K, value: V | null) {
        this._ensure(key).value = value;
        this._needs_fetch.delete(key);
        this._needs_flush.delete(key);
    }

    private _fetch() {
        if (this._pending_fetch) return;
        this._pending_fetch = setTimeout(() => logErrors(async () => {
            while (this._needs_fetch.size > 0) {
                const keys = Array.from(this._needs_fetch.keys());
                this._needs_fetch = new Map();

                const entries = await this.kvs.get(keys);
                for (const e of entries) this._update(e.key, e.value);
            }

            this._pending_fetch = null;
        }));
    }

    private _flush() {
        if (this._pending_flush) return;
        this._pending_flush = setTimeout(() => logErrors(async () => {
            // Capture all values to write and strip off any reactivity.  If we
            // don't strip the reactivity, we will not be able to send the
            // values via IPC (if this.kvs is a KVSClient, for example).
            const dirty = JSON.parse(JSON.stringify(Array.from(
                this._needs_flush.values())));
            this._needs_flush = new Map();

            this._pending_flush = null;

            if (dirty.length > 0) await this.kvs.set(dirty as Entry<K, V>[]);
        }), Math.random() * this.maxFlushTimeoutMS);
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

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

    private readonly _entries = new Map<K, Entry<K, V | null>>();
    private _needs_flush = new Map<K, Entry<K, V>>();
    private _needs_fetch = new Map<K, Entry<K, V | null>>();

    private _pending_io: Promise<void> | null = null;

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
        let e = this._entries.get(key);
        if (! e) {
            e = reactive({key, value: null}) as Entry<K, V | null>;
            this._entries.set(key, e);
            this._needs_fetch.set(key, e);
            this._io();
        }
        return e;
    }

    /** Updates an entry in the KVS.  The cache is updated immediately, but
     * entries will be flushed in the background. */
    set(key: K, value: V): Entry<K, V | null> {
        const ent = this.get(key);
        ent.value = value;
        this._needs_flush.set(key, ent as Entry<K, V>);
        this._needs_fetch.delete(key);
        this._io();
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
    maybeInsert(key: K, value: V): Entry<K, V | null> {
        const ent = this.get(key);
        if (ent.value !== null) return ent;

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

    /** Returns a promise that resolves once the cache has flushed all pending
     * writes to its underlying KVS. */
    flush(): Promise<void> {
        if (this._pending_io) return this._pending_io;
        return Promise.resolve();
    }

    /** Apply an update to an entry that was received from the service (which
     * always overrides any pending flush for that entry). */
    private _update(key: K, value: V | null) {
        const ent = this._entries.get(key);

        // istanbul ignore if -- trivial case; we don't want to update things
        // nobody has asked for.
        if (! ent) return;

        ent.value = value;
        this._needs_fetch.delete(key);
        this._needs_flush.delete(key);
    }

    private _io() {
        if (this._pending_io) return;
        this._pending_io = new Promise(resolve => setTimeout(() =>
            logErrors(async () => {
                while (this._needs_fetch.size > 0 || this._needs_flush.size > 0) {
                    await this._fetch();
                    await this._flush();
                }
            }).finally(() => {
                this._pending_io = null;
                resolve();
            })
        ));
    }

    private async _fetch() {
        while (this._needs_fetch.size > 0) {
            const keys = Array.from(this._needs_fetch.keys());
            this._needs_fetch = new Map();

            const entries = await this.kvs.get(keys);
            for (const e of entries) this._update(e.key, e.value);
        }
    }

    private async _flush() {
        while (this._needs_flush.size > 0) {
            // Capture all values to write and strip off any reactivity.  If we
            // don't strip the reactivity, we will not be able to send the
            // values via IPC (if this.kvs is a KVSClient, for example).
            const dirty = JSON.parse(JSON.stringify(Array.from(
                this._needs_flush.values())));
            this._needs_flush = new Map();

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

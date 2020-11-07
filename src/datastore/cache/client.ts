"use strict";

// Front-end to a cache provided by datastore/cache/service.ts.  For a complete design
// description, see datastore/cache/service.ts.
//
// Note that the front end caches stuff locally, so even if the back-end isn't
// available for whatever reason, clients shouldn't notice (apart from stuff
// being missing and/or not persisted).
//
// The Cache client follows a similar ethos to other model-like modules
// (e.g. stored-object and model) wherein it provides a get() method for
// retrieving a plain old JS object which is updated auto-magically when the
// contents of the cache change.  This is so Vue can do the right thing in
// showing cache entries to the end user.
//
// The cache is modified using set(), which sends the change to the cache
// service (and eventually on to all other clients).
//
// There are NO guarantees about consistency/atomicity of updates.  It is
// possible the cache may report stale data if multiple updates occur/are
// broadcast in quick succession; if this is a concern (and it's REALLY worth
// the extra complexity), code changes are required. :)

import {Send, connect} from '../../util/nanoservice';
import {ServicePort, FetchMessage, UpdateMessage} from './proto';

// Ugly global object which keeps track of all the open caches, so we only have
// one client per cache per JS environment.
const CACHES = new Map<string, Cache<any>>();

// A cache entry, exposed to the consumer thru Cache.get().
export type CacheEntry<Content extends Send> = {
    key: string,
    value: Content | undefined,
    fetched: boolean, // Whether this item has EVER been fetched
};

// The cache.
export class Cache<Content extends Send> {
    private _name: string;
    private _service: ServicePort<Content>;

    private _local_cache: Map<string, CacheEntry<Content>> = new Map();

    // Vue wants a plain old array it can watch--it doesn't understand how to
    // monitor Maps for changes.
    private _local_cache_for_vue: CacheEntry<Content>[] = [];

    // The set of items we need to send fetch requests for; each entry in the
    // set corresponds to a key in /_local_cache/.  Fetches are batched and
    // sent in the background to reduce the overhead of making multiple requests
    // together; if this set exists, a request is being prepared.
    private _fetching: Set<string> | undefined;

    // Same as above, except for updates (via set()).
    private _updating: Map<string, Content> | undefined;

    static open<Content extends Send>(name: string): Cache<Content> {
        let cache = CACHES.get(name);
        if (cache) {
            return cache;
        } else {
            cache = new Cache(name, connect(`cache:${name}`));
        }

        CACHES.set(name, cache);

        return cache;
    }

    private constructor(name: string, conn: ServicePort<Content>) {
        this._name = name;
        this._service = conn;

        this._service.onNotify = m => {
            switch (m.$type) {
                case 'update': {
                    for (const e of m.entries) {
                        const ent = this._local_cache.get(e.key);
                        if (ent) ent.value = e.value;
                    }
                    break;
                }

                case 'expired': {
                    for (const k of m.keys) {
                        const ent = this._local_cache.get(k);
                        if (ent) ent.value = undefined;
                        // We never delete stuff from _local_cache because it
                        // might mean Vue doesn't receive updates for things
                        // that are dropped and later re-added to the cache :/
                    }
                    break;
                }

                // istanbul ignore next
                default:
                    // Perhaps we are speaking different protocol versions;
                    // ignore unknown messages.
                    console.warn(`cache:${this._name}: Received unknown message: ${JSON.stringify(m)}`);
            }
        };
    }

    get(key: string): CacheEntry<Content> {
        const ent = this._cached(key);
        if (! ent.fetched) {
            if (! this._fetching) {
                this._fetching = new Set();
                setTimeout(() => this._send_fetches());
            }
            this._fetching.add(ent.key);
            ent.fetched = true;
        }
        return ent;
    }

    set(key: string, value: Content): CacheEntry<Content> {
        const ent = this._cached(key);
        ent.value = value;
        ent.fetched = true; // since we're about to send an update

        if (! this._updating) {
            this._updating = new Map();
            setTimeout(() => this._send_updates());
        }
        this._updating.set(key, value);

        return ent;
    }

    // Implementation details past this point.

    _cached(key: string): CacheEntry<Content> {
        let ent = this._local_cache.get(key);
        if (! ent) {
            ent = {key, value: undefined, fetched: false};
            this._local_cache.set(key, ent);
            this._local_cache_for_vue.push(ent);
        }
        return ent;
    }

    _send_fetches() {
        // istanbul ignore if
        if (! this._fetching) return;

        this._service.notify(<FetchMessage>{
            $type: 'fetch',
            keys: Array.from(this._fetching),
        });

        this._fetching = undefined;
    }

    _send_updates() {
        // istanbul ignore if
        if (! this._updating) return;

        const entries = [];
        for (const [key, value] of this._updating) entries.push({key, value});

        this._service.notify(<UpdateMessage<Content>>{
            $type: 'update', entries
        });

        this._updating = undefined;
    }
}

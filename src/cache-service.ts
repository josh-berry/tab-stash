"use strict";

// A cache which uses indexedDB to save various bits of metadata used by the UI
// (for example, favicon URLs), expires old/stale metadata that hasn't been
// used in a while, and notifies clients of any updates.
//
// This is the "service" (back-end) portion of the cache, which is responsible
// for storing the authoritative copy of the cache persistently, and
// garbage-collecting old entries.  See cache-client.ts for the "front-end"
// bits.
//
// BACKGROUND: FAVICON USE CASE
// ----------------------------
//
// Unfortunately, Firefox doesn't provide any API to retrieve a site's favicon
// given a URL.  This is understandable, because figuring out the favicon for a
// site is a rather expensive operation which involves one or more HTTP requests
// to the site, parsing the DOM, etc.--not something we typically want to do
// just to show a small icon in a sidebar.
//
// There is a favicon service operated by Google which does this (you can
// include a simple <img> tag pointing to the favicon as found by Google), but
// using this service leaks info about which domains the user is visiting to an
// ad-supported megacorp.  I'd rather avoid that if possible.
//
// The solution is to cache the (URLs of) favicons we've previously seen in the
// browser's persistent storage, make this cache available to the UI, and age
// out favicons for domains we no longer need to show so the cache doesn't grow
// infinitely large.
//
// The cache itself is not particularly consistent--updates are always flushed
// out in the background during idle periods, and there is at least one known
// race related to aging items out of the cache (documented in the code below).
// But it's good enough for our purposes.
//
// SIZING AND STORAGE CHOICES
// --------------------------
//
// I have 124 tabs in my stash right now.  Just taking a quick sample of those
// tabs and summing up all the sizes of the favIconUrls for each tab, I wind up
// at a little under 1 MiB (actually 853,920 bytes).  If I count only one
// favIconUrl per unique hostname, I can cut that in (roughly) half to 486,864
// bytes across 55 unique hostnames.
//
// Scaling this up to, say, 1000 tabs across 500 domains, we're talking maybe ~5
// MiB of cache data altogether.  This is small enough that IMO it's perfectly
// fine to store in browser-local storage.
//
// The problem with browser-local storage, however, is that *managing* it is a
// pain--there's no async way to say "give me all the keys in storage without
// bothering to load the values", so clearing old entries can be an expensive
// operation.  So we use IndexedDB (via idb) instead, because IndexedDB (I
// think) has better capacity/performance, and allows us to do this async
// iteration, so we can easily garbage-collect the cache.
//
// CACHING AND AGING ALGORITHM
// ---------------------------
//
// The algorithm is quite stupid, TBH.  Every time we see a new connection from
// a cache client, we increment a generation number, which is stored
// persistently.  Every time we access/load a cache entry, we set its
// last-accessed generation to the current generation number.
//
// Once the generation number hits *GC_THRESHOLD*, we:
//
// 1. Divide the current generation number by 2.
//
// 2. Scan the entire cache and divide the generation number of each entry by 2.
//
// 3. Delete any entries with a generation number that reaches 0 (rounded down
//    to the nearest integer).
//
// This algorithm gives us a few nice properties:
//
// - Collections are triggered every `GC_THRESHOLD / 2` iterations.
//
// - Entries are deleted after they have not been touched for at least
//   `log2(GC_THRESHOLD) + 1` collections.
//
// - If an entry is touched even once during this time, its exipration time is
//   reset and it's allowed to live for at least `log2(GC_THRESHOLD) + 1` more
//   collections.
//
// CACHING ALGORITHM RATIONALE
// ---------------------------
//
// We only bump the generation number on client connection, because we can
// safely assume that if the client needs one cache entry during its lifetime,
// it will (sooner or later) need all of them.  However, it may be that the
// client wants to access some entries a lot more than others (e.g. for the
// favicon cache, if the user is particularly active on some websites, but just
// has others open or saved in the background).  So we want to support aging out
// of old entries, without being too sensitive as to the relative frequency of
// access of different entries in the cache.
//
// We decay using *GC_THRESHOLD* to give ourselves a margin of error--if for
// some reason (lazy loading, etc.) the client does *not* ask for a particular
// entry during one run, but asks intermittently over the course of several
// runs, we need to ensure that favicon stays in the cache.  This also gives us
// a bit of resiliency against bugs in the client or cache itself related to
// premature aging or not accessing entries that are actually needed.

import {
    IDBPDatabase, DBSchema,
    openDB, /* deleteDB, */
    /* wrap, unwrap */
} from 'idb';

import {nonReentrant} from './util';
import {Send, NanoService} from './util/nanoservice';

import {ClientPort, ClientMsg, ServiceMsg} from './cache-proto';

// When the global generation number hits at least /GC_THRESHOLD/, we trigger a
// collection, as described above.
export const GC_THRESHOLD = 4 /* generations */;



// indexedDB schema for the persistent representation of the cache.
interface CacheSchema<Content extends Send> extends DBSchema {
    cache: {
        key: string, // URL.origin. Follows the form: "http[s]://host:80"
        value: {
            key: string,
            value: Content,
            agen: number, // access generation number
        },
        indexes: {},
    },
    options: {
        key: string,
        value: number,
        indexes: {},
    },
}


// A cache service.  Start it (in the background thread/index.js) with
// CacheService.start().
//
// ONLY ONE OF THESE SHOULD EXIST PER CACHE PER BROWSER.
//
// There is no JS API here (apart from start()) because the real API is
// browser.runtime messages from the cache-client.
export class CacheService<Content extends Send>
    extends NanoService<ClientMsg<Content>, ServiceMsg<Content>>
{
    private _db: IDBPDatabase<CacheSchema<Content>>;
    private _gen: number;

    private _clients = new Set<ClientPort<Content>>();

    // We can see multiple client connections show up in quick succession, so we
    // use an AsyncQueue to enforce a global ordering of generation
    // numbers/garbage collections.  This global ordering is important because
    // we don't want to accidentally trigger two concurrent GCs and wind up
    // prematurely aging items in the cache.
    private _mutate_task: () => Promise<void>;

    // Pending database mutations, applied by the _mutate_task, which batches
    // things together by virtue of it being nonReentrant().
    private _pending = {
        // Generation needs to be incremented (might trigger GC)
        inc_gen: false,

        // Cache entries which have been accessed or modified.  Mere accesses
        // are recorded with the value `undefined`.  Modifications are recorded
        // with the actual CacheContent (which can be `null`, but never
        // `undefined`).
        updates: new Map<string, Content | undefined>(),
    };

    static async start<C extends Send>(name: string): Promise<CacheService<C>> {
        const path = `cache:${name}`;

        const db = await openDB<CacheSchema<C>>(path, 1, {
            upgrade(db, oldVersion, newVersion, txn) {
                db.createObjectStore('cache', {
                    keyPath: 'key',
                });
                db.createObjectStore('options', {});
            },
            blocked() {},
            blocking() {},
        });

        const gen = (await db.get('options', 'generation')) || 0;

        return new CacheService(path, db, gen);
    }

    // Don't call this -- call start() instead.
    constructor(path: string, db: IDBPDatabase<CacheSchema<Content>>, gen: number) {
        super(path);
        this._db = db;
        this._gen = gen;
        this._mutate_task = nonReentrant(() => this._mutate());
    }

    // For testing purposes
    get gen_testonly(): number { return this._gen; }
    get next_mutation_testonly(): Promise<void> {
        return this._mutate_task();
    }
    force_gc_on_next_mutation_testonly() {
        if (this._gen < GC_THRESHOLD) this._gen = GC_THRESHOLD;
        this._pending.inc_gen = true;
    }
    async dump_testonly(): Promise<any> {
        const cache = [];
        const txn = this._db.transaction('cache', 'readonly');
        let cursor = await txn.store.openCursor();
        while (cursor) {
            cache.push(cursor.value);
            cursor = await cursor.continue();
        }
        await txn.done;

        return {
            cache,
            generation: (await this._db.get('options', 'generation')) || 0,
        };
    }
    async clear_testonly() {
        this._pending = {inc_gen: false, updates: new Map()};

        const txn = this._db.transaction('cache', 'readwrite');
        let cursor = await txn.store.openCursor();
        while (cursor) {
            cursor.delete();
            cursor = await cursor.continue();
        }
        await txn.done;
    }

    // Internal stuff past this point

    onConnect(port: ClientPort<Content>) {
        this._pending.inc_gen = true;
        this._mutate_task();

        this._clients.add(port);
    }

    onDisconnect(port: ClientPort<Content>) {
        if (port.error) {
            console.warn(`Port disconnected: ${JSON.stringify(port.error)}`);
        }
        this._clients.delete(port);
    }

    onNotify(port: ClientPort<Content>, msg: ClientMsg<Content>) {
        switch (msg.$type) {
            case 'fetch':
                this._onFetch(port, msg.keys).catch(console.log);
                break;
            case 'update':
                this._onEntry(port, msg.entries).catch(console.log);
                break;
        }
    }

    private async _onFetch(port: ClientPort<Content>, keys: string[]) {
        const txn = await this._db.transaction('cache');

        const entries: {key: string, value: Content}[] = [];

        for (const key of keys) {
            const ent = await txn.store.get(key);

            // We drop entries that have no entry in the cache; this is safe
            // since there's nothing client-side that's waiting for a response
            // per se.  If that changes in future client implementations, we can
            // adjust the semantics of EntryMessage (or add a separate not-found
            // message) accordingly.
            if (! ent) continue;

            entries.push({key: ent.key, value: ent.value});
            if (! this._pending.updates.has(key)) {
                this._pending.updates.set(key, undefined);
            }
        }

        // We send early to reduce latency on the client side, even though
        // there's risk of a conflict and the client receiving stale data.
        port.notify({$type: 'update', entries});

        await txn.done;
        this._mutate_task();
    }

    private async _onEntry(port: ClientPort<Content>,
                           entries: {key: string, value: Content}[])
    {
        for (const ent of entries) {
            this._pending.updates.set(ent.key, ent.value);
        }
        this._mutate_task();
    }

    private async _mutate(): Promise<void> {
        // Collects the set of updated entries to be reported to clients.
        //
        // NOTE: We use a Map here and convert to an array later so that if we
        // end up seeing the same entry multiple times through this loop (due to
        // concurrent delete/update cycles for the same entry), we always take
        // the latest value.
        let updated = new Map();

        if (this._pending.inc_gen) {
            if (this._gen < GC_THRESHOLD) {
                ++this._gen;
                await this._db.put('options', this._gen, 'generation');

            } else {
                this._gen = Math.floor(this._gen / 2);
                await this._db.put('options', this._gen, 'generation');

                // Since GC must touch every element anyway, we pass along the
                // pending updates and let GC opportunistically handle some of
                // the updates.
                updated = await this._gc(this._pending.updates);
            }
            this._pending.inc_gen = false;
        }

        for (const [key, value] of this._pending.updates) {
            const txn = this._db.transaction('cache', 'readwrite');
            let ent = await txn.store.get(key);

            if (! ent) {
                if (value !== undefined) {
                    ent = {key, value, agen: this._gen};
                } else {
                    // How did we touch something that doesn't exist?
                    await txn.done;
                    this._pending.updates.delete(key);
                    console.warn('Touched nonexistent key:', key);
                    continue;
                }
            }

            ent.agen = this._gen;
            if (value !== undefined) ent.value = value;

            await txn.store.put(ent);
            await txn.done;

            if (value !== undefined) updated.set(key, value);
            this._pending.updates.delete(key);
        }

        // If we reach this point, _pending.updates is now empty; anything
        // values we actually changed went into /updated/.  We just need to
        // munge /updated/ and send a notice to everyone that some stuff has
        // changed.
        const entries = [];
        for (const [key, value] of updated) entries.push({key, value});
        if (entries.length > 0) this._broadcast({$type: 'update', entries});
    }

    private async _gc(
        updates: Map<string, Content | undefined>
    ): Promise<Map<string, Content>> {
        const updated = new Map();
        const expired = [];
        const txn = this._db.transaction('cache', 'readwrite');
        let cursor = await txn.store.openCursor();

        while (cursor) {
            const ent = {...cursor.value};

            if (updates.has(ent.key)) {
                ent.agen = this._gen;
                ent.value = updates.get(ent.key) || ent.value;
                updated.set(ent.key, ent.value);
                updates.delete(ent.key);
            } else {
                ent.agen = Math.floor(ent.agen / 2);
            }

            if (ent.agen <= 0) {
                expired.push(ent.key);
                cursor.delete();
            } else {
                cursor.update(ent);
            }
            cursor = await cursor.continue();
        }

        await txn.done;

        if (expired.length > 0) {
            this._broadcast({$type: 'expired', keys: expired});
        }

        return updated;
    }

    private _broadcast(m: ServiceMsg<Content>) {
        for (const c of this._clients) c.notify(m);
    }
}

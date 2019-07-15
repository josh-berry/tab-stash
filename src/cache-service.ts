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

import {AsyncQueue} from './util';

import {CacheContent, Message} from './cache-proto';

// When the global generation number hits at least /GC_THRESHOLD/, we trigger a
// collection, as described above.
const GC_THRESHOLD = 16 /* generations */;



// All of the services we have constructed--this map ensures they are singletons
const SERVICES = new Map<string, CacheService>();

// Forward connection requests to the appropriate service.
browser.runtime.onConnect.addListener(port => {
    const svc = SERVICES.get(port.name);
    if (! svc) return;
    svc._onConnect(port);
});



// indexedDB schema for the persistent representation of the cache.
interface CacheSchema extends DBSchema {
    cache: {
        key: string, // URL.origin. Follows the form: "http[s]://host:80"
        value: {
            key: string,
            value: CacheContent,
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
export class CacheService {
    private _path: string;
    private _db: IDBPDatabase<CacheSchema>;
    private _gen: number;

    // We can see multiple client connections show up in quick succession, so we
    // use an AsyncQueue to enforce a global ordering of generation
    // numbers/garbage collections.  This global ordering is important because
    // we don't want to accidentally trigger two concurrent GCs and wind up
    // prematurely aging items in the cache.
    private _mutate_gen = AsyncQueue();

    private _clients = new Set<browser.runtime.Port>();

    static async start(name: string): Promise<CacheService> {
        const path = `cache:${name}`;
        let svc = SERVICES.get(path);
        if (svc) return svc;

        const db = await openDB<CacheSchema>(path, 1, {
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

        svc = new CacheService(path, db, gen);
        SERVICES.set(path, svc);
        return svc;
    }

    // Don't call this -- call start() instead.
    constructor(path: string, db: IDBPDatabase<CacheSchema>, gen: number) {
        this._path = path;
        this._db = db;
        this._gen = gen;
    }

    // For testing purposes
    get generation(): number { return this._gen; }
    get gen_update_done(): Promise<void> {
        return this._mutate_gen(async () => undefined);
    }

    // Internal stuff past this point

    _onConnect(port: browser.runtime.Port) {
        this._inc_gen();

        this._clients.add(port);

        port.onMessage.addListener(msg => {
            const m = msg as Message<CacheContent>;
            switch (m.type) {
                case 'fetch':
                    this._onFetch(port, m.key).catch(console.log);
                    break;
                case 'entry':
                    this._onEntry(port, m.key, m.value).catch(console.log);
                    break;
                default:
                    // Perhaps we are speaking different protocol versions;
                    // ignore unknown messages.
                    console.warn(`${this._path}: Received unknown message: ${JSON.stringify(m)}`);
            }
        });

        port.onDisconnect.addListener(p => {
            if (p.error) {
                console.warn(`Port disconnected: ${JSON.stringify(p.error)}`);
            }
            this._clients.delete(port);
        });
    }

    async _onFetch(port: browser.runtime.Port, key: string) {
        const txn = await this._db.transaction('cache', 'readwrite');
        const ent = await txn.store.get(key);

        // We drop fetch messages that have no entry in the cache; this is safe
        // since there's nothing client-side that's waiting for a response per
        // se.  If that changes in future client implementations, we can adjust
        // the semantics of EntryMessage (or add a separate not-found message)
        // accordingly.
        if (! ent) return;

        // We post early to reduce latency on the client side, even though
        // there's risk of a conflict and the client receiving stale data.
        this._send(port, {type: 'entry', key, value: ent.value});

        ent.agen = this._gen;
        await txn.store.put(ent);
        await txn.done;
    }

    async _onEntry(port: browser.runtime.Port, key: string, value: CacheContent)
    {
        await this._db.put('cache', {key, value, agen: this._gen});
        this._broadcast({type: 'entry', key, value});
    }

    _inc_gen(): Promise<void> {
        return this._mutate_gen(async () => {
            if (this._gen < GC_THRESHOLD) {
                ++this._gen;
                await this._db.put('options', this._gen, 'generation');

            } else {
                this._gen = Math.floor(this._gen / 2);
                await this._db.put('options', this._gen, 'generation');

                await this._gc();
            }
        });
    }

    async _gc() {
        const txn = this._db.transaction('cache', 'readwrite');
        let cursor = await txn.store.openCursor();
        while (cursor) {
            const ent = {...cursor.value};

            ent.agen = Math.floor(ent.agen / 2);

            if (ent.agen <= 0) {
                cursor.delete();
                this._broadcast({type: 'expiring', key: ent.key});
            } else {
                cursor.update(ent);
            }
            cursor = await cursor.continue();
        }
        await txn.done;
    }

    // Type-safe methods for sending messages
    _send(port: browser.runtime.Port, m: Message<CacheContent>) {
        port.postMessage(m);
    }

    _broadcast(m: Message<CacheContent>) {
        for (const c of this._clients) c.postMessage(m);
    }
}

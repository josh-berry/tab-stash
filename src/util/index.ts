// Things which are not specific to Tab Stash or browser functionality go here.
import {browser} from 'webextension-polyfill-ts';
import * as Vue from 'vue';

export {
    TaskHandle, Task, TaskIterator,
    TaskMonitor, Progress, TaskCancelled,
} from './progress';

export type Atom = null | boolean | number | string;

/** A value that's convertible to JSON without losing information. */
export type ToJSON = Atom
                 | {[k: string]: ToJSON}
                 | [...ToJSON[]] | ToJSON[];

// Args is the arguments of a function
export type Args<F extends Function> =
    F extends (...args: infer A) => any ? A : never;

// AsyncReturnTypeOf is the return type of an `async function` (or Promise). So:
//
// AsyncReturnTypeOf<(...) => Promise<T>> == T
//
// It comes from a slight modification of the "Advanced Types" section of the
// TypeScript docs.
export type AsyncReturnTypeOf<T extends (...args: any) => any> =
    ReturnType<T> extends Promise<infer U> ? U : void;

export type Promised<T> = T extends Promise<infer V> ? V : T;

// A small wrapper function to mark a Vue prop as 'required'
export const required = <T>(type: T) => ({type, required: true} as const);

// A "marker" type for a string which is a URL that is actually openable by Tab
// Stash (see urlToOpen below).  (The __openable_url_marker__ property doesn't
// actually exist, it's just used to force an explicit cast so you can't use a
// string when you should be using a URL that has passed thru urlToOpen().)
export type OpenableURL = string & { __openable_url_marker__: undefined };

// Where do we redirect the user if they try to open a privileged URL?
const REDIR_PAGE = browser.runtime.getURL('restore.html');
export const REDIR_URL_TESTONLY = REDIR_PAGE;

// Ugh, stupid hack for the fact that getting stuff from the browser that should
// be a compiled-in set of constants is actually done through an async API...
//
// This is f*king racy and gross, but there's nothing we can do here since the
// browser doesn't give us a way to block on a Promise (understandably so, since
// that would raise a whole host of other reentrancy issues that most developers
// probably don't want to deal with...).
let PLATFORM_INFO = {
    'os': 'unknown',
    'arch': 'unknown',
};
browser.runtime.getPlatformInfo().then(x => {PLATFORM_INFO = x});
// istanbul ignore next
export const altKeyName = () => PLATFORM_INFO.os === 'mac' ? 'Option' : 'Alt';
// istanbul ignore next
export const bgKeyName = () => PLATFORM_INFO.os === 'mac' ? 'Cmd' : 'Ctrl';

// istanbul ignore next
export const bgKeyPressed = (ev: KeyboardEvent | MouseEvent) =>
    PLATFORM_INFO.os === 'mac' ? ev.metaKey : ev.ctrlKey;

/** Tests if two JSON-like values are deeply equal. */
export function deepEqual<T extends ToJSON>(l: T, r: T): boolean {
    if (l === r) return true;
    if (typeof l !== 'object' || typeof r !== 'object') return false;
    if (l === null || r === null) return false;
    if (l instanceof Array && r instanceof Array) {
        if (l.length !== r.length) return false;
        for (let i = 0; i < l.length; ++i) {
            if (! deepEqual(l[i], r[i])) return false;
        }
        return true;
    }
    if (! (l instanceof Array) && ! (r instanceof Array)) {
        // Casts needed here to work around a TypeScript oddity... it takes the
        // un-narrowed type of /l/ or /r/ and tries to match against a prototype
        // of Object.keys(), rather than taking the narrowed type (which is
        // guaranteed to be an object).)
        const lk = Object.keys(l as {}).sort();
        const rk = Object.keys(r as {}).sort();
        if (! deepEqual(lk, rk)) return false;
        for (const k of lk) {
            if (! deepEqual(l[k], r[k])) return false;
        }
        return true;
    }
    return false;
}

export const parseVersion = (v: string): number[] =>
    v.split('.').map(x => parseInt(x));

export function cmpVersions(a: string, b: string): number {
    const va = parseVersion(a);
    const vb = parseVersion(b);
    let i = 0;
    let cmplen = Math.min(va.length, vb.length);

    for (i = 0; i < cmplen; ++i) {
        if (va[i] != vb[i]) return va[i] - vb[i];
    }

    // Check for trailing .0.0.0... (e.g. 1.0 == 1.0.0)
    let tail = va.length > vb.length ? va : vb;
    if (tail.slice(cmplen).every(x => x == 0)) return 0;

    return va.length - vb.length;
}

type BMTree = {
    readonly children?: readonly BMTree[],
    readonly url?: string,
};
export function urlsInTree(bm_tree?: BMTree): OpenableURL[] {
    let urls: OpenableURL[] = [];
    function collect(bm: BMTree) {
        if (bm.children) {
            for (let c of bm.children) collect(c);
        } else /* istanbul ignore else */ if (bm.url) {
            urls.push(urlToOpen(bm.url));
        }
    }
    if (bm_tree) collect(bm_tree);
    return urls;
}

// Given a URL to stash, return the URL that is actually openable by an
// extension.  This is needed because sometimes the saved URL is a "privileged"
// URL (e.g. a tab which is open in Reader Mode), which we won't be able to open
// again later.
//
// This is in util.ts instead of stash.ts because it's also required by the
// model, which uses it to figure out if tabs/bookmarks are "related" to each
// other.
export function urlToOpen(urlstr: string): OpenableURL {
    try {
        const url = new URL(urlstr);
        switch (url.protocol) {
            case 'about:':
                switch (url.pathname) {
                    case 'blank':
                    case 'logo':
                        break;
                    case 'reader':
                        const res = url.searchParams.get('url');
                        if (res) return (res + url.hash) as OpenableURL;
                    default:
                        return redirUrl(urlstr);
                }
                break;

            case 'chrome:':
                // Chromium allows use of chrome:// URLs; Firefox doesn't (since
                // they're internal browser URLs). getBrowserInfo is a handy way
                // of checking if we're on Firefox (where it's present) or
                // Chromium (where it isn't).
                if (! browser.runtime.getBrowserInfo) break;
                return redirUrl(urlstr);

            case 'javascript:':
            case 'file:':
            case 'data:':
                return redirUrl(urlstr);
        }

        return urlstr as OpenableURL;

    } catch (e) {
        return redirUrl(urlstr);
    }
}

function redirUrl(url: string): OpenableURL {
    return `${REDIR_PAGE}?url=${encodeURIComponent(url)}` as OpenableURL;
}



export function asyncEvent<
    U,
    T extends (this: U, ...args: any[]) => Promise<any>
>(
    async_fn: T
): T {
    return function(this: U, ...args: any[]): Promise<any> {
        return async_fn.apply(this, args).catch(console.error);
    } as T;
}

export function logErrors<R>(f: () => Promise<R>): Promise<R> {
    return f().catch(e => {
        console.error(e);
        throw e;
    });
}

// Waits for a bunch of named promises.  The advantage to using this is it
// allows you to fire off a bunch of stuff in parallel and then wait for it all
// at once, which should in theory minimize overall latency.
//
// You can also combine promises with non-promise values and the non-promise
// values will be returned unchanged.
//
// Use it like: await resolveNamed({name: promise(), ...})
export async function resolveNamed<T extends {[k: string]: any}>(
    promises: T
): Promise<{[k in keyof T]: Promised<T[k]>}> {
    const objects: any = {};

    for (const k of Object.getOwnPropertyNames(promises)) {
        const p = promises[k];
        objects[k] = p instanceof Promise ? await p : p;
    }

    return objects;
}

/** Waits for the next iteration of the event loop and for Vue to flush any
 * pending watches (allowing event handlers etc. to run in the meantime). */
export function nextTick(): Promise<void> {
    return Promise.all([
        new Promise(resolve => setTimeout(resolve)),
        Vue.nextTick.apply(undefined),
    ]).then();
}

// Returns a function which, when called, arranges to call the async function
// /fn/ immediately, but only if it's not already running.
//
// We ensure that only one instance of the function is running at a time.  If
// the function is requested to be run before the previous call has finished
// running, the request will be queued and the function will be re-run again.
//
// The async function is always called with no arguments.  The return value from
// its promise is ignored.
//
// Since this is ostensibly a background task, exceptions which bubble out of
// the function are caught and logged to the console.
export function nonReentrant(fn: () => Promise<any>): () => Promise<void> {
    let running: Promise<any> | undefined;
    let next: Promise<void> | undefined;
    let resolve_next: (() => void) | undefined;

    const inner = () => {
        if (! running) {
            running = fn().finally(() => {
                running = undefined;
                if (next) {
                    let rn = resolve_next;
                    next = undefined;
                    resolve_next = undefined;
                    inner().finally(rn);
                }
            }).catch(console.log);
            return running;

        } else if (! next) {
            next = new Promise(resolve => {resolve_next = resolve});
        }

        return next;
    };

    return inner;
}



// A "defer queue" is a queue of functions (and their arguments) to be called
// later (referred to as "events").  This is mostly useful for event
// handling--e.g. if you need to collect and defer delivery of some events while
// you are doing some other asynchronous processing that depends on events NOT
// being delivered until that processing is complete.
//
// You can append to the queue with push(), or you can use wrap() to create a
// "wrapper function" which, when called, adds the call to the queue to be
// forwarded to another function on release().  (This wrapped function can then
// be provided as an event handler to other parts of the system.)
//
// To control the delivery of events, call plug() and unplug().  If the queue is
// "plugged" (the default state when it is constructed), events will be queued
// and not delivered.  When the queue is "unplugged", any queued events will be
// delivered in order, and future events will be delivered immediately.
export class DeferQueue {
    _events: [Function, any[]][] | null = [];

    push(fn: Function, ...args: any[]) {
        if (this._events !== null) {
            this._events.push([fn, args]);
        } else {
            fn(...args);
        }
    }

    wrap<FN extends (...args: any[]) => void>(fn: FN): FN {
        return ((...args: any[]) => this.push(fn, ...args)) as unknown as FN;
    }

    /* Untested; uncomment this only after adding unit tests
    plug() {
        if (this._events === null) {
            this._events = [];
        }
    }
    */

    unplug() {
        let evq = this._events;
        this._events = null;
        if (evq) for (let [fn, args] of evq) fn(...args);
    }
}



/** EventWiring solves the chicken-and-egg problem of, "I want to start
 * listening for events right away, but the object I need to update hasn't been
 * created yet".
 *
 * It does this by "wiring" up events ahead of time--listener functions will be
 * added right away to event emitters.  The listener function, when called, will
 * push its arguments onto a queue.  Then, when the actual object is provided,
 * the queued events will be delivered by calling the relevant method on the
 * object. */
export class EventWiring<O> {
    private _forward: (method: string | number | symbol, ...args: any[]) => void;

    private _queue: {method: string | number | symbol, args: any[]}[] = [];
    private _object: any = null;

    constructor() {
        this._forward = (method, ...args) => this._queue.push({method, args});
    }

    /** Listen for events from `emitter` by registering a listener function
     * which works as described in the class documentation.  The listener is
     * returned so the caller can unregister it later if desired. */
    listen<K extends keyof O>(
        emitter: {addListener: (listener: EvWiringListener<O, K>) => void},
        methodName: K
    ): EvWiringListener<O, K> {
        // CAST: TypeScript cannot infer that the function below has the same
        // signature as what's expected by the listener, I guess because it
        // can't look inside the EvWiringListener to determine that the function
        // arguments match what is expected.
        //
        // I did test that the API is type-safe at least (it will reject method
        // names which don't have the right signature for the listener).
        const listener =
            ((...rest: any) => this._forward(methodName, ...rest)) as EvWiringListener<O, K>;
        emitter.addListener(listener);
        return listener;
    }

    /** Deliver queued and all subsequent events to `obj`.  Call this to
     * actually start delivering events, once you know what `obj` actually is.
     * This can only be called once per EventWiring object. */
    wire(obj: O) {
        if (this._object) throw new Error(`Attempt to wire() multiple times`);

        this._object = obj;
        this._forward = (method, ...args) =>
            this._object[method].apply(this._object, args);

        for (const ev of this._queue) this._forward(ev.method, ev.args);
        this._queue = [];
    }
}

type EvWiringListener<O, K extends keyof O> =
    O[K] extends (this: O, ...args: infer A) => void
        ? (...args: A) => void
        : never;



// An AsyncIterator which yields values that are provided to it as soon as they
// are available.  Values can be sent with send(), and close() must be called to
// stop iteration.
export class AsyncChannel<V> implements AsyncIterableIterator<V> {
    // INVARIANT: Either _queue OR _waiters can have items, but never both at
    // the same time.
    private _queue: V[] = [];
    private _waiters: ((res: IteratorResult<V>) => void)[] = [];
    private _done: boolean = false;

    onClose?: () => void;

    constructor() {}

    // Sending
    send(value: V) {
        if (this._done) throw new ReferenceError("send() on a closed channel");
        if (this._waiters.length > 0) {
            this._waiters.shift()!({done: false, value});
            return;
        }
        this._queue.push(value);
    }

    close() {
        this._done = true;
        for (const w of this._waiters) {
            w({done: true, value: undefined});
        }
        this._waiters = [];
        if (this.onClose) this.onClose();
    }

    // Receiving
    [Symbol.asyncIterator]() { return this; }

    next(): Promise<IteratorResult<V>> {
        return new Promise((resolve, reject) => {
            if (this._queue.length > 0) {
                resolve({done: false, value: this._queue.shift()!});
                return;
            }

            if (this._done) {
                resolve({done: true, value: undefined});
                return;
            }

            this._waiters.push(resolve);
        });
    }
}

// Maps and filters an array at the same time, removing `undefined`s
export function filterMap<T, U>(array: T[], map: (i: T) => U | undefined): U[] {
    const res = [];
    for (const i of array) {
        const m = map(i);
        if (m !== undefined) res.push(m);
    }
    return res;
}

// Returns a text-matcher function, taking a user search string as input (which
// may or may not be a regex, and is generally case-insensitive).
export function textMatcher(query: string): (txt: string) => boolean {
    if (query === '') return txt => true;
    try {
        const re = new RegExp(query, 'iu');
        return txt => re.test(txt);
    } catch (e) {
        const lower = query.normalize().toLocaleLowerCase();
        return txt => txt.normalize().toLocaleLowerCase().includes(lower);
    }
}

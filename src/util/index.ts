// Things which are not specific to Tab Stash or browser functionality go here.

export {
    TaskHandle, Task, TaskIterator,
    TaskMonitor, Progress, TaskCancelled,
} from './progress';

// AsyncReturnTypeOf is the return type of an `async function` (or Promise). So:
//
// AsyncReturnTypeOf<(...) => Promise<T>> == T
//
// It comes from a slight modification of the "Advanced Types" section of the
// TypeScript docs.
export type AsyncReturnTypeOf<T extends (...args: any) => any> =
    ReturnType<T> extends Promise<infer U> ? U : void;

export type Promised<T> = T extends Promise<infer V> ? V : T;

// A "marker" type for a string which is a URL that is actually openable by Tab
// Stash (see urlToOpen below).  (The __openable_url_marker__ property doesn't
// actually exist, it's just used to force an explicit cast so you can't use a
// string when you should be using a URL that has passed thru urlToOpen().)
export type OpenableURL = string & { __openable_url_marker__: undefined };


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
export const altKeyName = () => PLATFORM_INFO.os === 'mac' ? 'Option' : 'Alt';
export const bgKeyName = () => PLATFORM_INFO.os === 'mac' ? 'Cmd' : 'Ctrl';

export const bgKeyPressed = (ev: KeyboardEvent | MouseEvent) =>
    PLATFORM_INFO.os === 'mac' ? ev.metaKey : ev.ctrlKey;

export function cmpVersions(a: string, b: string): number {
    let va: number[] = a.split('.').map((x: string) => parseInt(x));
    let vb: number[] = b.split('.').map((x: string) => parseInt(x));
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

export function urlsInTree(
    bm_tree: browser.bookmarks.BookmarkTreeNode
): OpenableURL[] {
    let urls: OpenableURL[] = [];
    function collect(bm: browser.bookmarks.BookmarkTreeNode) {
        if (bm.children) {
            for (let c of bm.children) collect(c);
        } else if (bm.url) {
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
        let url = new URL(urlstr);
        if (url.protocol === 'about:' && url.pathname === 'reader') {
            let res = url.searchParams.get('url');
            if (! res) return urlstr as OpenableURL;
            return (res + url.hash) as OpenableURL;
        }
        return urlstr as OpenableURL;
    } catch (_) {
        return urlstr as OpenableURL;
    }
}



export function asyncEvent<
    U,
    T extends (this: U, ...args: any[]) => Promise<any>
>(
    async_fn: T
): T {
    return function(this: U, ...args: any[]): Promise<any> {
        return async_fn.apply(this, args).catch(console.log);
    } as T;
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
    let next: Promise<any> | undefined;
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



// An AsyncIterator which yields values that are provided to it as soon as they
// are available.  Values can be sent with send(), and close() must be called to
// stop iteration.
export class AsyncChannel<V> implements AsyncIterableIterator<V> {
    // INVARIANT: Either _queue OR _waiters can have items, but never both at
    // the same time.
    private _queue: V[] = [];
    private _waiters: ((res: IteratorResult<V>) => void)[] = [];
    private _done: boolean = false;

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

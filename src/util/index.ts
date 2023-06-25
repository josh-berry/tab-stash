// Things which are not specific to Tab Stash or browser functionality go here.
import * as Vue from "vue";
import browser from "webextension-polyfill";
import {logErrorsFrom} from "./oops";

export {
  TaskCancelled,
  TaskMonitor,
  type Progress,
  type Task,
  type TaskHandle,
  type TaskIterator,
} from "./progress";

export type Atom = null | boolean | number | string;

/** A value that's convertible to JSON without losing information. */
export type ToJSON = Atom | {[k: string]: ToJSON} | [...ToJSON[]] | ToJSON[];

// Args is the arguments of a function
export type Args<F extends Function> = F extends (...args: infer A) => any
  ? A
  : never;

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
export type OpenableURL = string & {__openable_url_marker__: undefined};

// Where do we redirect the user if they try to open a privileged URL?
const REDIR_PAGE = browser.runtime.getURL("restore.html");
export const REDIR_URL_TESTONLY = REDIR_PAGE;

// Ugh, stupid hack for the fact that getting stuff from the browser that should
// be a compiled-in set of constants is actually done through an async API...
//
// This is f*king racy and gross, but there's nothing we can do here since the
// browser doesn't give us a way to block on a Promise (understandably so, since
// that would raise a whole host of other reentrancy issues that most developers
// probably don't want to deal with...).
let PLATFORM_INFO = {
  os: "unknown",
  arch: "unknown",
};
browser.runtime.getPlatformInfo().then(x => {
  PLATFORM_INFO = x;
});
// istanbul ignore next
export const altKeyName = () => (PLATFORM_INFO.os === "mac" ? "Option" : "Alt");
// istanbul ignore next
export const bgKeyName = () => (PLATFORM_INFO.os === "mac" ? "Cmd" : "Ctrl");

// istanbul ignore next
export const bgKeyPressed = (ev: KeyboardEvent | MouseEvent) =>
  PLATFORM_INFO.os === "mac" ? ev.metaKey : ev.ctrlKey;

/** Checks if its first argument is undefined.  If not, returns it.  If so,
 * throws an error with the message returned by the (optional) second
 * argument. */
export function expect<T>(value: T | undefined, err: () => string): T {
  // istanbul ignore else
  if (value !== undefined) return value;
  // istanbul ignore next
  throw new Error(err());
}

export const parseVersion = (v: string): number[] =>
  v.split(".").map(x => parseInt(x));

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

/** Like Vue's computed(), but it only triggers updates if the value has
 * actually changed.  "Changed" in this case means that `newValue !== oldValue`.
 * This is generally more efficient than using computed() for primitive
 * values--using it with objects/arrays is not recommended; it is likely to
 * perform strictly worse than computed(). */
export function computedLazyEq<T>(
  f: () => T,
  options?: Vue.WatchOptionsBase,
): Vue.Ref<T> {
  const ref: Vue.Ref<T> = Vue.ref(undefined!);
  Vue.watchEffect(() => {
    const newValue = f();
    if (ref.value !== newValue) ref.value = newValue;
  }, options);
  return ref;
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
      case "about:":
        switch (url.pathname) {
          case "blank":
          case "logo":
            break;
          case "reader":
            const res = url.searchParams.get("url");
            if (res) return (res + url.hash) as OpenableURL;
          default:
            return redirUrl(urlstr);
        }
        break;

      case "chrome:":
        // Chromium allows use of chrome:// URLs; Firefox doesn't (since
        // they're internal browser URLs). getBrowserInfo is a handy way
        // of checking if we're on Firefox (where it's present) or
        // Chromium (where it isn't).
        if (!browser.runtime.getBrowserInfo) break;
        return redirUrl(urlstr);

      case "javascript:":
      case "file:":
      case "data:":
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
  T extends (this: U, ...args: any[]) => Promise<any>,
>(async_fn: T): T {
  return function (this: U, ...args: any[]): Promise<any> {
    return async_fn.apply(this, args).catch(console.error);
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
  promises: T,
): Promise<{[k in keyof T]: Promised<T[k]>}> {
  const objects: any = {};

  for (const k of Object.getOwnPropertyNames(promises)) {
    const p = promises[k];
    objects[k] = p instanceof Promise ? await p : p;
  }

  return objects;
}

/** Arranges for a function to be called "later" (after queued events have been
 * processed but without any further delay, if possible).
 *
 * In Node, setImmediate() is more efficient because setTimeout() always takes
 * at least 1ms.  But in the browser, there is no setImmediate() and
 * setTimeout() can take 0ms (unless you call it too much.
 *
 * References:
 * - https://developer.mozilla.org/en-US/docs/Web/API/setTimeout
 * - https://nodejs.org/dist/latest-v16.x/docs/api/timers.html#setimmediatecallback-args
 */
export const later: <F extends () => any>(f: F) => void =
  (<any>globalThis).setImmediate ?? globalThis.setTimeout;

/** Waits for the next iteration of the event loop and for Vue to flush any
 * pending watches (allowing event handlers etc. to run in the meantime). */
export async function nextTick(): Promise<void> {
  // We FIRST wait for the event loop, which may deliver outside events that
  // percolate through to Vue reactive objects.
  await new Promise<void>(resolve => later(resolve));

  // Only once we've drained the event loop do we then wait for Vue to catch
  // up and apply any changes.
  await Vue.nextTick.apply(undefined);
}

/** Calls `fn()` repeatedly for up to "a few" repetitions until `fn()` returns
 * without throwing `TRY_AGAIN`.  "A few" is implementation-dependent but is
 * guaranteed to be (approximately) less than 10ms.
 *
 * If the function does not return a value within a reasonable amount of time,
 * throws {@link TimedOutError}.  */
export async function shortPoll<T>(fn: () => T): Promise<T> {
  // Relies on the implicit behavior of setTimeout() being automatically
  // delayed--see "Nested timeouts" from:
  // https://developer.mozilla.org/en-US/docs/Web/API/setTimeout

  const start = Date.now();
  while (Date.now() - start < 10) {
    try {
      return fn();
    } catch (e) {
      if (e !== TRY_AGAIN) throw e;
    }
    await nextTick();
  }
  throw new TimedOutError();
}

/** The exception to throw to get {@link shortPoll()} to try again. */
const TRY_AGAIN: unique symbol = Symbol("TRY_AGAIN");

/** Call this during {@link shortPoll()} to make shortPoll() try again. */
export function tryAgain(): never {
  throw TRY_AGAIN;
}

/** The exception thrown by {@link shortPoll()} if we give up polling and the
 * function never returned a value. */
export class TimedOutError extends Error {
  constructor() {
    super("Timed out");
  }
}

/** A queue of async functions which must be run in order. */
export class AsyncTaskQueue {
  private readonly _queue: {
    fn: () => Promise<unknown>;
    resolve: (r: unknown) => void;
    reject: (e: unknown) => void;
    promise: Promise<void>;
  }[] = [];

  /** Returns the length of the queue.  The first element in the queue is always
   * the element that is currently running. */
  get length() {
    return this._queue.length;
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    let resolve: (_: unknown) => void;
    let reject: (_: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res as (_: unknown) => void;
      reject = rej;
    });
    this._queue.push({
      fn,
      resolve: resolve!,
      reject: reject!,
      promise: promise.then(),
    });
    if (this._queue.length === 1) this._run();
    return promise;
  }

  drain(): Promise<void> {
    if (this._queue.length === 0) return Promise.resolve();
    return this._queue[this._queue.length - 1].promise;
  }

  private _run() {
    const next = this._queue[0];
    if (!next) return;

    logErrorsFrom(async () => {
      try {
        const r = await next.fn();
        next.resolve(r);
      } catch (e) {
        next.reject(e);
        throw e;
      } finally {
        this._queue.shift();
        this._run();
      }
    });
  }
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
export function nonReentrant(fn: () => Promise<void>): () => Promise<void> {
  const q = new AsyncTaskQueue();

  return () => {
    // There should be one running, and at most one pending call.
    if (q.length < 2) q.run(fn);
    return q.drain();
  };
}

/** Wraps the passed-in async function so that only one call can be running at a
 * time, and if multiple calls are made within a short time, later calls are
 * deferred for some exponentially-increasing delay.  The delay is (by default)
 * reset after no calls have been made for some idle period.
 *
 * This is useful in situations such as expensive event-handling code, where the
 * event handler can make good use of batching/processing of multiple changes at
 * once, but events are delivered one at a time. */
export function backingOff(
  fn: () => Promise<void>,
  options: BackingOffOptions = {
    max_delay_ms: 60000,
    first_delay_ms: 100,
    exponent: 2,
    reset_after_idle_ms: 300000,
  },
): () => Promise<void> {
  let last_finished = Date.now();
  let retry_count = 0;

  return nonReentrant(async () => {
    const now = Date.now();
    const elapsed = now - last_finished;

    if (
      options.reset_after_idle_ms !== undefined &&
      elapsed > options.reset_after_idle_ms
    ) {
      retry_count = 0;
    }

    const delay = Math.min(
      options.max_delay_ms,
      options.first_delay_ms * retry_count ** options.exponent,
    );

    if (elapsed < delay) {
      await new Promise(r => setTimeout(r, delay - elapsed));
    }

    try {
      return await fn();
    } finally {
      ++retry_count;
      last_finished = Date.now();
    }
  });
}

export type BackingOffOptions = {
  max_delay_ms: number;
  first_delay_ms: number;
  exponent: number;
  reset_after_idle_ms?: number;
};

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
  [Symbol.asyncIterator]() {
    return this;
  }

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
export function filterMap<T, U>(
  array: readonly T[],
  map: (i: T) => U | undefined,
): U[] {
  const res = [];
  for (const i of array) {
    const m = map(i);
    if (m !== undefined) res.push(m);
  }
  return res;
}

/** Given an iterator, return values from that iterator grouped in batches of up
 * to `size`. */
export function batchesOf<I>(
  size: number,
  iter: Iterator<I>,
): IterableIterator<I[]> {
  return {
    [Symbol.iterator]() {
      return this;
    },
    next(): IteratorResult<I[]> {
      const value = [];
      while (value.length < size) {
        const r = iter.next();
        if (r.done) break;
        value.push(r.value);
      }
      return {done: value.length === 0, value};
    },
  };
}

// Returns a text-matcher function, taking a user search string as input (which
// may or may not be a regex, and is generally case-insensitive).
export function textMatcher(query: string): (txt: string) => boolean {
  if (query === "") return txt => true;
  try {
    const re = new RegExp(query, "iu");
    return txt => re.test(txt);
  } catch (e) {
    const lower = query.normalize().toLocaleLowerCase();
    return txt => txt.normalize().toLocaleLowerCase().includes(lower);
  }
}

/** Add a delimiter in between each item in an array. For example:
 * `delimit(0, [1, 2, 3]) => [1, 0, 2, 0, 3]` */
export function delimit<T>(delimiter: () => T, array: T[]): T[] {
  if (array.length === 0) return [];
  const res = [array[0]];
  for (let i = 1; i < array.length; ++i) {
    res.push(delimiter());
    res.push(array[i]);
  }
  return res;
}

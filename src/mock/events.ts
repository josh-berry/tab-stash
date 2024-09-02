/**
 * A mock event system.
 *
 * Unlike a regular event system, by default, events which are sent are not
 * dispatched immediately, but are instead queued until a "watcher" matches the
 * event.  When an event matches a watcher, AND the watcher is actively waiting
 * for an event, the event will be dispatched and returned to the watcher.
 *
 * When combined with the property that every event is observed exactly once by
 * exactly one watcher, this provides a guarantee that a unit test will see
 * every event fired during the test exactly once, and can validate that events
 * are firing as desired.
 *
 * It also provides a way to observe events by emitting them to console.log()
 * both when they are sent and when they are delivered.
 */

import type {Event, EventSource} from "../util/event.js";
import type {Args} from "../util/index.js";

/* c8 ignore next -- for debugging on a bug only */
const inspect: (v: any, options?: {depth: number}) => string = (v: any) =>
  JSON.stringify(v, undefined, 4);

/* c8 ignore start -- platform-specific choice of impl */
// This is duplicated from ../util because we can't afford to load all of
// ../util yet--that will pull in webextension-polyfill and we can't do that
// until the mock event system is set up.
const later: <F extends () => any>(f: F) => void =
  (<any>globalThis).setImmediate ?? globalThis.setTimeout;
/* c8 ignore stop */

type EventSystemState = {
  verbose: boolean;
  waiters: Set<Waiter>;
  ignores: Set<(msg: EvMessage) => boolean>;
  awaited_messages: Set<EvMessage>;
  runner: Promise<void> | null;
};

type EvMessage = {
  event: AnyMockEvent;
  args: any[];
  fire: (ignored?: boolean) => void;
};
type AnyMockEvent = MockEvent<AnyListener>;
type AnyListener = (...args: any[]) => any;

type Waiter = {
  query: EventQuery<any>;
  filter: (ev: EvMessage) => boolean;
  callback: (ev: EvMessage) => void;
};

type EventQuery<L extends AnyListener> =
  | undefined
  | string
  | EventSource<L>
  | EventQuery<L>[];

let the_state: EventSystemState;
beforeTest();

export function beforeTest() {
  the_state = {
    verbose: false,
    waiters: new Set(),
    ignores: new Set(),
    awaited_messages: new Set(),
    runner: null,
  };
}

/* c8 ignore start -- bug-checking code */
export async function afterTest() {
  // Drain ignored messages so we don't complain about them
  for (const msg of the_state.awaited_messages) {
    for (const ignore of the_state.ignores) {
      if (ignore(msg)) {
        the_state.awaited_messages.delete(msg);
        msg.fire(true);
        break;
      }
    }
  }

  if (the_state.waiters.size > 0 || the_state.awaited_messages.size > 0) {
    const i = (val: any) => inspect(val, {depth: 5});

    let oops = `Test finished before all events were processed.\n\n`;
    oops += `Waiters: ${i(format_waiters(the_state))}\n\n`;
    oops += `Pending Events: ${i(format_awaited_messages(the_state))}`;
    throw new Error(oops);
  }
}
/* c8 ignore stop */

/** Returns a count of pending/undelivered events (excluding ignored events). */
export function pendingCount(): number {
  return the_state.awaited_messages.size;
}

/* c8 ignore start -- for manual debugging */
/** Enable or disable logging of events to the console (including stack traces
 * of where events were sent).  This can get very slow and verbose, so it's wise
 * to use it only where needed.
 *
 * Ignored events are never traced. */
export function trace(t: boolean) {
  the_state.verbose = t;
}
/* c8 ignore stop */

/** A mock event delivery mechanism which conforms to util/event. */
export class MockEvent<L extends AnyListener> implements Event<L> {
  readonly state: EventSystemState;
  readonly name: string;
  readonly instance?: string;

  private _listeners: Set<L> = new Set();

  constructor(name: string, instance?: string) {
    this.state = the_state;
    this.name = name;
    this.instance = instance;
  }

  addListener(l: L) {
    this._listeners.add(l);
  }
  removeListener(l: L) {
    this._listeners.delete(l);
  }

  /* c8 ignore start -- impls for interface conformance only */
  hasListener(l: L) {
    return this._listeners.has(l);
  }

  hasListeners() {
    return this._listeners.size > 0;
  }
  /* c8 ignore stop */

  send(...args: Args<L>) {
    const msg: EvMessage = {
      event: this,
      args: args,
      fire(ignored?: boolean) {
        /* c8 ignore start */ if (!ignored && the_state.verbose) {
          console.log(
            `[deliver ${this.event.name}/${this.event.instance}] `,
            ...args,
          );
        } /* c8 ignore stop */

        for (const fn of this.event._listeners) fn(...args);
      },
    };

    this.state.awaited_messages.add(msg);
    run(this.state);

    /* c8 ignore start */ if (this.state.verbose) {
      try {
        throw new Error("Stack trace");
      } catch (e) {
        console.log(`[send ${this.name}/${this.instance}]`, ...args);
        console.log((e as Error).stack);
      }
    } /* c8 ignore stop */
  }
}

(<any>globalThis).MockEvent = MockEvent;

/** Watches for and returns events which match a particular query. */
export class EventWatcher<L extends AnyListener = AnyListener> {
  readonly state: EventSystemState;
  readonly query: EventQuery<L>;
  readonly filter: (ev: EvMessage) => boolean;

  constructor(q?: EventQuery<L>) {
    this.state = the_state;
    this.query = q;
    this.filter = filter_for(q);
  }

  /** Returns the next event which matches the query.  If no such event has
   * been fired or queued yet, waits for such an event to arrive. */
  next(): Promise<Args<L>> {
    return new Promise(resolve => {
      /* c8 ignore next 3 -- checking for bugs */
      if (the_state !== this.state) {
        throw new Error(`Can't watch for events after the test has finished`);
      }
      const waiter: Waiter = {
        query: this.query,
        filter: this.filter,
        callback: msg => {
          this.state.waiters.delete(waiter);
          resolve(msg.args as Args<L>);
        },
      };
      this.state.waiters.add(waiter);
      run(this.state);
    });
  }

  /** Watch for and return all events matching the query, until the event loop
   * has completed at least one full cycle. */
  untilNextTick(): Promise<Args<L>[]> {
    return new Promise(resolve => {
      /* c8 ignore next 3 -- checking for bugs */
      if (the_state !== this.state) {
        throw new Error(`Can't watch for events after the test has finished`);
      }
      const events: Args<L>[] = [];
      const waiter: Waiter = {
        query: this.query,
        filter: this.filter,
        callback: msg => {
          events.push(msg.args as Args<L>);
        },
      };
      this.state.waiters.add(waiter);

      later(() => {
        run(this.state);
        later(() => {
          this.state.waiters.delete(waiter);
          resolve(events);
        });
      });
    });
  }
}

/** Construct and return a watcher for a particular query. */
export function watch<L extends AnyListener>(
  q?: EventQuery<L>,
): EventWatcher<L> {
  return new EventWatcher(q);
}

/** Watch for and return the next event which matches the query. */
export function next<L extends AnyListener>(
  q?: EventQuery<L>,
): Promise<Args<L>> {
  return watch(q).next();
}

/** Watch for and return an array of precisely `count` events which match the
 * query. */
export async function nextN<L extends AnyListener>(
  q: EventQuery<L>,
  count: number,
): Promise<Args<L>[]> {
  const w = watch(q);
  const res = [];
  for (let i = 0; i < count; ++i) res.push(await w.next());
  return res;
}

/** Ignore events matching the query until the test completes or the ignore is
 * cancelled. Ignores take precedence over watchers.  If an event is ignored, a
 * watcher will never match it, even if the event would otherwise match both
 * queries. */
export function ignore(q: EventQuery<any>): {cancel(): void} {
  const filter = filter_for(q);
  the_state.ignores.add(filter);
  run(the_state);

  return {
    /* c8 ignore next 3 -- optional for test use*/
    cancel() {
      the_state.ignores.delete(filter);
    },
  };
}

/** Helper to artificially inject an event in a particular MockEvent.  Checks at
 * runtime that the passed-in event is actually a MockEvent and throws if not.
 *
 * Note that you must still wait for the event to be delivered like normal.
 */
export function send<L extends AnyListener>(
  ev: EventSource<L>,
  ...args: Args<L>
) {
  /* c8 ignore next -- bug-checking */
  if (!(ev instanceof MockEvent)) throw new Error(`This event is not mocked`);
  ev.send(...args);
}

//
// Helpers
//

function run(state: EventSystemState) {
  if (state.runner) return;
  state.runner = new Promise(resolve => {
    later(() => {
      state.runner = null;
      runner(state);
      resolve();
    });
  });
}

function runner(state: EventSystemState) {
  for (const msg of state.awaited_messages) {
    for (const ignore of state.ignores) {
      if (ignore(msg)) {
        state.awaited_messages.delete(msg);
        msg.fire(true);
        break;
      }
    }
    for (const waiter of state.waiters) {
      if (waiter.filter(msg)) {
        state.awaited_messages.delete(msg);
        msg.fire();
        waiter.callback(msg);
        break;
      }
    }
  }
}

function filter_for(q: EventQuery<any>): (ev: EvMessage) => boolean {
  if (q instanceof Array) {
    const filters = q.map(filter_for);
    return ev => filters.some(f => f(ev));
  } else if (typeof q === "string") {
    return ev => ev.event.name === q;
  } else if (q === undefined) {
    return _ => true;
  } else if (q instanceof MockEvent) {
    return ev => ev.event === q;
  } /* c8 ignore start -- bug-checking */ else {
    throw new Error(`Invalid event query: ${inspect(q)}`);
  }
  /* c8 ignore stop */
}

/* c8 ignore start -- for manual debugging only */
function format_waiters(state: EventSystemState): any {
  return Array.from(state.waiters).map(w => format_query(w.query));
}

function format_awaited_messages(state: EventSystemState): any {
  return Array.from(state.awaited_messages).map(msg => ({
    event: `${msg.event.name}/${msg.event.instance}`,
    args: msg.args,
  }));
}

function format_query(q: EventQuery<any>): any {
  if (q instanceof Array) return q.map(q => format_query(q));
  if (q instanceof MockEvent) return {event: `${q.name}/${q.instance}`};
  return q;
}
/* c8 ignore stop */

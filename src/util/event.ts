import type {Events} from 'webextension-polyfill';

import type {Args} from '.';

export type EventSource<L extends (...args: any[]) => any> = Events.Event<L>;

/** An event.  Events have listeners which are managed through the usual
 * add/has/removeListener() methods.  A message can be broadcast to all
 * listeners using the send() method. */
export interface Event<L extends (...args: any[]) => any> extends EventSource<L> {
    /** Send a message to all listeners.  send() will arrange for each listener
     * to be called with the arguments provided after send() returns. */
    send(...args: Args<L>): void;
}



let eventClass: {new(name: string, instance?: string): Event<any>};

if ((<any>globalThis).mock?.events) {
    // We are running in a mock environment.  Use the MockEventDispatcher
    // instead, which allows for snooping on events.
    eventClass = require('../mock/events').MockEvent;

} else {
    eventClass = class Event<L extends (...args: any[]) => any>
        implements Event<L>
    {
        private _listeners: Set<L> = new Set();

        addListener(l: L) { this._listeners.add(l); }

        // istanbul ignore next
        removeListener(l: L) { this._listeners.delete(l); }

        // istanbul ignore next
        hasListener(l: L) { return this._listeners.has(l); }

        // istanbul ignore next
        hasListeners() { return this._listeners.size > 0; }

        send(...args: Args<L>) {
            // This executes more quickly than setTimeout(), which is what we
            // want since setTimeout() is often used to wait for events to be
            // delivered (and immediate timeouts are not always run in the order
            // they are scheduled...).
            Promise.resolve().then(() => this.sendSync(...args));
        }

        private sendSync(...args: Args<L>) {
            for (const fn of this._listeners) fn(...args);
        }
    }
}

/** Constructs and returns an event.  In unit tests, this is a mock which must
 * be explicitly controlled by the calling test. */
export default function <L extends (...args: any[]) => any>(
    name: string, instance?: string
): Event<L> {
    return new eventClass(name, instance);
};

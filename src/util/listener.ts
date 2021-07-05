import {Events} from 'webextension-polyfill-ts';

import {Args} from '.';

export default class Listener<L extends Function> implements Events.Event<L> {
    private _listeners: Set<L> = new Set();

    addListener(l: L) { this._listeners.add(l); }

    // istanbul ignore next
    removeListener(l: L) { this._listeners.delete(l); }

    // istanbul ignore next
    hasListener(l: L) { return this._listeners.has(l); }

    // istanbul ignore next
    hasListeners() { return this._listeners.size > 0; }

    send(...args: Args<L>) {
        setTimeout(() => this.sendSync(...args));
    }

    sendSync(...args: Args<L>) {
        for (const fn of this._listeners) fn(...args);
    }
}

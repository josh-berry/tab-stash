import {Args} from '.';

export default class Listener<L extends Function> implements EvListener<L> {
    private _listeners: Set<L> = new Set();

    addListener(l: L) { this._listeners.add(l); }
    removeListener(l: L) { this._listeners.delete(l); }
    hasListener(l: L) { return this._listeners.has(l); }

    send(...args: Args<L>) {
        for (const fn of this._listeners) setTimeout(fn, undefined, ...args);
    }
}

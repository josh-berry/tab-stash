import {Events} from 'webextension-polyfill-ts';

import {expect} from 'chai';
import {beforeEach, afterEach} from 'mocha';
import {Args} from '../util';

let verbose = false;

let queue: (() => void)[] = [];
let resolve: (() => void) | undefined;
let reject: ((e: Error) => void) | undefined;
let requested_count: number = 0;
let delivered_count: number = 0;

beforeEach(() => {
    queue = [];
    resolve = undefined;
    reject = undefined;
    requested_count = 0;
    delivered_count = 0;
});
afterEach(expect_empty);

export class MockEventDispatcher<L extends Function> implements Events.Event<L> {
    name: string;
    _listeners: Set<L> = new Set();

    constructor(name: string) {
        this.name = name;
    }

    addListener(l: L) {
        expect(l).to.be.a('function');
        this._listeners.add(l);
    }

    removeListener(l: L) {
        expect(l).to.be.a('function');
        this._listeners.delete(l);
    }

    // istanbul ignore next - implemented only for interface conformance
    hasListener(l: L) { return this._listeners.has(l); }

    // istanbul ignore next - implemented only for interface conformance
    hasListeners() { return this._listeners.size > 0; }

    send(...args: Args<L>) {
        // istanbul ignore if
        if (verbose) {
            try {
                throw new Error("Stack trace");
            } catch (e) {
                console.log(`[send ${this.name}]`, ...args);
                console.log((e as Error).stack);
            }
        }

        queue.push(() => {
            // istanbul ignore next
            if (verbose) console.log(`[deliver ${this.name}] `, ...args);
            for (const fn of this._listeners) fn(...args);
        });
        if (resolve) setImmediate(deliver);
    }
}

export function drain(count: number): Promise<void> {
    // istanbul ignore next
    if (resolve || reject) {
        throw new Error(`Tried to call drain() re-entrantly`);
    }
    expect(requested_count, `requested_count`).to.equal(0);
    expect(delivered_count, `delivered_count`).to.equal(0);

    // istanbul ignore next
    if (verbose) console.log(`Draining ${count} events`);

    return new Promise((res, rej) => {
        requested_count = count;
        resolve = res;
        reject = rej;

        // istanbul ignore else
        if (queue.length > 0) setImmediate(deliver);
    });
}

export async function waitOne<L extends (...args: any[]) => void, R>(
    trigger: () => Promise<R>,
    event: Events.Event<L>,
    listener?: L,
    drainCount?: number,
): Promise<[R, Args<L>]> {
    let resolved = false;
    let ev: Args<L> | undefined;

    const wrapped: L = ((...args: Args<L>) => {
        ev = args;
        event.removeListener(wrapped);
        resolved = true;
        if (listener) listener(...args);
    }) as L;
    event.addListener(wrapped);

    const p = trigger();
    await drain(drainCount ?? 1);
    const value = await p;
    expect(resolved).to.be.true;
    return [value, ev!];
}

export function expect_empty() {
    expect(resolve, `event waiter (resolve)`).to.be.undefined;
    expect(reject, `event waiter (reject)`).to.be.undefined;
    expect(requested_count, `requested events count`).to.equal(0);
    expect(delivered_count, `delivered events count`).to.equal(0);
    expect(queue.length, `event queue length`).to.equal(0);
}

export function trace(t: boolean) {
    verbose = t;
}

function deliver() {
    // istanbul ignore if
    if (verbose) console.log(`Swapping queue`);

    const q = queue;
    queue = [];

    for (const fn of q) fn();
    delivered_count += q.length;

    if (resolve && reject && delivered_count >= requested_count) {
        // istanbul ignore if
        if (delivered_count > requested_count) {
            reject(new Error(`Delivered ${delivered_count} events, but expected only ${requested_count} events`));
            delivered_count -= requested_count;
        } else {
            delivered_count = 0;
            resolve();
        }

        requested_count = 0;
        resolve = undefined;
        reject = undefined;
    }
}

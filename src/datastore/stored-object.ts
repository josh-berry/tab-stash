// A strongly-schema'd wrapper around browser.storage.  Each key in storage is a
// JS object which follows a particular schema, and is represented by a
// StoredObject.  The StoredObject is automatically updated whenever the key is
// changed, either via this module or some other mechanism.
//
// The properties of a StoredObject must be predefined, with a default value
// provided for each property.  Values must be scalar values (undefined, null,
// booleans, numbers and strings)--nested objects are not supported.
//
//     const def = {
//         a: {default: 0, is: aNumber},
//         b: {default: 0, is: aNumber},
//     };
//     const obj = await StoredObject.local('foo', def);
//     assert(obj.state.a === 0);
//     assert(obj.state.b === 0);
//
// To update a property, DO NOT ASSIGN DIRECTLY TO THE PROPERTY.  Use the set()
// method instead, which can update or reset multiple properties at once by
// passing an object like so:
//
//     await obj.set({a: 1, b: 2});
//     assert(obj.state.a === 1);
//     assert(obj.state.b === 2);
//
// You can also delete the stored object from the browser store entirely:
//
//     await obj.delete();

import {browser} from 'webextension-polyfill-ts';
import Vue from 'vue';

// Here's how to define the type of a StoredObject:
export interface StorableDef {
    [k: string]: {
        // Each property has a default value...
        default: StorableValue,
        // ...and a type.
        is: StorableType,
    },
};

// Allowed types (for each "is" property in the map above) are based on MDN's
// documentation (and experimentation with Firefox).
type StorableValue = undefined | null | boolean | number | string | StorableValue[];

// Storable types are set in the "is" property of a StorableDef, and are
// expressed as functions which convert from arbitrary/undefined values the
// desired type.
type StorableType = (value: any) => StorableValue;

// Here are the basic types (boolean, string, etc.).  We don't define types for
// undefined/null right now because they're not very useful on their own.
export const aBoolean =
    (value: any): boolean => {
        switch (value) {
            case 1: case true: return true;
            case 0: case false: return false;
        }
        switch (value.toString().toLowerCase()) {
            case 'false': case 'no': return false;
            case 'true': case 'yes': return true;
            default:
                throw new TypeError(`Not a boolean: ${value}`);
        }
    };
export const aNumber =
    (value: any): number => {
        const res = Number(value);
        if (Number.isNaN(res)) throw new TypeError(`Not a number: ${value}`);
        return res;
    };

export const aString =
    (value: any): string => value.toString();

// However, it IS possible to have "some other type OR undefined/null".  For
// example: maybeUndef(aNumber) is equivalent to number | undefined.
export const maybeUndef = <V extends StorableValue>(converter: (v: any) => V) =>
    (value: any): V | undefined => {
        switch (value) {
            case undefined: case null: case '': return undefined;
            default: return converter(value);
        }
    };

export const maybeNull = <V extends StorableValue>(converter: (v: any) => V) =>
    (value: any): V | null => {
        switch (value) {
            case undefined: case null: case '': return null;
            default: return converter(value);
        }
    };

// Enum values are also supported, for example anEnum('a', 'b') is the same type
// as 'a' | 'b'.
export const anEnum = <V extends string | number>(...cases: V[]) =>
    (value: any): V => {
        if (cases.includes(value.toString())) return value;
        throw new TypeError(`${value}: Not a valid enum value, expected ${cases}`);
    };



//
// The StoredObject itself.
//

// You can create or load StoredObjects by calling one of the factory functions
// and passing it the key of the specific object you're interested in, along
// with a structure defining the type of the StoredObject (described below).
//
// NOTE: Take care that you do not try to load the same key with different
// schemas in your program.  This is not allowed.
export default class StoredObject<D extends StorableDef> {
    // Read-only data properties as defined in your schema (named `state` to
    // follow Vue model conventions).
    readonly state: StorableData<D>;

    // sync is for browser-synced storage.  This is generally very small but is
    // persisted across all of a user's computers.  `def` is the schema to use
    // for this object.
    static sync<D extends StorableDef>(key: string, def: D): Promise<StoredObject<D>> {
        return StoredObject._factory('sync', key, def);
    }

    // local is for browser-local storage.  It's much larger, but not synced.
    static local<D extends StorableDef>(key: string, def: D): Promise<StoredObject<D>> {
        return StoredObject._factory('local', key, def);
    }

    async set(values: Partial<StorableData<D>>): Promise<void> {
        // Make sure we have an updated set of stuff first.
        await this._animate();

        // The object we will save to the store.  Values which are the default
        // should be omitted to save space (and allow defaults to
        // programmatically change later).
        const data: Partial<StorableData<D>> = {};

        for (const k in this._def) {
            // Carry forward existing values that are non-default and not
            // explicitly specified in /values/.
            if (! (k in values)) {
                if (this.state[k] !== this._def[k].default) {
                    data[k] = this.state[k];
                }
                continue;
            }

            const v = this._def[k].is(values[k]);

            // If /values/ explicitly specifies that /k/ should be the default
            // value, omit it from the saved object entirely.
            if (v === this._def[k].default) continue;

            // Otherwise, store it.
            (<any>data)[k] = v;
        }

        return await browser.storage[this._store].set({[this._key]: data});
    }

    async delete(): Promise<void> {
        // The following may or may not trigger a browser.storage.onChanged
        // event.  if it doesn't (e.g. because the object never existed), we
        // have to forget about the object manually.
        StoredObject._LIVE[this._store].delete(this._key);
        return browser.storage[this._store].remove(this._key);
    }

    //
    // Private implementation details
    //

    // The set of objects we are currently trying to load.  We keep track of
    // this set because objects can be loaded in one of two ways--either through
    // _animate(), which queries browser.storage explicitly, or by receiving an
    // event saying the object has been changed or deleted.
    //
    // In the latter case, the event has more up-to-date information than
    // browser.storage, so we populate the object from the event and remove it
    // from /_LOADING/.  Then, when browser.storage.*.get() returns, we check to
    // see if the object has already been loaded by an event, by looking to see
    // if it's still in this set.
    //
    // The value of the map is a Promise which resolves once the object is
    // loaded.
    static readonly _LOADING = new WeakMap<StoredObject<any>, Promise<void>>();

    // _LIVE is a simple set of maps as defined at the end of this expression,
    // which holds StoredObjects and keeps them up to date.  This magic is
    // accomplished by an immediately-invoked initializing lambda expression
    // (IIILE, thank you C++) since it cannot be otherwise accessed by a handler
    // defined outside of the class.
    static readonly _LIVE = (() => {
        browser.storage.onChanged.addListener((changes, area) => {
            if (area !== 'sync' && area !== 'local') return;
            const areaobjs = StoredObject._LIVE[area as 'sync' | 'local'];

            for (const key in changes) {
                const obj = areaobjs.get(key);
                if (! obj) continue;

                if ('newValue' in changes[key]) {
                    obj._load(changes[key].newValue);

                } else {
                    // Key was removed from the store entirely.  Reset it to
                    // defaults, and drop it from LIVE_OBJECTS on the assumption
                    // the callers don't want it, either.
                    obj._load({});
                    areaobjs.delete(key);
                }

                // If anyone was waiting on this object, it's now loaded.  (A
                // browser.storage event will fire for this eventually, which
                // will actually complete the loading, but the data will already
                // be there, so we can just drop it.)
                StoredObject._LOADING.delete(obj);
            }
        });

        return {
            sync: new Map<string, StoredObject<any>>(),
            local: new Map<string, StoredObject<any>>(),

            // Ugh, we never drop StoredObjects from here unless they are
            // deleted.  This is gross from a memory-use perspective, but
            // there's not much we can do here because the alternative is to
            // register one browser.storage.onChanged listener per StoredObject,
            // which is O(N^2).
            //
            // Have I mentioned recently how much I hate JavaScript's lack of
            // memory-management facilities? :/
        };
    })();

    private static async _factory<D extends StorableDef>(
        store: 'sync' | 'local',
        key: string,
        def: D
    ): Promise<StoredObject<D>> {
        let object = StoredObject._LIVE[store].get(key);
        if (object) {
            if (object._def !== def) {
                throw new TypeError(`Tried to load '${key}' with a conflicting def`);
            }
            return object;
        }

        object = new StoredObject<D>(store, key, def);
        await object._animate();
        return object;
    }

    private readonly _store: 'sync' | 'local';
    private readonly _key: string;
    private readonly _def: D;

    private constructor(store: 'sync' | 'local', key: string, def: D) {
        // state must be pre-populated so Vue can observe it.
        const state: any = {};
        for (const k in def) state[k] = def[k].default;

        this.state = Vue.observable(state);
        this._store = store;
        this._key = key;
        this._def = def;
    }

    _animate(): Promise<void> {
        const liveobj = StoredObject._LIVE[this._store].get(this._key);
        if (liveobj) {
            if (liveobj !== this) {
                throw `Multiple objects exist for key: ${this._key}`;
            }

            const loading = StoredObject._LOADING.get(this);
            return loading ? loading : Promise.resolve();
        }

        StoredObject._LIVE[this._store].set(this._key, this);

        const p = browser.storage[this._store].get(this._key)
            .then(data => {
                // Object could have already been loaded due to an onChanged
                // event that fired between when we asked browser.storage for
                // the object and when browser.storage actually returned.
                // Prioritize the event over what browser.storage gave us
                // because it's most likely to be up to date.
                if (StoredObject._LOADING.has(this)) {
                    this._load(data[this._key]);
                    StoredObject._LOADING.delete(this);
                }
            });
        StoredObject._LOADING.set(this, p);
        return p;
    }

    _load(values: any) {
        // We assign both defaults and the new values here so that if any
        // properties were reset to the default (and removed from storage),
        // Vue will notice those as well.

        // The <any> casts in here are to get rid of `readonly`.  This method is
        // the ONLY place where getting rid of `readonly` is acceptable.
        for (const k in this._def) (<any>this.state)[k] = this._def[k].default;

        if (typeof values !== 'object') return;

        for (const k in values) {
            if (k in this._def) (<any>this.state)[k] = this._def[k].is(values[k]);
            // Otherwise keys not present in defaults are dropped/ignored.
        }
    }

};

export type StorableData<D extends StorableDef> = {
    readonly [k in keyof D]: ReturnType<D[k]['is']>;
};

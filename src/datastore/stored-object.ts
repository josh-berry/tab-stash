// A module to load and save JavaScript objects to/fron a particular key in
// browser-local storage, and to keep those JavaScript objects up to date
// automatically as browser-local storage changes.
//
// The properties must be predefined, with a default value provided for each
// property.  Values must be scalar values (undefined, null, booleans, numbers
// and strings)--nested objects are not supported.
//
//     const def = {
//         a: {default: 0, is: aNumber},
//         b: {default: 0, is: aNumber},
//     };
//     const obj = await StoredObject.local('foo', def);
//     assert(obj.a === 0);
//     assert(obj.b === 0);
//
// To update a property, DO NOT ASSIGN DIRECTLY TO THE PROPERTY.  Use the set()
// method instead, which can update or reset multiple properties at once by
// passing an object like so:
//
//     await obj.set({a: 1, b: 2});
//     assert(obj.a === 1);
//     assert(obj.b === 2);
//
// You can also delete the stored object from the browser store entirely:
//
//     await obj.delete();

// A StoredObject looks like this:
export type StoredObject<D extends StorableDef> =
    // It has read-only data properties as defined in your definition:
    StorableData<D> &
    // And methods, such as:
    {
        // A method to update multiple keys at once in the object
        set(values: Partial<StorableData<D>>): Promise<void>;

        // A method to delete the object entirely
        delete(): Promise<void>;
    };

// You can create or load StoredObjects by calling one of the factory functions
// and passing it the key of the specific object you're interested in, along
// with a structure defining the type of the StoredObject (described below).
//
// NOTE: Take care that you do not try to load the same key with different defs
// in your program.  This is not allowed.
export default {
    // sync is for browser-synced storage.  This is generally very small but is
    // persisted across all of a user's computers.
    sync<D extends StorableDef>(key: string, def: D): Promise<StoredObject<D>> {
        return _factory('sync', key, def);
    },

    // local is for browser-local storage.  It's much larger, but not synced.
    local<D extends StorableDef>(key: string, def: D): Promise<StoredObject<D>> {
        return _factory('local', key, def);
    },
};


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
// Implementation details below this point
//


// Storable data itself, given a definition (these are JUST the properties):
type StorableData<D extends StorableDef> = {
    readonly [k in keyof D]: ReturnType<D[k]['is']>;
};

// Internal data about a particular StoredObject
type MetaInfo<D extends StorableDef> = {
    store: 'sync' | 'local';
    key: string;
    def: D;
};

// Construct/retrieve StorableObjects
async function _factory<D extends StorableDef>(
    store: 'sync' | 'local',
    key: string,
    def: D
): Promise<StoredObject<D>> {
    let object = LIVE_OBJECTS[store].get(key);
    if (object) {
        const meta = META.get(object);
        if (meta?.def !== def) {
            throw new TypeError(`Tried to load object ${key} with a conflicting def`);
        }
        return object;
    }

    if ('set' in def) throw new TypeError(`The name 'set' is reserved`);
    if ('delete' in def) throw new TypeError(`The name 'delete' is reserved`);

    object = Object.create(base) as StoredObject<D>;
    const meta = {store, key, def};
    META.set(object, meta);

    await _animate(object, meta);
    return object;
}

const base = {
    async set<D extends StorableDef>(
        this: StoredObject<D>, values: Partial<StorableData<D>>
    ): Promise<void> {
        let meta = META.get(this)!;

        // Make sure we have an updated set of stuff first.
        await _animate(this, meta);

        // The object we will save to the store.  Values which are the default
        // should be omitted to save space (and allow defaults to
        // programmatically change later).
        let data: typeof values = {};

        for (let k of Object.keys(this) as (keyof D)[]) {
            // Carry forward existing values that are non-default and not
            // explicitly specified in /values/.
            if (! (k in values)) {
                if ((<any>this)[k] !== meta.def[k].default) {
                    data[k] = (<any>this)[k];
                }
                continue;
            }

            const v = meta.def[k].is(values[k]);

            // If /values/ explicitly specifies that /k/ should be the default
            // value, omit it from the saved object entirely.
            if (v === meta.def[k].default) continue;

            // Otherwise, store it.
            data[k] = v;
        }

        return await browser.storage[meta.store].set({[meta.key]: data});
    },

    async delete<D extends StorableDef>(this: StoredObject<D>): Promise<void> {
        let meta = META.get(this)!;

        // The following may or may not trigger a browser.storage.onChanged
        // event.  if it doesn't (e.g. because the object never existed), we
        // have to forget about the object manually.
        LIVE_OBJECTS[meta.store].delete(meta.key);
        return browser.storage[meta.store].remove(meta.key);
    },
};



// -----BEGIN UGLY GLOBAL STATE-----

// A map of object store names and keys to StoredObjects, like:
//
//     sync: key => StoredObject
//     local: key => StoredObject
//
// Ugh, we never drop StoredObjects from here unless they are deleted.  This is
// gross from a memory-use perspective, but there's not much we can do here
// because the alternative is to register one browser.storage.onChanged listener
// per StoredObject, which is O(N^2).
//
// Have I mentioned recently how much I hate JavaScript's lack of
// memory-management facilities? :/
const LIVE_OBJECTS = {
    sync: new Map<string, StoredObject<any>>(),
    local: new Map<string, StoredObject<any>>(),
};

// A map of private metadata tracking its identity within the browser store, and
// default values to rely on if any of those values aren't set.  Stored outside
// the object so we don't pollute the object's namespace.
const META = new WeakMap<StoredObject<any>, MetaInfo<any>>();

// The set of objects we are currently trying to load.  We keep track of this
// set because objects can be loaded in one of two ways--either through
// _animate(), which queries browser.storage explicitly, or by receiving an
// event saying the object has been changed or deleted.
//
// In the latter case, the event has more up-to-date information than
// browser.storage, so we populate the object from the event and remove it from
// /LOADING_OBJECTS/.  Then, when browser.storage.*.get() returns, we check to
// see if the object has already been loaded by an event, by looking to see if
// it's still in this set.
//
// The value of the map is a Promise which resolves once the object is loaded.
const LOADING_OBJECTS = new WeakMap<StoredObject<any>, Promise<void>>();

// -----END UGLY GLOBAL STATE-----



browser.storage.onChanged.addListener((changes, area) => {
    let areaobjs = LIVE_OBJECTS[area];

    for (let key of Object.keys(changes)) {
        let obj = areaobjs.get(key);
        if (! obj) continue;

        let meta = META.get(obj)!;

        if ('newValue' in changes[key]) {
            _load(obj, meta, changes[key].newValue);

        } else {
            // Key was removed from the store entirely.  Reset it to defaults,
            // and drop it from LIVE_OBJECTS on the assumption the callers don't
            // want it, either.
            for (const k in meta.def) (<any>obj)[k] = meta.def[k].default;
            areaobjs.delete(key);
        }

        // If anyone was waiting on this object, it's now loaded.  (A
        // browser.storage event will fire for this eventually, which will
        // actually complete the loading, but the data will already be there, so
        // the return value from browser.storage can be ignored.)
        LOADING_OBJECTS.delete(obj);
    }
});



function _animate<D extends StorableDef>(
    obj: StoredObject<D>, meta: MetaInfo<D>
): Promise<void> {
    const liveobj = LIVE_OBJECTS[meta.store].get(meta.key);
    if (liveobj) {
        if (liveobj !== obj) {
            throw `Multiple objects exist for key: ${meta.key}`;
        }

        const loading = LOADING_OBJECTS.get(obj);
        return loading ? loading : Promise.resolve();
    }

    LIVE_OBJECTS[meta.store].set(meta.key, obj);

    let p = browser.storage[meta.store].get(meta.key)
        .then(data => {
            // Object could have already been loaded due to an onChanged event
            // that fired between when we asked browser.storage for the object
            // and when browser.storage actually returned.  Prioritize the event
            // over what browser.storage gave us because it's most likely to be
            // up to date.
            if (LOADING_OBJECTS.has(obj)) {
                _load(obj, meta, data[meta.key]);
                LOADING_OBJECTS.delete(obj);
            }
        });
    LOADING_OBJECTS.set(obj, p);
    return p;
}

function _load<D extends StorableDef>(
    obj: StoredObject<D>, meta: MetaInfo<D>,
    values: any
) {
    // We assign both defaults and the new values here so that if any
    // properties were reset to the default (and removed from storage),
    // Vue will notice those as well.

    for (const k in meta.def) (<any>obj)[k] = meta.def[k].default;

    if (typeof values !== 'object') return;

    for (const k in values) {
        if (k in meta.def) (<any>obj)[k] = meta.def[k].is(values[k]);
        // Otherwise keys not present in defaults are dropped/ignored.
    }
}

"use strict";

// A module to load and save JavaScript objects to/fron a particular key in
// browser-local storage, and to keep those JavaScript objects up to date
// automatically as browser-local storage changes.
//
// The properties must be predefined, with a default value provided for each
// property.  Values must be scalar values (undefined, null, booleans, numbers
// and strings)--nested objects/arrays are not supported.
//
// To update a property, DO NOT ASSIGN DIRECTLY TO THE PROPERTY.  Use the set()
// method instead, which can update or reset multiple properties at once by
// passing an object like so:
//
//     let obj = await StoredObject.get('local', 'foo', {a: 0, b: 0});
//     assert(obj.a === 0);
//     assert(obj.b === 0);
//
//     await obj.set({a: 1, b: 2});
//     assert(obj.a === 1);
//     assert(obj.b === 2);
//
// You can retrieve the defaults initially provided to the object like so:
//
//     let defaults = obj.defaults;
//
// And you can delete the stored object from the browser store entirely:
//
//     await obj.delete();
//
// As an extension, if you want to implement some validation or casting/munging
// behavior, you can provide an array instead of a value for a particular
// default.  For example, the following will ensure the value stored in 'num' is
// always a number:
//
//     let obj = StoredObject.get('local', 'foo', {
//         num: [0, (obj, key, value) => parseFloat(value)],
//     };
//     await obj.set({num: "15"});
//     console.assert(obj.num === 15);
//
// Note that if you provide a casting function, that function will NOT be
// returned from obj.defaults, which will continue to look like:
//
//     { num: 0 }
//
// The casting function you provide may throw an exception if validation fails.  If an exception is thrown from a casting function, 

export default {get};

async function get(store, key, schema) {
    let res = LIVE_OBJECTS[store].get(key);
    if (res) return res;

    let defaults = {};
    let casts = {};

    for (let k of Object.keys(schema)) {
        let v = schema[k];
        if (v instanceof Array) {
            defaults[k] = v[0];
            casts[k] = v[1];
        } else {
            defaults[k] = v;
        }
    }

    res = Object.assign(new StoredObject(), defaults);
    let meta = {store, key, defaults, casts};
    META.set(res, meta);

    await _animate(res, meta);
    return res;
}



class StoredObject {
    constructor() {}

    get defaults() { return META.get(this).defaults; }

    async set(values) {
        let meta = META.get(this);

        // Make sure we have an updated set of stuff first.
        await _animate(this, meta);

        // The object we will save to the store.  Values which are the default
        // should be omitted to save space (and allow defaults to
        // programmatically change later).
        let data = {};

        for (let k of Object.keys(this)) {
            // Carry forward existing values that are non-default and not
            // explicitly specified in /values/.
            if (! (k in values)) {
                if (this[k] !== meta.defaults[k]) {
                    data[k] = this[k];
                }
                continue;
            }

            let v = values[k];
            if (k in meta.casts) v = meta.casts[k](this, k, v);

            // If /values/ explicitly specifies that /k/ should be the default
            // value, omit it from the saved object entirely.
            if (v === meta.defaults[k]) continue;

            // Otherwise, store it.
            data[k] = v;
        }

        return browser.storage[meta.store].set({[meta.key]: data});
    }

    delete() {
        let meta = META.get(this);

        // The following may or may not trigger a browser.storage.onChanged
        // event.  if it doesn't (e.g. because the object never existed), we
        // have to forget about the object manually.
        LIVE_OBJECTS[meta.store].delete(meta.key);
        return browser.storage[meta.store].remove(meta.key);
    }
}



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
    sync: new Map(),
    local: new Map(),
};

// A map of private metadata tracking its identity within the browser store, and
// default values to rely on if any of those values aren't set.  Stored outside
// the object so we don't pollute the object's namespace.
const META = new WeakMap();

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
const LOADING_OBJECTS = new WeakMap();


// -----END UGLY GLOBAL STATE-----



browser.storage.onChanged.addListener((changes, area) => {
    let areaobjs = LIVE_OBJECTS[area];

    for (let key of Object.keys(changes)) {
        let obj = areaobjs.get(key);
        if (! obj) continue;

        let meta = META.get(obj);

        if ('newValue' in changes[key]) {
            _load(obj, meta, changes[key].newValue);

        } else {
            // Key was removed from the store entirely.  Reset it to defaults,
            // and drop it from LIVE_OBJECTS on the assumption the callers don't
            // want it, either.
            Object.assign(obj, meta.defaults);
            areaobjs.delete(key);
        }

        // If anyone was waiting on this object, it's now loaded.  (A
        // browser.storage event will fire for this eventually, which will
        // actually complete the loading, but the data will already be there, so
        // the return value from browser.storage can be ignored.)
        LOADING_OBJECTS.delete(obj);
    }
});



function _animate(obj, meta) {
    const liveobj = LIVE_OBJECTS[meta.store].get(meta.key);
    if (liveobj) {
        if (liveobj !== obj) {
            throw `Multiple objects exist for key: ${obj[S.key]}`;
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

function _load(obj, meta, values) {
    // We assign both defaults and the new values here so that if any
    // properties were reset to the default (and removed from storage),
    // Vue will notice those as well.

    Object.assign(obj, meta.defaults);

    if (! values) return;

    for (let k of Object.keys(values)) {
        if (k in meta.defaults) {
            obj[k] = values[k];
        }
        // Otherwise keys not present in defaults are dropped/ignored.
    }
}

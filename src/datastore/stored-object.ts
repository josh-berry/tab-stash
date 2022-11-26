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

import browser from "webextension-polyfill";
import {reactive} from "vue";

import event, {Event} from "../util/event";

// Here's how to define the type of a StoredObject:
export interface StorableDef {
  [k: string]: StorableDefEntry<any>;
}

export type StorableDefEntry<T extends StorableValue> = {
  // Each property has a default value...
  default: T;
  // ...and a type.
  is: StorableType<T>;
};

// Allowed types (for each "is" property in the map above) are based on MDN's
// documentation (and experimentation with Firefox).
export type StorableValue =
  | undefined
  | null
  | boolean
  | number
  | string
  | StorableValue[];

// Storable types are set in the "is" property of a StorableDef, and are
// expressed as functions which convert from arbitrary/undefined values the
// desired type.
export type StorableType<T extends StorableValue> = (
  value: any,
  fallback: T,
) => T;

// Here are the basic types (boolean, string, etc.).  We don't define types for
// undefined/null right now because they're not very useful on their own.
export function aBoolean(value: any, fallback: boolean): boolean {
  switch (typeof value) {
    case "undefined":
      return fallback;
    case "boolean":
      return value;
    case "number":
      if (value === 0) return false;
      return true;
    case "string":
      switch (value.toLowerCase()) {
        case "false":
        case "no":
          return false;
        case "true":
        case "yes":
          return true;
        default:
          return fallback;
      }
    default:
      switch (value) {
        case null:
          return false;
        default:
          return fallback;
      }
  }
}

export function aNumber(value: any, fallback: number): number {
  switch (typeof value) {
    case "boolean":
    case "number":
    case "string":
      const res = Number(value);
      if (Number.isNaN(res)) return fallback;
      return res;
    default:
      return fallback;
  }
}

export function aString(value: any, fallback: string): string {
  switch (typeof value) {
    case "undefined":
      return fallback;
    case "boolean":
    case "number":
      return value.toString();
    case "string":
      return value;
    default:
      return fallback;
  }
}

// However, it IS possible to have "some other type OR undefined/null".  For
// example: maybeUndef(aNumber) is equivalent to number | undefined.
export function maybeUndef<V extends StorableValue>(
  converter: (v: any, fallback: V) => V,
) {
  return (value: any, fallback: V | undefined): V | undefined => {
    switch (value) {
      case undefined:
      case null:
        return undefined;
      default:
        return converter(value, fallback as any);
    }
  };
}

export function maybeNull<V extends StorableValue>(
  converter: (v: any, fallback: V) => V,
) {
  return (value: any, fallback: V | null): V | null => {
    switch (value) {
      case undefined:
      case null:
        return null;
      default:
        return converter(value, fallback as any);
    }
  };
}

// Enum values are also supported, for example anEnum('a', 'b') is the same type
// as 'a' | 'b'.
export const anEnum =
  <V extends string>(...cases: V[]) =>
  (value: any, fallback: V): V => {
    if (cases.includes(value)) return value;
    return fallback;
  };

/** An object which is stored persistently in `browser.storage`, and which
 * conforms to a particular schema definition `D`. */
export interface StoredObject<D extends StorableDef> {
  /** Read-only data properties as defined in your schema. */
  readonly state: StorableData<D>;

  /** An onChanged event is fired whenever the StoredObject changes or is
   * deleted.  Its sole parameter is the StoredObject itself. */
  readonly onChanged: Event<(self: StoredObject<D>) => void>;

  /** Update one or more properties of the StoredObject.  If the StoredObject
   * does not exist, it will be created. */
  set(values: Partial<StorableData<D>>): Promise<void>;

  /** Delete the stored object.  All its values will be reset to their
   * defaults. */
  delete(): Promise<void>;
}

export type StorableData<D extends StorableDef> = {
  readonly [k in keyof D]: ReturnType<D[k]["is"]>;
};

// istanbul ignore next -- tests create their own factories
/** Load and return a StoredObject from `browser.storage`, using the provided
 * definition.  Note that loading the same object with different definitions is
 * not allowed.
 *
 * If the object does not exist in persistent storage (or is later deleted), the
 * same returned StoredObject can still be used to re-create it (or be notified
 * when it is re-created). */
export default function get<D extends StorableDef>(
  store: "sync" | "local",
  key: string,
  def: D,
): Promise<StoredObject<D>> {
  return _FACTORY.get(store, key, def);
}

//
// Internal implementation
//

/** A factory for StoredObjects; generally you don't want to mess with this.
 * It's only exported so it can be (re)created for testing purposes. */
export class _StoredObjectFactory {
  /** A simple set of maps which hold StoredObjects so we can keep them up to
   * date. */
  private readonly _live: {
    sync: Map<string, StoredObjectImpl<any>>;
    local: Map<string, StoredObjectImpl<any>>;
  } = {sync: new Map(), local: new Map()};

  /** The set of objects we are currently trying to load.  We keep track of
   * this set because objects can be loaded in one of two ways--either through
   * _factory(), which queries browser.storage explicitly, or by receiving an
   * event saying the object has been changed or deleted.
   *
   * In the latter case, the event has more up-to-date information than
   * _factory() will, so we populate the object from the event and remove it
   * from `_loading`.  Then, when browser.storage.*.get() returns inside
   * _factory(), we check to see if the object has already been loaded by an
   * event, by looking to see if it's still in this set. */
  private readonly _loading: Set<StoredObjectImpl<any>> = new Set();

  constructor() {
    browser.storage.onChanged.addListener((changes, area) => {
      // istanbul ignore if -- browser sanity
      if (area !== "sync" && area !== "local") return;

      const area_live = this._live[area as "sync" | "local"];

      for (const key in changes) {
        const obj = area_live.get(key);
        if (!obj) continue;

        if ("newValue" in changes[key]) {
          obj._changed(changes[key].newValue);
        } else {
          // Key was removed from the store entirely.  Reset it to
          // defaults.
          obj._changed({});
        }

        // If anyone was waiting on this object, it's now loaded.  (A
        // browser.storage event will fire for this eventually, which
        // will actually complete the loading, but the data will already
        // be there, so we can just drop it.)
        this._loading.delete(obj);
      }
    });
  }

  async get<D extends StorableDef>(
    store: "sync" | "local",
    key: string,
    def: D,
  ): Promise<StoredObject<D>> {
    let object = this._live[store].get(key);
    if (object) {
      // istanbul ignore if -- basic caller validation
      if (object._def !== def) {
        throw new TypeError(`Tried to load '${key}' with a conflicting def`);
      }
      return object;
    }

    object = new StoredObjectImpl<D>(this, store, key, def);

    this._loading.add(object);
    const data = await browser.storage[store].get(key);

    // Object could have already been loaded due to an onChanged event that
    // fired between when we asked browser.storage for the object and when
    // browser.storage actually returned.  Prioritize the event over what
    // browser.storage gave us because it's most likely to be up to date.
    //
    // istanbul ignore else -- not testable due to being v.hard to mock
    if (this._loading.has(object)) {
      object._load(data[key]);
      this._loading.delete(object);
    }
    return object;
  }

  add(o: StoredObjectImpl<any>) {
    // istanbul ignore if -- internal sanity check
    if (this._live[o._store].has(o._key)) {
      throw new Error(`Created multiple StoredObjects for key ${o._key}`);
    }
    this._live[o._store].set(o._key, o);
  }
}

/** The global factory (and the ONLY factory, when not under test). */
const _FACTORY = new _StoredObjectFactory();

class StoredObjectImpl<D extends StorableDef> implements StoredObject<D> {
  // Read-only data properties as defined in your schema (named `state` to
  // follow Vue model conventions).
  readonly state: StorableData<D>;

  // Event listener which is notified whenever the StoredObject changes or
  // is deleted.
  readonly onChanged: Event<(self: StoredObject<D>) => void>;

  readonly _factory: _StoredObjectFactory;
  readonly _store: "sync" | "local";
  readonly _key: string;
  readonly _def: D;

  constructor(
    factory: _StoredObjectFactory,
    store: "sync" | "local",
    key: string,
    def: D,
  ) {
    // state must be pre-populated so Vue can observe it.
    const state: any = {};
    for (const k in def) state[k] = def[k].default;

    this.state = reactive(state);
    this.onChanged = event("StoredObject.onChanged", `${store}/${key}`);

    this._factory = factory;
    this._store = store;
    this._key = key;
    this._def = def;

    this._factory.add(this);
  }

  async set(values: Partial<StorableData<D>>): Promise<void> {
    // The object we will save to the store.  Values which are the default
    // should be omitted to save space (and allow defaults to
    // programmatically change later).
    const data: Partial<StorableData<D>> = {};

    for (const k in this._def) {
      // Carry forward existing values that are non-default and not
      // explicitly specified in /values/.
      if (!(k in values)) {
        if (this.state[k] !== this._def[k].default) {
          data[k] = this.state[k];
        }
        continue;
      }

      const v = this._def[k].is(values[k], this._def[k].default);

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
    // event.  If it doesn't, we need to clear the object manually.
    this._changed({});
    return browser.storage[this._store].remove(this._key);
  }

  _changed(values: any) {
    this._load(values);
    this.onChanged.send(this);
  }

  _load(values: any) {
    // We assign both defaults and the new values here so that if any
    // properties were reset to the default (and removed from storage),
    // Vue will notice those as well.

    // The <any> casts in here are to get rid of `readonly`.  This method is
    // the ONLY place where getting rid of `readonly` is acceptable.
    for (const k in this._def) (<any>this.state)[k] = this._def[k].default;

    if (typeof values === "object") {
      for (const k in values) {
        if (k in this._def) {
          (<any>this.state)[k] = this._def[k].is(
            values[k],
            this._def[k].default,
          );
        }
        // Otherwise keys not present in defaults are dropped/ignored.
      }
    }
  }
}

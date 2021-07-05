import {isProxy, reactive, shallowReadonly, watch} from 'vue';

import {Atom} from '../util';
import Listener from '../util/listener';

/** A map which triggers events when its contents change.
 *
 * Internally, it fires insert/update/move events on its own, but watches for
 * changes in the map's values using Vue's reactivity system (which triggers
 * onUpdate events).
 */
export class EventfulMap<K extends Atom, V extends object> {
    readonly onInsert = new Listener<(key: K, value: V) => void>();
    readonly onUpdate = new Listener<(key: K, value: V) => void>();
    readonly onMove = new Listener<(oldKey: K, newKey: K, value: V) => void>();
    readonly onDelete = new Listener<(key: K, value: V) => void>();

    private readonly _map = new Map<K, V>();
    private readonly _deleters = new WeakMap<V, () => void>();

    constructor() {}

    [Symbol.iterator](): IterableIterator<[K, V]> { return this._map.entries(); }

    get(key: K): V | undefined { return this._map.get(key); }

    insert(key: K, value: V) {
        ensureProxy(value);
        if (this._map.has(key)) throw new Error(`Key already exists`);
        if (this._deleters.has(value)) throw new Error(`Value exists under another key`);

        this._map.set(key, value);
        this._deleters.set(value, watch(value, () => {
            this.onUpdate.sendSync(key, value);
        }, {deep: true}));
        this.onInsert.sendSync(key, value);
        return this;
    }

    move(oldKey: K, newKey: K): V | undefined {
        const value = this._map.get(oldKey);
        if (! value) return;
        this._map.delete(oldKey);
        this.delete(newKey);
        this._map.set(newKey, value);
        this.onMove.sendSync(oldKey, newKey, value);
        return value;
    }

    delete(key: K): V | undefined {
        const v = this._map.get(key);
        if (v) {
            this._map.delete(key);
            this._deleters.get(v)!();
            this.onDelete.sendSync(key, v);
        }
        return v;
    }
}

export interface IndexDefinition<K extends Atom, V extends object> {
    /** Given a value, return the key that should be used to index the value. */
    keyFor(value: V): K;

    /** Returns the desired array index of `candidate` in `entry`, where `entry`
     * is a list of values that share the same index key.
     *
     * `entry`'s values will be reordered such that `entry[i] === candidate`.
     * If `candidate` is not yet present in `entry`, existing items will be
     * shifted to the right to make room.  A very large number (such as
     * `Infinity`) can be provided to place the candidate at the end of the
     * `entry` (the most efficient option if you don't care where the entry
     * lands).
     *
     * This function is called whenever the candidate value is inserted,
     * updated, or removed from the index.  The candidate may or may not already
     * be present in the entry, which is provided merely so that implementations
     * may compare the candidate against other values already present.
     * **Implementations must NOT modify the entry directly.**
     */
    positionOf?: (candidate: V, entry: readonly V[]) => number;

    /** Called when a value's position in its index entry has been changed due
     * to insertion/update/deletion of other values in the same entry.
     * `toIndex` is the new array index of the value in its entry. */
    whenPositionChanged?: (value: V, toIndex: number) => void;
}

type IndexedValueInfo<V extends object> = {
    value: V,
    entry: V[],
    position: number,
};

/** A Vue-reactive index of objects in an EventfulMap.  The index is keyed using
 * a key-derivation function, and allows multiple objects to exist with the same
 * key (that is, it is not a unique index).
 *
 * There is intentionally no way to iterate the index, because the index as a
 * whole is not reactive.  Only individual keys are reactive.
 */
export class Index<K extends Atom, PK extends Atom, V extends object> {
    /** The EventfulMap this index is indexing. */
    readonly map: EventfulMap<PK, V>;

    /** How values are maintained in the index. */
    readonly def: IndexDefinition<K, V>;

    private readonly _entries = new Map<K, V[]>();
    private readonly _values = new WeakMap<V, IndexedValueInfo<V>>();

    constructor(map: EventfulMap<PK, V>, def: IndexDefinition<K, V>) {
        this.map = map;
        this.def = def;

        this.map.onInsert.addListener((k, v) => this.insert(v));
        this.map.onUpdate.addListener((k, v) => this.update(v));
        this.map.onDelete.addListener((k, v) => this.delete(v));
        for (const [_k, v] of this.map) this.insert(v);
    }

    /** Retrieve all the values matching `key` from the index.
     *
     * The array returned is reactive, so you can watch it to determine when
     * objects with this particular key are added/removed.  However, you may not
     * modify the returned array yourself. */
    get(key: K): readonly V[] {
        return shallowReadonly(this._get(key)) as readonly V[];
    }

    private _get(key: K): V[] {
        let a = this._entries.get(key);
        if (! a) {
            a = reactive([]);
            this._entries.set(key, a);
        }
        return a;
    }

    /** Insert a value in the index.  The value's key is derived using `keyFor()`.
     * The inserted value must be a Vue proxy object (reactive(), ref() or
     * readonly()). */
    private insert(value: V): V {
        // istanbul ignore if -- internal consistency check
        if (this._values.get(value) !== undefined) {
            throw new Error(`Value already present`);
        }

        const key = this.def.keyFor(value);
        const entry = this._get(key);
        const position = this.def.positionOf
            ? this.def.positionOf(value, entry) : Infinity;

        const iv = {value, entry, position};
        this._values.set(value, iv);
        this._addToIndex(value, entry, position);

        return value;
    }

    /** Updates a value in the index that has changed. */
    private update(value: V) {
        const iv = this._values.get(value);

        // istanbul ignore if -- internal consistency check
        if (! iv) throw new Error(`Value is not inserted in index`);
        // istanbul ignore if -- internal consistency check
        if (iv.entry[iv.position] !== iv.value) throw new Error(`Entry/position mismatch`);

        const key = this.def.keyFor(value);
        const entry = this._get(key);
        const position = this.def.positionOf
            ? this.def.positionOf(value, entry) : Infinity;

        if (entry !== iv.entry) {
            // Which entry the index should be in has changed; remove it from
            // the old entry (if applicable) and add it to the new one.
            this._removeFromIndex(iv.entry, iv.position);
            iv.entry = entry;
            // iv.position is automatically updated by reindexing
            this._addToIndex(value, entry, position);

        } else {
            // The position of the value in the index entry may have changed;
            // re-shuffle the entry if necessary.
            this._shuffleIndex(iv, position);
        }

        // istanbul ignore if -- internal consistency check
        if (iv.entry[iv.position] !== iv.value) throw new Error(`Entry/position mismatch`);
    }

    /** Deletes a value from the index. */
    private delete(value: V) {
        const iv = this._values.get(value);

        // istanbul ignore if -- internal consistency check
        if (! iv) throw new Error(`Value is already not present`);
        // istanbul ignore if -- internal consistency check
        if (iv.entry[iv.position] !== iv.value) throw new Error(`Entry/position mismatch`);

        this._removeFromIndex(iv.entry, iv.position);
        this._values.delete(value);
    }

    /** Insert `to.value` into `to.entry` at `to.position` (or its closest valid
     * index).  Assumes `to.value` is not already present in `to.entry`. */
    private _addToIndex(value: V, entry: V[], position: number) {
        position = Math.min(Math.max(0, position), entry.length);
        entry.splice(position, 0, value);
        this._reindex(entry, position, Infinity);
    }

    /** Remove `from.value` from `from.entry`.  Makes no assumption about where
     * in the entry the value is actually located (as values could have shifted
     * over time). */
    private _removeFromIndex(entry: V[], position: number) {
        entry.splice(position, 1);
        this._reindex(entry, position, Infinity);

        // We never delete a key from this._map because someone might
        // still be watching it...
    }

    /** Moves `to.value` within `to.entry` to position `to.position`.  Assumes
     * `to.value` is already present in `to.entry`. */
    private _shuffleIndex(iv: IndexedValueInfo<V>, position: number) {
        position = Math.min(Math.max(0, position), iv.entry.length - 1);
        if (iv.position === position) return;

        if (position < iv.position) {
            // The element moves to the left, everything else shifts one slot to
            // the right.
            for (let i = iv.position; i > position; --i) {
                iv.entry[i] = iv.entry[i-1];
            }
            iv.entry[position] = iv.value;
            this._reindex(iv.entry, position, iv.position + 1);

        } else {
            // The element moves to the right, everything else shifts one slot
            // to the left.
            for (let i = iv.position; i < position; ++i) {
                iv.entry[i] = iv.entry[i+1];
            }
            iv.entry[position] = iv.value;
            this._reindex(iv.entry, iv.position, position + 1);
        }

        // istanbul ignore if -- internal consistency check
        if (iv.position !== position) {
            console.error('iv', iv, 'position', position);
            throw new Error(`iv.position not updated`);
        }
    }

    /** Calls the whenPositionChanged() hook for values in the range
     * `[startingFrom, endingOn]`.  Assumes the values are already in their
     * correct positions. */
    private _reindex(entry: V[], startingFrom: number, endingOn: number) {
        endingOn = Math.min(entry.length, endingOn);

        for (let i = Math.max(0, startingFrom); i < endingOn; ++i) {
            const iv = this._values.get(entry[i]);
            // istanbul ignore if -- internal consistency
            if (! iv) {
                console.error('entry', entry, 'start', startingFrom, 'end', endingOn);
                throw new Error(`No IV found at ${i}`);
            }
            iv.position = i;
            if (this.def.whenPositionChanged) {
                this.def.whenPositionChanged(entry[i], i);
            }
        }
    }
}

function ensureProxy(p: unknown) {
    if (! isProxy(p)) throw new Error(`Called with a non-proxy object`);
}

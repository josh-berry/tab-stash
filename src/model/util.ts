import {isProxy, reactive, shallowReadonly, watch} from 'vue';

import {Atom} from '../util';

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

type KVP<K extends Atom, V extends object> = {
    key: K,
    value: V,
    entry: V[],
    position: number,
};

/** A Vue-reactive index of objects, which tracks which objects have which keys
 * (as computed with a key-derivation function).
 *
 * There is intentionally no way to iterate the index, because the index as a
 * whole is not reactive.  Only individual keys are reactive.
 */
export class Index<K extends Atom, V extends object> {
    /** How values are maintained in the index. */
    readonly def: IndexDefinition<K, V>;

    private readonly _map = new Map<K, V[]>();
    private readonly _deleters = new WeakMap<V, () => void>();

    constructor(def: IndexDefinition<K, V>) {
        this.def = def;
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
        let a = this._map.get(key);
        if (! a) {
            a = reactive([]);
            this._map.set(key, a);
        }
        return a;
    }

    /** Insert a value in the index.  The value's key is derived using `keyFor()`.
     * The inserted value must be a Vue proxy object (reactive(), ref() or
     * readonly()). */
    insert(value: V): V {
        ensureProxy(value);

        if (this._deleters.get(value) !== undefined) {
            // Value is already present in the index
            return value;
        }

        let kvp: KVP<K, V>;

        const stop_watch = watch(
            () => {
                const key = this.def.keyFor(value);
                const entry = this._get(key);
                const position = this.def.positionOf
                    ? this.def.positionOf(value, entry) : Infinity;
                kvp = {key, value, entry, position};
                return kvp;
            },
            (to, from) => {
                if (from?.entry !== to.entry) {
                    // Which entry the index should be in has changed; remove it
                    // from the old entry (if applicable) and add it to the new
                    // one.
                    if (from) this._removeFromIndex(from);
                    this._addToIndex(to);
                } else {
                    // The position of the value in the index entry may have
                    // changed; re-shuffle the entry if necessary.
                    this._shuffleIndex(to);
                }
            },
            {immediate: true}
        );

        this._deleters.set(value, () => {
            stop_watch();
            this._removeFromIndex(kvp);
            this._deleters.delete(value);
        });

        return value;
    }

    /** Deletes a value from the index. */
    delete(value: V) {
        const deleter = this._deleters.get(value);
        if (deleter) deleter();
    }

    /** Insert `to.value` into `to.entry` at `to.position` (or its closest valid
     * index).  Assumes `to.value` is not already present in `to.entry`. */
    private _addToIndex(to: KVP<K, V>) {
        to.position = Math.min(Math.max(0, to.position), to.entry.length);
        to.entry.splice(to.position, 0, to.value);
        this._reindex(to.entry, to.position, Infinity);
    }

    /** Remove `from.value` from `from.entry`.  Makes no assumption about where
     * in the entry the value is actually located (as values could have shifted
     * over time). */
    private _removeFromIndex(from: KVP<K, V>) {
        const pos = from.entry.indexOf(from.value);

        // istanbul ignore else -- internal sanity; we should never reach here
        // if from.value isn't in the entry.
        if (pos >= 0) {
            from.entry.splice(pos, 1);
            this._reindex(from.entry, pos, Infinity);
        }

        // We never delete a key from this._map because someone might
        // still be watching it...
    }

    /** Moves `to.value` within `to.entry` to position `to.position`.  Assumes
     * `to.value` is already present in `to.entry`. */
    private _shuffleIndex(to: KVP<K, V>) {
        // Same as above--we don't rely on .position to find our value in case
        // it was shifted.
        const oldPos = to.entry.indexOf(to.value);
        to.position = Math.min(Math.max(0, to.position), to.entry.length - 1);

        if (oldPos === to.position) return;

        if (to.position < oldPos) {
            // The element moves to the left, everything else shifts one slot to
            // the right.
            for (let i = oldPos; i > to.position; --i) {
                to.entry[i] = to.entry[i-1];
            }
            to.entry[to.position] = to.value;
            this._reindex(to.entry, to.position, oldPos + 1);

        } else {
            // The element moves to the right, everything else shifts one slot
            // to the left.
            for (let i = oldPos; i < to.position; ++i) {
                to.entry[i] = to.entry[i+1];
            }
            to.entry[to.position] = to.value;
            this._reindex(to.entry, oldPos, to.position + 1);
        }
    }

    /** Calls the whenPositionChanged() hook for values in the range
     * `[startingFrom, endingOn]`.  Assumes the values are already in their
     * correct positions. */
    private _reindex(entry: V[], startingFrom: number, endingOn: number) {
        if (! this.def.whenPositionChanged) return;

        endingOn = Math.min(entry.length, endingOn);
        for (let i = Math.max(0, startingFrom); i < endingOn; ++i) {
            this.def.whenPositionChanged(entry[i], i);
        }
    }
}

function ensureProxy(p: unknown) {
    if (! isProxy(p)) throw new Error(`Called with a non-proxy object`);
}

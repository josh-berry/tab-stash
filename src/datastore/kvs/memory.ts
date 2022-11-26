import {KeyValueStore, Entry, MaybeEntry, Key, Value} from ".";

import event, {Event} from "../../util/event";

const copy = (x: any) => JSON.parse(JSON.stringify(x));

// istanbul ignore next (because k1 != k2 always)
const byKey = ([k1, v1]: [any, any], [k2, v2]: [any, any]) =>
  k1 < k2 ? -1 : k1 > k2 ? 1 : 0;

// XXX optimize me if performance ever becomes important
export default class MemoryKVS<K extends Key, V extends Value>
  implements KeyValueStore<K, V>
{
  readonly name: string;
  readonly onSet: Event<(entries: MaybeEntry<K, V>[]) => void>;
  readonly onSyncLost: Event<() => void>;

  constructor(name: string) {
    this.name = name;
    this.onSet = event("KVS.Memory.onSet", name);
    this.onSyncLost = event("KVS.Memory.onSyncLost", name);
  }

  /** The in-memory KVS data, exposed here for readers to be able to inspect
   * the KVS directly without having to go thru async methods.
   *
   * This should mainly be used for testing purposes; if you modify it
   * directly, onSet events will not be fired.  (You should not modify it
   * directly under normal circumstances.) */
  readonly data = new Map<K, V>();

  async get(keys: K[]): Promise<Entry<K, V>[]> {
    return keys
      .map(k => ({key: k, value: this.data.get(k)}))
      .filter(e => e.value !== undefined) as Entry<K, V>[];
  }

  async getStartingFrom(
    bound: K | undefined,
    limit: number,
  ): Promise<Entry<K, V>[]> {
    let keys = Array.from(this.data.keys()).sort();
    if (bound !== undefined) keys = keys.filter(x => x > bound!);
    return keys
      .slice(0, limit)
      .map(key => ({key, value: copy(this.data.get(key))}));
  }

  async getEndingAt(
    bound: K | undefined,
    limit: number,
  ): Promise<Entry<K, V>[]> {
    let rkeys = Array.from(this.data.keys()).sort().reverse();
    if (bound !== undefined) rkeys = rkeys.filter(x => x < bound!);
    return rkeys
      .slice(0, limit)
      .map(key => ({key, value: copy(this.data.get(key))}));
  }

  async *list(): AsyncIterable<Entry<K, V>> {
    for (const [key, value] of Array.from(this.data.entries()).sort(byKey)) {
      yield {key, value: copy(value)};
    }
  }

  async *listReverse(): AsyncIterable<Entry<K, V>> {
    for (const [key, value] of Array.from(this.data.entries())
      .sort(byKey)
      .reverse()) {
      yield {key, value: copy(value)};
    }
  }

  async set(entries: MaybeEntry<K, V>[]): Promise<void> {
    const ev = entries.map(({key, value}) => {
      if (value === undefined) {
        this.data.delete(key);
        return {key};
      } else {
        this.data.set(key, copy(value));
        return {key, value: copy(value)};
      }
    });
    if (ev.length > 0) this.onSet.send(ev);
  }

  async deleteAll(): Promise<void> {
    await this.set(Array.from(this.data.keys()).map(key => ({key})));
  }
}

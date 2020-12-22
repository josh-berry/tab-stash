import {Events} from 'webextension-polyfill-ts';

import {Entry, Key, Value} from './proto';
import Client from './client';
import Service from './service';

export {Client, Service, Entry, Key, Value};

export interface KeyValueStore<K extends Key, V extends Value> {
    onSet: Events.Event<(entries: Entry<K, V>[]) => void>;
    onDelete: Events.Event<(keys: K[]) => void>;

    get(keys: K[]): Promise<Entry<K, V>[]>;
    getStartingFrom(bound: K | undefined, limit: number): Promise<Entry<K, V>[]>;
    getEndingAt(bound: K | undefined, limit: number): Promise<Entry<K, V>[]>;

    list(): AsyncIterable<Entry<K, V>>;
    listReverse(): AsyncIterable<Entry<K, V>>;

    set(entries: Entry<K, V>[]): Promise<void>;

    delete(keys: K[]): Promise<void>;
    deleteAll(): Promise<void>;
}

export async function* genericList<K extends Key, V extends Value>(
    getChunk: (key: K | undefined, limit: number) => Promise<Entry<K, V>[]>,
): AsyncIterable<Entry<K, V>> {
    let bound: K | undefined;
    while (true) {
        const res = await getChunk(bound, 100);
        if (res.length == 0) break;
        yield* res;
        bound = res[res.length - 1].key;
    }
}

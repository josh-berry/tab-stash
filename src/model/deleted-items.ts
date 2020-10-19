// Model for storing/tracking deleted items persistently.  See index.ts for how
// this fits in to the overall Tab Stash model (such as it is).
import Vue from 'vue';
import {friendlyFolderName} from '../stash';
import {nonReentrant} from '../util';

import {KeyValueStore, Entry} from '../util/kvs';
import {makeRandomString} from '../util/random';

// The key for a deleted record should be opaque but monotonically increasing as
// time passes, so items deleted more recently have greater keys.
export type Source = KeyValueStore<string, SourceValue>;
export type SourceValue = {
    deleted_at: string,
    item: DeletedItem,
};


export type State = {
    fullyLoaded: boolean,
    entries: Deletion[],
};

export type Deletion = {
    key: string,
    deleted_at: Date,
    item: DeletedItem,
};

export type DeletedItem = DeletedBookmark | DeletedFolder;

export type DeletedBookmark = {
    title: string,
    url: string,
    favIconUrl?: string,
};

export type DeletedFolder = {
    title: string,
    children: DeletedItem[],
};

function src2state(e: Entry<string, SourceValue>): Deletion {
    return {
        key: e.key,
        deleted_at: new Date(e.value.deleted_at),
        item: 'children' in e.value.item
            ? {
                title: friendlyFolderName(e.value.item.title),
                children: e.value.item.children,
            }
            : e.value.item,
    };
}



export class Model {
    // TODO make this transitively read-only (once I figure out the TypeScript
    // typing issues)
    readonly state: State = Vue.observable({
        fullyLoaded: false,
        entries: [], // sorted newest to oldest
    });

    private _kvs: KeyValueStore<string, SourceValue>;
    private _entry_cache = new Map<string, Deletion>();

    constructor(kvs: KeyValueStore<string, SourceValue>) {
        this._kvs = kvs;

        // How to update the store on KVS changes.  These events are
        // reliable--we recieve them regardless of whether we are the one doing
        // the mutation on the KVS.
        kvs.onSet.addListener(records => this.onSet(records));
        kvs.onDelete.addListener(keys => this.onDelete(keys));
    }

    onSet(records: Entry<string, SourceValue>[]) {
        for (const r of records) {
            const {key, value} = r;
            const cached = this._entry_cache.get(key);
            if (cached) {
                cached.deleted_at = new Date(value.deleted_at);
                cached.item = value.item;
            } else {
                const r = src2state({key, value});
                this._entry_cache.set(key, r);
                if (r.deleted_at > this.state.entries[0]?.deleted_at) {
                    // This is the newest entry so it always goes first
                    this.state.entries.unshift(r);
                } else {
                    // TODO this is slow but hopefully very rare
                    this.state.entries.push(r);
                    this.state.entries.sort((a, b) =>
                        b.deleted_at.valueOf() - a.deleted_at.valueOf());
                }
            }
        }
    }

    onDelete(keys: string[]) {
        for (const k of keys) this._entry_cache.delete(k);
        const kset = new Set(keys);
        this.state.entries = this.state.entries.filter(
            ({key}) => ! kset.has(key));
    }

    loadMore = nonReentrant(async() => {
        const bound = this.state.entries.length > 0
            ? this.state.entries[this.state.entries.length - 1].key
            : undefined;

        const block = await this._kvs.getEndingAt(bound, 1);
        this.onSet(block);
        if (block.length === 0) this.state.fullyLoaded = true;
    });

    async add(item: DeletedItem): Promise<Entry<string, SourceValue>> {
        // The ISO string has the advantage of being sortable...
        const deleted_at = new Date().toISOString();
        const key = `${deleted_at}-${makeRandomString(4)}`;
        const entry = {key, value: {deleted_at, item}};

        await this._kvs.set([entry]);
        // We will get an event that the entry has been added
        return entry;
    }

    drop(key: string): Promise<void> {
        // We will get an event for the deletion later
        return this._kvs.delete([key]);
    }

    async dropChildItem(key: string, index: number): Promise<void> {
        const entry = this._entry_cache.get(key);
        if (! entry) throw new Error(`${key}: Record not loaded or doesn't exist`);
        if (! ('children' in entry.item)) throw new Error(`${key}: Not a folder`);

        const newchildren = Array.from(entry.item.children);
        newchildren.splice(index, 1);
        await this._kvs.set([{
            key,
            value: {
                deleted_at: entry.deleted_at.toISOString(),
                item: {
                    title: entry.item.title,
                    children: newchildren,
                },
            },
        }]);
    }
};

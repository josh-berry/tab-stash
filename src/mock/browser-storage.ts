import {browser} from 'webextension-polyfill-ts';

import * as events from './events';

type StorageAreaName = 'sync' | 'local' | 'managed';
type StorageObject = {[s: string]: any};
type ChangeDict = StorageObject;

class MockStorageArea {
    _area: StorageAreaName;
    _storage: {[k: string]: string} = {};
    _events: events.MockEventDispatcher<StorageChangedFn>;

    constructor(area: StorageAreaName,
                events: events.MockEventDispatcher<StorageChangedFn>)
    {
        this._area = area;
        this._events = events;
    }

    async getBytesInUse(): Promise<number> { return 0; }

    async get(keys: string | string[] | null): Promise<StorageObject> {
        if (! keys) {
            keys = Object.keys(this._storage);
        } else if (typeof keys === 'string') {
            keys = [keys];
        }

        const res: StorageObject = {};
        for (let k of keys) {
            if (k in this._storage) res[k] = JSON.parse(this._storage[k]);
        }

        return Promise.resolve(res);
    }

    async set(obj: StorageObject): Promise<void> {
        const ev: ChangeDict = {};
        for (let k of Object.keys(obj)) {
            let v = JSON.stringify(obj[k]);

            ev[k] = {newValue: JSON.parse(v)};
            if (k in this._storage) {
                ev[k].oldValue = JSON.parse(this._storage[k]);
            }

            this._storage[k] = v;
        }

        this._events.send(ev, this._area);
        return Promise.resolve();
    }

    async remove(keys: string | string[]): Promise<void> {
        if (typeof keys === 'string') keys = [keys];

        const ev: ChangeDict = {};

        for (let k of keys) {
            if (k in this._storage) {
                ev[k] = {oldValue: JSON.parse(this._storage[k])};
                delete this._storage[k];
            }
        }

        this._events.send(ev, this._area);
        return Promise.resolve();
    }

    async clear(): Promise<void> {
        await this.remove(Object.keys(this._storage));
    }
}

class SyncStorageArea extends MockStorageArea {
    // Ugh, these values are hard-coded into webextension-polyfill-ts, no other
    // values will work...
    QUOTA_BYTES = 102400 as const;
    QUOTA_BYTES_PER_ITEM = 8192 as const;
    MAX_ITEMS = 512 as const;
    MAX_WRITE_OPERATIONS_PER_HOUR = 1800 as const;
    MAX_WRITE_OPERATIONS_PER_MINUTE = 120 as const;

    constructor(events: events.MockEventDispatcher<StorageChangedFn>) {
        super('sync', events);
    }
}

class LocalStorageArea extends MockStorageArea {
    // Ugh, same as above...
    QUOTA_BYTES = 5242880 as const;

    constructor(events: events.MockEventDispatcher<StorageChangedFn>) {
        super('local', events);
    }
}

class ManagedStorageArea extends MockStorageArea {
    // Ugh, same as above...
    QUOTA_BYTES = 5242880 as const;

    constructor(events: events.MockEventDispatcher<StorageChangedFn>) {
        super('managed', events);
    }
}

type StorageChangedFn = (changes: ChangeDict, area: StorageAreaName) => void;

export default (() => {
    let exports = {
        events: new events.MockEventDispatcher<StorageChangedFn>(''),

        reset() {
            events.expect_empty();
            events.trace(false);

            exports.events = new events.MockEventDispatcher<StorageChangedFn>(
                'storage.onChanged');

            browser.storage = {
                local: new LocalStorageArea(exports.events),
                sync: new SyncStorageArea(exports.events),
                managed: new ManagedStorageArea(exports.events),
                onChanged: exports.events,
            };
        }
    };

    exports.reset();

    return exports;
})();

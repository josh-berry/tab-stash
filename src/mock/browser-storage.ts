import * as events from './events';

class MockStorageArea {
    _area: browser.storage.StorageName;
    _storage: {[k: string]: string} = {};
    _events: events.MockEventDispatcher<StorageChangedFn>;

    constructor(area: browser.storage.StorageName,
                events: events.MockEventDispatcher<StorageChangedFn>)
    {
        this._area = area;
        this._events = events;
    }

    async get(keys: string | string[] | null)
        : Promise<browser.storage.StorageObject>
    {
        if (! keys) {
            keys = Object.keys(this._storage);
        } else if (typeof keys === 'string') {
            keys = [keys];
        }

        let res: browser.storage.StorageObject = {};
        for (let k of keys) {
            if (k in this._storage) res[k] = JSON.parse(this._storage[k]);
        }

        return Promise.resolve(res);
    }

    async set(obj: browser.storage.StorageObject): Promise<void> {
        let ev: browser.storage.ChangeDict = {};
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

        let ev: browser.storage.ChangeDict = {};

        for (let k of keys) {
            if (k in this._storage) {
                ev[k] = {oldValue: JSON.parse(this._storage[k])};
                delete this._storage[k];
            }
        }

        this._events.send(ev, this._area);
        return Promise.resolve();
    }
}

type StorageChangedFn = (changes: browser.storage.ChangeDict,
                         area: browser.storage.StorageName) => void;

export default (() => {
    let exports = {
        events: new events.MockEventDispatcher<StorageChangedFn>(''),

        reset() {
            events.expect_empty();
            events.trace(false);

            exports.events = new events.MockEventDispatcher<StorageChangedFn>(
                'storage.onChanged');

            // istanbul ignore next
            if (! (<any>globalThis).browser) (<any>globalThis).browser = {};

            (<any>globalThis).browser.storage = {
                local: new MockStorageArea('local', exports.events),
                sync: new MockStorageArea('sync', exports.events),
                onChanged: exports.events,
            };
        }
    };

    exports.reset();

    return exports;
})();

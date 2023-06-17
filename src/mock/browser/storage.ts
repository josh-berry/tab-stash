import type {Storage} from "webextension-polyfill";

import * as events from "../events";

type StorageAreaName = "sync" | "local" | "managed";
type StorageObject = {[s: string]: any};
type ChangeDict = StorageObject;

class MockStorageArea {
  _area: StorageAreaName;
  _storage: {[k: string]: string} = {};
  _all_events: events.MockEvent<StorageChangedFn>;

  readonly onChanged: events.MockEvent<StorageChangedFn>;

  constructor(
    area: StorageAreaName,
    all_events: events.MockEvent<StorageChangedFn>,
  ) {
    this._area = area;
    this._all_events = all_events;
    this.onChanged = new events.MockEvent(`browser.storage.${area}.onChanged`);
  }

  // istanbul ignore next - implemented only to conform to the interface
  async getBytesInUse(): Promise<number> {
    return 0;
  }

  async get(keys: string | string[] | null): Promise<StorageObject> {
    if (!keys) {
      keys = Object.keys(this._storage);
    } else if (typeof keys === "string") {
      keys = [keys];
    }

    const res: StorageObject = {};
    for (let k of keys) {
      if (k in this._storage) res[k] = JSON.parse(this._storage[k]);
    }

    return res;
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

    this._all_events.send(ev, this._area);
    this.onChanged.send(ev, this._area);
  }

  async remove(keys: string | string[]): Promise<void> {
    if (typeof keys === "string") keys = [keys];

    const ev: ChangeDict = {};

    for (let k of keys) {
      if (k in this._storage) {
        ev[k] = {oldValue: JSON.parse(this._storage[k])};
        delete this._storage[k];
      }
    }

    this._all_events.send(ev, this._area);
    this.onChanged.send(ev, this._area);
  }

  // istanbul ignore next - implemented only to conform to the interface
  async clear(): Promise<void> {
    await this.remove(Object.keys(this._storage));
  }
}

class SyncStorageArea extends MockStorageArea {
  // Ugh, these values are hard-coded into webextension-polyfill, no other
  // values will work...
  QUOTA_BYTES = 102400 as const;
  QUOTA_BYTES_PER_ITEM = 8192 as const;
  MAX_ITEMS = 512 as const;
  MAX_WRITE_OPERATIONS_PER_HOUR = 1800 as const;
  MAX_WRITE_OPERATIONS_PER_MINUTE = 120 as const;

  constructor(events: events.MockEvent<StorageChangedFn>) {
    super("sync", events);
  }
}

class LocalStorageArea extends MockStorageArea {
  // Ugh, same as above...
  QUOTA_BYTES = 5242880 as const;

  constructor(events: events.MockEvent<StorageChangedFn>) {
    super("local", events);
  }
}

class ManagedStorageArea extends MockStorageArea {
  // Ugh, same as above...
  QUOTA_BYTES = 5242880 as const;

  constructor(events: events.MockEvent<StorageChangedFn>) {
    super("managed", events);
  }
}

type StorageChangedFn = (changes: ChangeDict, area: StorageAreaName) => void;

export default (() => {
  let exports = {
    events: new events.MockEvent<StorageChangedFn>(""),

    reset() {
      exports.events = new events.MockEvent<StorageChangedFn>(
        "browser.storage.onChanged",
      );

      (<any>globalThis).browser.storage = {
        local: new LocalStorageArea(exports.events),
        sync: new SyncStorageArea(exports.events),
        managed: new ManagedStorageArea(exports.events),
        onChanged: exports.events,
      } as Storage.Static;
    },
  };

  exports.reset();

  return exports;
})();

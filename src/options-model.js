import {DeferQueue} from './util';

// The default tab stash options.  DEFAULTS.sync are stored in
// browser.storage.sync, and DEFAULTS.local are stored in browser.storage.local.
//
// Don't use names starting with underscores.  Those are for volatile
// state only.
export const DEFAULTS = {
    sync: {
        // When the user clicks one of the "stash" buttons in the browser
        // toolbar, do we show the "sidebar", "tab", or "none" (of the above)?
        'open_stash_in': 'sidebar',

        // Future/unimplemented options:
        //
        //'sidebar_close_on_restore_group': false,
        //'sidebar_close_on_restore_one': false,
        //'tab_close_on_restore_group': true,
        //'tab_close_on_restore_one': true,
    },

    local: {
        // What's the last version number at which we showed the user an update
        // notification?  "undefined" = either a new install, or an upgrade from
        // an older version which didn't have this option.
        last_notified_version: undefined,
    },
};



// An object representing the Tab Stash options as stored in browser storage.
//
// These options are automatically updated as we receive browser events
// notifying us of changes.  You can get/set individual options by treating this
// Options object exactly as if it were a plain old JavaScript object such as
// DEFAULTS.sync or DEFAULTS.local above.
export class Options {
    // /area/ is either "sync" or "local".
    static async make(area) {
        let store = browser.storage[area];
        let defaults = DEFAULTS[area];

        let evq = new DeferQueue();
        let model;

        browser.storage.onChanged.addListener(
            evq.wrap((changes, a) => {
                if (a === area && changes.options) {
                    Object.assign(model._saved, changes.options.newValue);
                    Object.assign(model, changes.options.newValue);
                }
            }));

        let res = await store.get('options');

        model = new Options(store, defaults, res.options);
        evq.unplug();
        return model;
    }

    constructor(store, defaults, options) {
        Object.defineProperty(this, '_store', {
            enumerable: false,
            writable: false,
            value: store,
        });
        Object.defineProperty(this, '_saved', {
            enumerable: false,
            writable: false,
            value: {},
        });

        for (let k of Object.getOwnPropertyNames(defaults)) {
            Object.defineProperty(this, k, {
                enumerable: true,
                get: () => this._get(k),
                set: v => this._set(k, v),
            });
            if (options && k in options) {
                this._saved[k] = options[k];
            } else {
                this._saved[k] = defaults[k];
            }
        }
    }

    _set(key, value) {
        if (this._saved[key] !== value) {
            this._saved[key] = value;
            this._store.set({options: this._saved}).catch(console.log);
        }
    }

    _get(key, value) {
        return this._saved[key];
    }
}

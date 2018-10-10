import {DeferQueue} from './util';

// The default tab stash options.  For proper descriptions of all of these, you
// should probably have a look at options.vue.
export const DEFAULTS = {
    'open_stash_in': 'sidebar',
    //'sidebar_close_on_restore_group': false,
    //'sidebar_close_on_restore_one': false,
    //'tab_close_on_restore_group': true,
    //'tab_close_on_restore_one': true,
};

// An object representing the Tab Stash options as stored in browser storage.
//
// These options are automatically updated as we receive browser events
// notifying us of changes.  You can get/set individual options by treating this
// Options object exactly as if it were a plain old JavaScript object such as
// DEFAULTS above.
export class Options {
    static async make() {
        let evq = new DeferQueue();
        let model;

        browser.storage.onChanged.addListener(
            evq.wrap((changes, area) => {
                if (changes.options) {
                    console.log(area, changes.options.newValue);
                    Object.assign(model._saved, changes.options.newValue);
                    Object.assign(model, changes.options.newValue);
                }
            }));

        let res = await browser.storage.sync.get('options');

        model = new Options(res.options);
        evq.unplug();
        return model;
    }

    // For one-time querying of options without needing to construct a full
    // event-driven model.  This is less efficient than querying the model if
    // you already have one, but if you just need to query once and don't need
    // to monitor/perform some internal state changes, it's overall simpler and
    // faster than it would be to construct a model.
    static async get(key) {
        let res = await browser.storage.sync.get('options');
        if (! res.options) return DEFAULTS[key];
        if (key in res.options) return res.options[key];
        return DEFAULTS[key];
    }

    constructor(options) {
        Object.defineProperty(this, '_saved', {
            enumerable: false,
            writable: false,
            value: {},
        });

        for (let k of Object.getOwnPropertyNames(DEFAULTS)) {
            Object.defineProperty(this, k, {
                enumerable: true,
                get: () => this._get(k),
                set: v => this._set(k, v),
            });
            if (options && k in options) {
                this._saved[k] = options[k];
            } else {
                this._saved[k] = DEFAULTS[k];
            }
        }
    }

    _set(key, value) {
        if (this._saved[key] !== value) {
            console.log('set', key, value);
            this._saved[key] = value;
            browser.storage.sync.set({options: this._saved}).then(() => {});
        }
    }

    _get(key, value) {
        return this._saved[key];
    }
}

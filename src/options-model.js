import StoredObject from './stored-object';

export default {get};

// Where in browser storage the options are stored.
function get(area) {
    return StoredObject.get(area, 'options', DEFAULTS[area]);
}

// The default tab stash options.  DEFAULTS.sync are stored in
// browser.storage.sync, and DEFAULTS.local are stored in browser.storage.local.
//
// Don't use names starting with underscores.  Those are for volatile
// state only.
const DEFAULTS = {
    sync: {
        // When the user clicks one of the "stash" buttons in the browser
        // toolbar, do we show the "sidebar", "tab", or "none" (of the above)?
        open_stash_in: ['sidebar', (obj, k, v) => {
            if (! ['sidebar', 'tab', 'none'].includes(v)) {
                throw `Invalid value for open_stash_in: ${v}`;
            }
            return v;
        }],
    },

    local: {
        // What's the last version number at which we showed the user an update
        // notification?  "undefined" = either a new install, or an upgrade from
        // an older version which didn't have this option.
        last_notified_version: undefined,
    },
};

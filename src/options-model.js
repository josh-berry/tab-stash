"use strict";

import StoredObject from './stored-object';

// Where in browser storage the options are stored.
function get(area) {
    return StoredObject.get(area, 'options', DEFAULTS[area]);
}

// Some validators for the default options
const multichoice = (...choices) => (obj, k, v) => {
    if (! choices.includes(v)) {
        throw `Invalid value for ${k}: ${v}`;
    }
    return v;
};

const bool = (obj, k, v) => !! v;

const num = (obj, k, v) => parseFloat(v);

// The default tab stash options.  DEFAULTS.sync are stored in
// browser.storage.sync, and DEFAULTS.local are stored in browser.storage.local.
//
// For a variety of reasons, names should be unique across both sync and local
// storage.  (For one thing, this makes migration easier later on if we decide
// to change where an option is stored.  For another, options.vue expects this
// and will break if it's not true.)
const DEFAULTS = {
    sync: {
        // Should we show advanced settings to the user?
        meta_show_advanced: false,

        // When the user clicks one of the "stash" buttons in the browser
        // toolbar, do we show the "sidebar", "tab", or "none" (of the above)?
        open_stash_in: ['sidebar', multichoice('sidebar', 'tab', 'none')],
    },

    local: {
        // What's the last version number at which we showed the user an update
        // notification?  "undefined" = either a new install, or an upgrade from
        // an older version which didn't have this option.
        last_notified_version: undefined,

        // What should we do with a tab once it's been stashed?  'hide' it,
        // 'hide_discard' it or 'close' it?
        after_stashing_tab: [
            'hide', multichoice('hide', 'hide_discard', 'close')],

        // If we 'hide' stashed tabs, should we discard() them if they haven't
        // been used in a while?
        autodiscard_hidden_tabs: [true, bool],

        // Parameters that dictate how aggressive autodiscard_hidden_tabs is.
        autodiscard_interval_min: [2, num],
        autodiscard_min_keep_tabs: [10, num],
        autodiscard_target_tab_count: [50, num],
        autodiscard_target_age_min: [10, num],
    },
};

export default {get, DEFAULTS};

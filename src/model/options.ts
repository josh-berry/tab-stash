import StoredObject, {aBoolean, anEnum, aNumber, aString, maybeUndef} from '../stored-object';
import {Promised} from '../util';

// The default tab stash options.  Sync defaults are stored in
// browser.storage.sync, and local defaults are stored in browser.storage.local.
//
// For a variety of reasons, names should be unique across both sync and local
// storage.  (For one thing, this makes migration easier later on if we decide
// to change where an option is stored.  For another, options.vue expects this
// and will break if it's not true.)

const SYNC_DEF = {
    // Should we show advanced settings to the user?
    meta_show_advanced: {default: false, is: aBoolean},

    // When the user clicks one of the "stash" buttons in the browser
    // toolbar, do we show the "sidebar", "tab", or "none" (of the above)?
    open_stash_in: {
        default: 'sidebar',
        is: anEnum('sidebar', 'tab', 'none'),
    },

    // If we're stashing to a "recent" unnamed folder, how recent is "recent"?
    // If the most recent unnamed folder is older than <X> minutes ago, we will
    // create a new folder instead of appending to the existing one.
    new_folder_timeout_min: {default: 5, is: aNumber},
};

const LOCAL_DEF = {
    // What's the last version number at which we showed the user an update
    // notification?  "undefined" = either a new install, or an upgrade from
    // an older version which didn't have this option.
    last_notified_version: {
        default: undefined,
        is: maybeUndef(aString),
    },

    // What should we do with a tab once it's been stashed?  'hide' it,
    // 'hide_discard' it or 'close' it?
    after_stashing_tab: {
        default: 'hide',
        is: anEnum('hide', 'hide_discard', 'close'),
    },

    // If we 'hide' stashed tabs, should we discard() them if they haven't
    // been used in a while?
    autodiscard_hidden_tabs: {default: true, is: aBoolean},

    // Parameters that dictate how aggressive autodiscard_hidden_tabs is.
    autodiscard_interval_min: {default: 2, is: aNumber},
    autodiscard_min_keep_tabs: {default: 10, is: aNumber},
    autodiscard_target_tab_count: {default: 50, is: aNumber},
    autodiscard_target_age_min: {default: 10, is: aNumber},
};

const EXPORTS = {
    local: () => StoredObject.local('options', LOCAL_DEF),
    sync: () => StoredObject.sync('options', SYNC_DEF),
    LOCAL_DEF,
    SYNC_DEF,
};
export default EXPORTS;

export type LocalOptions = Promised<ReturnType<typeof EXPORTS['local']>>;
export type SyncOptions = Promised<ReturnType<typeof EXPORTS['sync']>>;

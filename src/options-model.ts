import StoredObject from './stored-object';

// The default tab stash options.  Sync defaults are stored in
// browser.storage.sync, and local defaults are stored in browser.storage.local.
//
// For a variety of reasons, names should be unique across both sync and local
// storage.  (For one thing, this makes migration easier later on if we decide
// to change where an option is stored.  For another, options.vue expects this
// and will break if it's not true.)

const SYNC_DEFAULTS = {
    // Should we show advanced settings to the user?
    meta_show_advanced: <boolean>false,

    // When the user clicks one of the "stash" buttons in the browser
    // toolbar, do we show the "sidebar", "tab", or "none" (of the above)?
    open_stash_in: <'sidebar' | 'tab' | 'none'>'sidebar',

    // If we're stashing to a "recent" unnamed folder, how recent is "recent"?
    // If the most recent unnamed folder is older than <X> minutes ago, we will
    // create a new folder instead of appending to the existing one.
    new_folder_timeout_min: <number>10,
};

const LOCAL_DEFAULTS = {
    // What's the last version number at which we showed the user an update
    // notification?  "undefined" = either a new install, or an upgrade from
    // an older version which didn't have this option.
    last_notified_version: <string | undefined>undefined,

    // What should we do with a tab once it's been stashed?  'hide' it,
    // 'hide_discard' it or 'close' it?
    after_stashing_tab: <'hide' | 'hide_discard' | 'close'>'hide',

    // If we 'hide' stashed tabs, should we discard() them if they haven't
    // been used in a while?
    autodiscard_hidden_tabs: <boolean>true,

    // Parameters that dictate how aggressive autodiscard_hidden_tabs is.
    autodiscard_interval_min: <number>2,
    autodiscard_min_keep_tabs: <number>10,
    autodiscard_target_tab_count: <number>50,
    autodiscard_target_age_min: <number>10,
};

export default {
    local: () => StoredObject.get('local', 'options', LOCAL_DEFAULTS),
    sync: () => StoredObject.get('sync', 'options', SYNC_DEFAULTS),
    LOCAL_DEFAULTS,
    SYNC_DEFAULTS,
};

// The default tab stash options.  Sync defaults are stored in
// browser.storage.sync, and local defaults are stored in browser.storage.local.
//
// For a variety of reasons, names should be unique across both sync and local
// storage.  (For one thing, this makes migration easier later on if we decide
// to change where an option is stored.  For another, options.vue expects this
// and will break if it's not true.)

import browser from 'webextension-polyfill';

import {resolveNamed} from '../util';
import stored_object, {
    StoredObject, aBoolean, anEnum, aNumber, aString, maybeUndef
} from '../datastore/stored-object';

export const SHOW_WHAT_OPT = anEnum('sidebar', 'tab', 'popup', 'none');
export const STASH_WHAT_OPT = anEnum('all', 'single', 'none');
export type ShowWhatOpt = ReturnType<typeof SHOW_WHAT_OPT>;
export type StashWhatOpt = ReturnType<typeof STASH_WHAT_OPT>;

export const SHOW_WHAT_DEFAULT = browser.sidebarAction ? 'sidebar' : 'tab';

export type SyncModel = StoredObject<typeof SYNC_DEF>;
export type SyncState = SyncModel['state'];
export const SYNC_DEF = {
    // Should we show advanced settings to the user?
    meta_show_advanced: {default: false, is: aBoolean},

    // When the user stashes from the context menu or address bar button, do we
    // show the "sidebar", "tab", or "none" (of the above)?
    open_stash_in: {
        default: SHOW_WHAT_DEFAULT,
        is: SHOW_WHAT_OPT,
    },

    // When the user clicks the browser toolbar button, what tabs do we stash?
    browser_action_stash: {
        default: 'all',
        is: STASH_WHAT_OPT,
    },

    // When the user clicks the browser toolbar button, what UI do we show?
    browser_action_show: {
        default: SHOW_WHAT_DEFAULT,
        is: SHOW_WHAT_OPT,
    },

    // In the stash list, show all open tabs at the top instead of just the
    // unstashed tabs.
    show_all_open_tabs: {
        default: false,
        is: aBoolean,
    },

    // How big should the spacing/fonts be?
    ui_metrics: {
        default: 'normal',
        is: anEnum('normal', 'compact'),
    },

    // What color scheme should the UI use?
    ui_theme: {
        default: 'system',
        is: anEnum('system', 'light', 'dark'),
    },

    // If we're stashing to a "recent" unnamed folder, how recent is "recent"?
    // If the most recent unnamed folder is older than <X> minutes ago, we will
    // create a new folder instead of appending to the existing one.
    new_folder_timeout_min: {default: 5, is: aNumber},

    // How long should we keep deleted items for?
    deleted_items_expiration_days: {default: 180, is: aNumber},
} as const;

export type LocalModel = StoredObject<typeof LOCAL_DEF>;
export type LocalState = LocalModel['state'];
export const LOCAL_DEF = {
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

    // Feature flags
    ff_popup_view: {default: false, is: aBoolean},

    /** Re-open a recently-closed tab if one can't be found.  Disabled by
     * default because of bugs in Firefox.  See #188. */
    ff_restore_closed_tabs: {default: false, is: aBoolean},
} as const;

export type Source = {
    readonly sync: StoredObject<typeof SYNC_DEF>;
    readonly local: StoredObject<typeof LOCAL_DEF>;
};

export class Model {
    readonly sync: StoredObject<typeof SYNC_DEF>;
    readonly local: StoredObject<typeof LOCAL_DEF>;

    static async live(): Promise<Model> {
        return new Model(await resolveNamed({
            sync: stored_object('sync', 'options', SYNC_DEF),
            local: stored_object('local', 'options', LOCAL_DEF),
        }));
    }

    constructor(src: Source) {
        this.sync = src.sync;
        this.local = src.local;
    }
}

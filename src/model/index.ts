// All Tab Stash data models live in here somewhere, directly or indirectly.
//
// <aside>
// This generally follows Vuex/the Flux design pattern, but I don't use Vuex
// because I find Vuex to be proscriptive in ways that aren't helpful/actually
// hinder rapid development.  For example, with KVS-based models, I commonly
// want to keep a non-reactive Map which is a cache of records I've seen, so I
// can quickly tell what's part of the state already and what's new.  But this
// isn't possible with Vuex since it places strong limits on how the state is
// accessed during mutations.
//
// Also, a lot of these Vuex limitations seem to be driven by the need to keep
// the state read-only unless it's being accessed thru a mutation.  IMO this is
// done more reliably and with less runtime overhead at compile time.  So this
// is the approach I will take once I get the TypeScript typings worked out.
// </aside>
//
// That said, models generally export three things:
//
// - Source :: A type indicating the data source for the model (e.g. other
//   models, a KVS, a StoredObject, etc.).  A Source is usually necessary to
//   construct a model.
//
// - State :: (optional) A read-only, JSON-ifiable data structure which can be
//   used to read data out of the model.  The state is expected to be reactive
//   so that Vue can observe it.
//
// - Model :: The model itself--typically a class or other "smart" data
//   structure that uses the Source to produce state, and provides methods for
//   mutating and accessing the state in various ways that a user might want to
//   perform.  All the business logic resides here.

import * as BrowserSettings from './browser-settings';
import * as Options from './options';

import * as Tabs from './tabs';
import * as Bookmarks from './bookmarks';
import * as DeletedItems from './deleted-items';

import * as Favicons from './favicons';
import * as BookmarkMetadata from './bookmark-metadata';

export {
    BrowserSettings, Options, Tabs, Bookmarks, DeletedItems, Favicons,
    BookmarkMetadata,
};

export type Source = {
    readonly browser_settings: BrowserSettings.Model;
    readonly options: Options.Model,

    readonly tabs: Tabs.Model;
    readonly bookmarks: Bookmarks.Model;
    readonly deleted_items: DeletedItems.Model,

    readonly favicons: Favicons.Model;
    readonly bookmark_metadata: BookmarkMetadata.Model;
};

/** The One Model To Rule Them All.
 *
 * Almost every bit of Tab Stash state is in here somewhere.  (And eventually,
 * every single bit of state WILL be in here).
 */
export class Model {
    readonly browser_settings: BrowserSettings.Model;
    readonly options: Options.Model;

    readonly tabs: Tabs.Model;
    readonly bookmarks: Bookmarks.Model;
    readonly deleted_items: DeletedItems.Model;

    readonly favicons: Favicons.Model;
    readonly bookmark_metadata: BookmarkMetadata.Model;

    constructor(src: Source) {
        this.browser_settings = src.browser_settings;
        this.options = src.options;

        this.tabs = src.tabs;
        this.bookmarks = src.bookmarks;
        this.deleted_items = src.deleted_items;

        this.favicons = src.favicons;
        this.bookmark_metadata = src.bookmark_metadata;
    }
};

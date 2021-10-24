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

import browser from 'webextension-polyfill';

import {filterMap, TaskMonitor, urlToOpen} from '../util';

import * as BrowserSettings from './browser-settings';
import * as Options from './options';

import * as Tabs from './tabs';
import * as Bookmarks from './bookmarks';
import * as DeletedItems from './deleted-items';

import * as Favicons from './favicons';
import * as BookmarkMetadata from './bookmark-metadata';
import * as Selection from './selection';

export {
    BrowserSettings, Options, Tabs, Bookmarks, DeletedItems, Favicons,
    BookmarkMetadata,
};

/** The StashItem is anything that can be placed in the stash.  It could already
 * be present as a tab (`id: number`), a bookmark (`id: string`), or not present
 * at all (no `id`).  It captures just the essential details of an item, like
 * its title, URL and identity (if it's part of the model). */
export type StashItem = {
    id?: string | number,
    title?: string,
    url?: string,
};

/** An actual bookmark/tab that is part of the model. */
export type ModelItem = Bookmarks.Node | Tabs.Tab;

export function isTab(item?: StashItem): item is StashItem & {id: Tabs.TabID} {
    if (! item) return false;
    return (typeof item.id === 'number');
}

export function isBookmark(item?: StashItem): item is StashItem & {id: Bookmarks.NodeID} {
    if (! item) return false;
    return (typeof item.id === 'string');
}

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
 *
 * This is also the place where a lot of Tab Stash-specific logic lives, like
 * how to move tabs/bookmarks back and forth between, well, tabs and bookmarks.
 */
export class Model {
    readonly browser_settings: BrowserSettings.Model;
    readonly options: Options.Model;

    readonly tabs: Tabs.Model;
    readonly bookmarks: Bookmarks.Model;
    readonly deleted_items: DeletedItems.Model;

    readonly favicons: Favicons.Model;
    readonly bookmark_metadata: BookmarkMetadata.Model;
    readonly selection: Selection.Model;

    constructor(src: Source) {
        this.browser_settings = src.browser_settings;
        this.options = src.options;

        this.tabs = src.tabs;
        this.bookmarks = src.bookmarks;
        this.deleted_items = src.deleted_items;

        this.favicons = src.favicons;
        this.bookmark_metadata = src.bookmark_metadata;
        this.selection = new Selection.Model([this.tabs, this.bookmarks]);
    }

    //
    // Accessors
    //

    /** Fetch and return an item, regardless of whether it's a bookmark or tab. */
    item(id: string | number): ModelItem {
        if (typeof id === 'string') return this.bookmarks.node(id as Bookmarks.NodeID);
        else if (typeof id === 'number') return this.tabs.tab(id as Tabs.TabID);
        // istanbul ignore next
        else throw new Error(`Invalid model ID: ${id}`);
    }

    /** Is the passed-in URL one we want to include in the stash?  Excludes
     * things like new-tab pages and Tab Stash pages (so we don't stash
     * ourselves). */
    isURLStashable(url_str?: string): boolean {
        // Things without URLs are not stashable.
        if (! url_str) return false;

        // New-tab URLs, homepages and the like are never stashable.
        if (this.browser_settings.isNewTabURL(url_str)) return false;

        // Tab Stash URLs are never stashable.
        return ! url_str.startsWith(browser.runtime.getURL(''));
    }

    /** If the topmost folder in the stash root is an unnamed folder which was
     * created recently, return its ID.  Otherwise return `undefined`.  Used to
     * determine where to place single bookmarks we are trying to stash, if we
     * don't already know where they should go. */
    mostRecentUnnamedFolderId(): Bookmarks.NodeID | undefined {
        const root = this.bookmarks.stash_root.value;
        if (! root) return undefined;

        const topmost = root.children
            ? this.bookmarks.node(root.children[0]) : undefined;

        // Is there a top-most item under the root folder, and is it a folder?
        if (! topmost || ! ('children' in topmost)) return undefined;

        // Does the folder have a name which looks like a default name?
        if (! Bookmarks.getDefaultFolderNameISODate(topmost.title)) return undefined;

        // Did something create/update this folder recently?
        // #cast dateAdded is always present on folders
        const age_cutoff = Date.now() - this.options.sync.state.new_folder_timeout_min *60*1000;
        if (topmost.dateAdded! < age_cutoff) {
            return undefined;
        }

        // If so, we can put new stuff here by default.  (Otherwise we should
        // probably assume this isn't recent enough and a new folder should be
        // created.)
        return topmost.id;
    }

    /** Yields all selected items (tabs and bookmarks). */
    *selectedItems(): Generator<ModelItem> {
        for (const item of this.tabs.selectedItems()) yield item;
        for (const item of this.bookmarks.selectedItems()) yield item;
    }

    //
    // Mutators
    //

    /** Garbage-collect various caches and deleted items. */
    async gc() {
        const deleted_exp = Date.now() -
            this.options.sync.state.deleted_items_expiration_days * 24*60*60*1000;

        await this.deleted_items.dropOlderThan(deleted_exp);
        await this.favicons.gc(url =>
            this.bookmarks.bookmarksWithURL(url).size > 0
            || this.tabs.tabsWithURL(url).size > 0);
        await this.bookmark_metadata.gc(id => {
            try {
                this.bookmarks.node(id as Bookmarks.NodeID);
                return true;
            } catch (e) { return false; }
        });
    }

    /** Stash either all tabs (if none are selected) or the selected tabs in the
     * window `windowId` (or the current window, if `windowId` is undefined).
     *
     * If `folderId` is not specified, stashes into a new unnamed folder.
     *
     * If `close` is true, closes/hides the stashed tabs according to the user's
     * preferences. */
    async stashTabsInWindow(
        windowId: Tabs.WindowID,
        options: {
            folderId?: Bookmarks.NodeID,
            close?: boolean
        }
    ): Promise<void> {
        const tabs = this.tabs.window(windowId).tabs
            .map(tid => this.tabs.tab(tid))
            .filter(t => ! t.hidden);

        let selected = tabs.filter(t => t.highlighted);
        if (selected.length <= 1) {
            // If the user didn't specifically select a set of tabs to be
            // stashed, we ignore tabs which should not be included in the stash
            // for whatever reason (e.g. the new tab page).
            selected = tabs.filter(t => this.isURLStashable(t.url));
        }

        // We filter out pinned tabs AFTER checking how many tabs are selected
        // because otherwise the user might have a pinned tab focused, and highlight
        // a single specific tab they want stashed (in addition to the active
        // pinned tab), and then ALL tabs would unexpectedly get stashed. [#61]
        selected = selected.filter(t => ! t.pinned);

        await this.stashTabs(selected, options);
    }

    /** Stashes the specified tabs into a bookmark folder.
     *
     * If `folderId` is not specified, stashes into a new unnamed folder.
     *
     * If `close` is true, closes/hides the stashed tabs according to the user's
     * preferences. */
    async stashTabs(
        tabs: StashItem[],
        options: {
            folderId?: Bookmarks.NodeID,
            close?: boolean
        }
    ): Promise<void> {
        const saved_tabs = (await this.bookmarkTabs(options.folderId, tabs)).tabs;

        if (options.close) {
            await this.hideOrCloseStashedTabs(
                filterMap(saved_tabs, t => t.id as Tabs.TabID));
        }
    }

    /** Saves `all_tabs` to the target bookmark folder (if specified) or creates
     * a new folder (if not).  Returns the tabs that were actually stashed, the
     * newly-created bookmarks, and the ID of the folder where they were
     * created.
     *
     * *NOTE:* The returned tabs and bookmarks are not reactive, because in the
     * interest of minimizing latency, we don't wait for the model to update
     * itself. */
    async bookmarkTabs(
        folderId: Bookmarks.NodeID | undefined,
        all_tabs: StashItem[],
        options?: {newFolderTitle?: string, taskMonitor?: TaskMonitor},
    ): Promise<BookmarkTabsResult> {
        // Figure out which of the tabs to save.  We ignore tabs with
        // unparseable URLs or which look like extensions and internal browser
        // things.
        //
        // We filter out all tabs without URLs below. #cast
        const tabs = <(StashItem & {url: string})[]>
            all_tabs.filter(t => t.url && this.isURLStashable(t.url));

        // If there are no tabs to save, early-exit here so we don't
        // unnecessarily create bookmark folders we don't need.
        if (tabs.length == 0) {
            return {tabs: [], bookmarks: []};
        }

        // Find or create the root of the stash.
        const root = await this.bookmarks.ensureStashRoot();

        // Keep track of which tabs to actually save (we filter below based on
        // what we already have), and where in the folder to save them (we want
        // to append).
        let tabs_to_actually_save = tabs;
        let newFolderId: undefined | string = undefined;

        if (folderId === undefined) {
            // Create a new folder, if it wasn't specified.
            if (options?.newFolderTitle) {
                const folder = await browser.bookmarks.create({
                    parentId: root.id,
                    title: options?.newFolderTitle
                        ?? Bookmarks.genDefaultFolderName(new Date()),
                    index: 0, // Newest folders should show up on top
                });
                folderId = folder.id as Bookmarks.NodeID;
            } else {
                folderId = await this.ensureRecentUnnamedFolder();
            }
            newFolderId = folderId;

            // When saving to this folder, we want to save all tabs we
            // previously identified as "save-worthy", and we want to insert
            // them at the beginning of the folder.  So, no changes to
            // /tabs_to_actually_save/ or /index/ here.

        } else {
            // If we're adding to an existing folder, skip bookmarks which
            // already exist in that folder.
            //
            // Note, however, that these tabs are still considered "saved" for
            // the purposes of this function, because the already appear in the
            // folder.  So it's okay for callers to assume that we saved
            // them--that's why we use a separate /tabs_to_actually_save/ array
            // here.
            const folder = this.bookmarks.folder(folderId);
            const existing_bms = filterMap(folder.children, id => {
                const node = this.bookmarks.node(id);
                if ('url' in node) return node.url;
                return undefined;
            });

            tabs_to_actually_save = tabs_to_actually_save.filter(
                tab => ! existing_bms.includes(tab.url));
        }

        // Now save each tab as a bookmark.
        const bookmarks = await this.putItemsInFolder({
            items: tabs_to_actually_save,
            toFolderId: folderId,
            task: options?.taskMonitor,
        });
        return {
            tabs: tabs.filter(t => isTab(t)) as Tabs.Tab[],
            bookmarks: bookmarks.map(id => this.bookmarks.bookmark(id)),
            newFolderId,
        };
    }

    /** Hide/discard/close the specified tabs, according to the user's settings
     * for what to do with stashed tabs.  Creates a new tab if necessary to keep
     * the browser window(s) open. */
    async hideOrCloseStashedTabs(tabIds: Tabs.TabID[]): Promise<void> {
        await this.tabs.refocusAwayFromTabs(tabIds);

        // Clear any highlights/selections on tabs we are stashing
        await Promise.all(
            tabIds.map(tid => browser.tabs.update(tid, {highlighted: false})));

        // istanbul ignore else -- hide() is always available in tests
        if (browser.tabs.hide) {
            // If the browser supports hiding tabs, then hide or close them
            // according to the user's preference.
            switch (this.options.local.state.after_stashing_tab) {
            case 'hide_discard':
                await browser.tabs.hide(tabIds);
                await browser.tabs.discard(tabIds);
                break;
            case 'close':
                await browser.tabs.remove(tabIds);
                break;
            case 'hide':
            default:
                await browser.tabs.hide(tabIds);
                break;
            }

        } else {
            // The browser does not support hiding tabs, so our only option is
            // to close them.
            await browser.tabs.remove(tabIds);
        }
    }

    /** Restores the specified URLs as new tabs in the current window.  Returns
     * the IDs of the restored tabs.
     *
     * Note that if a tab is already open and not hidden, we will do nothing,
     * since we don't want to open duplicate tabs.  Such tabs will not be
     * included in the returned list. */
    async restoreTabs(
        urls: string[],
        options: {background?: boolean}
    ): Promise<Tabs.TabID[]> {
        if (this.tabs.current_window === undefined) {
            throw new Error(`Not sure what the current window is`);
        }

        // As a special case, if we are restoring just a single tab, first check
        // if we already have the tab open and just switch to it.  (No need to
        // disturb the ordering of tabs in the browser window.)
        if (! options.background && urls.length === 1 && urls[0]) {
            const t = Array.from(this.tabs.tabsWithURL(urls[0]))
                .find(t => t.url === urls[0] && ! t.hidden
                        && t.windowId === this.tabs.current_window);
            if (t) {
                await browser.tabs.update(t.id, {active: true});
                return [t.id];
            }
        }

        // Remove duplicate URLs so we only try to restore each URL once.
        const url_set = new Set(filterMap(urls, url => url));

        // We want to know what tabs are currently open in the window, so we can
        // avoid opening duplicates.
        const win_tabs = this.tabs.window(this.tabs.current_window).tabs
            .map(tid => this.tabs.tab(tid));

        // We want to know which tab the user is currently looking at so we can
        // close it if it's just the new-tab page.
        const active_tab = win_tabs.filter(t => t.active)[0];

        const tab_ids = await this.putItemsInWindow({
            // NOTE: We rely on the fact that Set always remembers the order in
            // which items were inserted to be sure that tabs are always
            // restored in the correct order.
            items: Array.from(url_set).map(url => ({url})),
            toWindowId: this.tabs.current_window
        });

        if (! options.background) {
            // Switch to the last tab that we restored (if desired).  We choose
            // the LAST tab to behave similarly to the user having just opened a
            // bunch of tabs.
            if (tab_ids.length > 0) {
                await browser.tabs.update(tab_ids[tab_ids.length - 1], {active: true});
            }

            // Finally, if we opened at least one tab, AND we were looking at
            // the new-tab page, close the new-tab page in the background.
            if (tab_ids.length > 0
                && this.browser_settings.isNewTabURL(active_tab.url ?? '')
                && active_tab.status === 'complete')
            {
                browser.tabs.remove([active_tab.id]).catch(console.log);
            }
        }

        return tab_ids;
    }

    /** Returns the ID of an unnamed folder at the top of the stash, creating a
     * new one if necessary. */
    async ensureRecentUnnamedFolder(): Promise<Bookmarks.NodeID> {
        const stash_root = await this.bookmarks.ensureStashRoot();
        const id = this.mostRecentUnnamedFolderId();

        if (id !== undefined) return id;

        const bm = await browser.bookmarks.create({
            parentId: stash_root.id,
            title: Bookmarks.genDefaultFolderName(new Date()),
            index: 0,
        });
        return bm.id as Bookmarks.NodeID;
    }

    /** Moves or copies items (bookmarks, tabs, and/or external items) to a
     * particular location in a particular bookmark folder.
     *
     * When `move` is true, if the source item is a bookmark, it will be moved
     * directly (so the ID remains the same).  If it's a tab, the tab will be
     * closed once the bookmark is created.  External items (without an ID) will
     * simply be created as new bookmarks, regardless of `move`. */
    async putItemsInFolder(options: {
        move?: boolean,
        items: StashItem[],
        toFolderId: Bookmarks.NodeID,
        toIndex?: number,
        task?: TaskMonitor,
    }): Promise<Bookmarks.NodeID[]> {
        // First we try to find the folder we're moving to.
        const to_folder = this.bookmarks.folder(options.toFolderId);

        // Then we adjust our items depending on whether we're moving or
        // copying.
        let items = options.items;
        if (! options.move) {
            // NIFTY HACK: If we remove all the item IDs, putItemsInFolder()
            // will effectively just copy, because it looks like we're "moving"
            // items not in the stash already.
            items = items.map(({title, url}) => ({title, url}));
        }

        // Note: We explicitly DON'T check stashability here because the caller
        // has presumably done this for us--and has explicitly chosen what to
        // put in the folder.

        if (options.task) options.task.max = options.items.length;

        // Now, we move everything into the folder.  `to_index` is maintained as
        // the insertion point (i.e. the next inserted item should have index
        // `to_index`).
        const moved_item_ids: Bookmarks.NodeID[] = [];
        const close_tab_ids: Tabs.TabID[] = [];

        for (
            let i = 0,
                to_index = options.toIndex ?? to_folder.children.length;
            i < items.length;
            ++i, ++to_index, options.task && ++options.task.value
        ) {
            const item = items[i];
            const model_item = item.id !== undefined ? this.item(item.id) : undefined;

            // If it's a bookmark, just move it directly.
            if (isBookmark(model_item)) {
                const pos = this.bookmarks.positionOf(model_item);
                await this.bookmarks.move(model_item.id, to_folder.id, to_index);
                moved_item_ids.push(model_item.id);
                if (pos.parent === to_folder && pos.index < to_index) {
                    // Because we are moving items which appear in the list
                    // before the insertion point, the insertion point shouldn't
                    // move--the index of the moved item is actually to_index -
                    // 1, so the location of the next item should still be
                    // to_index.
                    --to_index;
                }
                continue;
            }

            // If it's a tab, mark the tab for closure.
            if (isTab(item)) close_tab_ids.push(item.id);

            // Otherwise, we treat tabs and external items the same (i.e. just
            // create a new bookmark).
            //
            // TODO fill in title/icon details if missing?
            const bm = await browser.bookmarks.create({
                title: item.title || item.url,
                url: item.url,
                parentId: to_folder.id,
                index: to_index,
            });
            moved_item_ids.push(bm.id as Bookmarks.NodeID);
        }

        // Hide/close any tabs which were moved from, since they are now
        // (presumably) in the stash.
        await this.hideOrCloseStashedTabs(close_tab_ids);

        return moved_item_ids;
    }

    /** Move or copy items (bookmarks, tabs, and/or external items) to a
     * particular location in a particular window.  Tabs which are
     * moved/created/restored will NOT be active (i.e. they will always be in
     * the background).
     *
     * When `move` is true, if the source item is a tab, it will be moved
     * directly (so the ID remains the same).  If it's a bookmark, a new tab
     * will be created or an existing hidden/closed tab will be restored and
     * moved into the right place.  External items (without an ID) will simply
     * be created as new tabs, regardless of `move`. */
    async putItemsInWindow(options: {
        move?: boolean,
        items: StashItem[],
        toWindowId: Tabs.WindowID,
        toIndex?: number,
        task?: TaskMonitor,
    }): Promise<Tabs.TabID[]> {
        const to_win_id = options.toWindowId;
        const win = this.tabs.window(to_win_id);

        // Try to figure out where to move items from, or if new tabs need to be
        // created fresh.  (We don't worry about restoring recently-closed tabs
        // yet; those are handled differently.)
        let items = options.items;
        if (! options.move) {
            // If we're copying instead of moving, just remove all the item IDs,
            // which will leave the sources alone.
            items = items.map(({title, url}) => ({title, url}));
        }

        // We want to know what tabs were recently closed, so we can
        // restore/un-hide tabs as appropriate.
        //
        // TODO Unit tests don't support sessions yet
        const closed_tabs = !! browser.sessions?.getRecentlyClosed
            ? await browser.sessions.getRecentlyClosed()
            : [];

        if (options.task) options.task.max = items.length + 1;

        // Keep track of which tabs we are moving/have already stolen.  A tab
        // can be "stolen" if we have a non-tab item with a URL that matches a
        // tab which we are not already moving--in this case, we "steal" the
        // already-open tab so we don't have to open a duplicate.
        const dont_steal_tabs = new Set<Tabs.TabID>(filterMap(items, i => {
            if (! isTab(i)) return undefined;
            return i.id;
        }));

        // Now, we move/restore tabs.
        const moved_item_ids: Tabs.TabID[] = [];
        const delete_bm_ids: Bookmarks.NodeID[] = [];

        for (
            let i = 0,
                to_index = options.toIndex ?? win.tabs.length;
            i < items.length;
            ++i, ++to_index, options.task && ++options.task.value
        ) {
            const item = items[i];
            const model_item = item.id !== undefined ? this.item(item.id) : undefined;

            // If the item we're moving is a tab, just move it into place.
            if (isTab(model_item)) {
                const pos = this.tabs.positionOf(model_item);
                await this.tabs.move(model_item.id, to_win_id, to_index);
                moved_item_ids.push(model_item.id);
                dont_steal_tabs.add(model_item.id);

                if (pos.window === win && pos.index < to_index) {
                    // This is a rotation in the same window; since move() first
                    // removes and then adds the tab, we need to decrement
                    // toIndex so the moved tab ends up in the right place.
                    --to_index;
                }
                continue;
            }

            // If we're "moving" a bookmark into a window, mark the bookmark
            // for deletion later.
            if (isBookmark(model_item)) delete_bm_ids.push(model_item.id);

            // If the item we're moving is not a tab, we need to create a
            // new tab or restore an old one from somewhere else.
            //
            // TODO: Don't do too many of these at once because the browser
            // will fall over.

            const url = item.url;
            if (! url) {
                // No URL? Don't bother restoring anything.
                --to_index;
                continue;
            }

            // First let's see if we have another tab we can just "steal"--that
            // is, move into place to represent the source item (which,
            // remember, is NOT ITSELF A TAB).
            //
            // There is a dual purpose here--we want to reuse hidden tabs where
            // possible, but we also try to move other tabs from the current
            // window so that we don't end up creating duplicates for the user.
            const already_open = Array.from(this.tabs.tabsWithURL(url))
                .filter(t => ! dont_steal_tabs.has(t.id) && ! t.pinned)
                .sort((a, b) => (-a.hidden) - (-b.hidden)); // prefer hidden tabs
            if (already_open.length > 0) {
                const t = already_open[0];
                const pos = this.tabs.positionOf(t);

                if (t.hidden && !! browser.tabs.show) await browser.tabs.show(t.id);

                await browser.tabs.move(t.id, {windowId: to_win_id, index: to_index});
                if (pos.window === win && pos.index < to_index) --to_index;
                moved_item_ids.push(t.id);
                dont_steal_tabs.add(t.id);
                continue;
            }

            // If we don't have a tab to move, let's see if a tab was recently
            // closed that we can restore.
            const closed = filterMap(closed_tabs, s => s.tab).find(tabLookingAtP(url));
            if (closed) {
                // Remember the active tab in this window (if any), because
                // restoring a recently-closed tab will disturb the focus.
                const active_tab = win.tabs
                    .map(tid => this.tabs.tab(tid))
                    .find(t => t.active);

                const t = (await browser.sessions.restore(closed.sessionId!)).tab!;
                await browser.tabs.move(t.id!, {windowId: to_win_id, index: to_index});

                // Reset the focus to the previously-active tab. (We do this
                // immediately, inside the loop, so as to minimize any
                // flickering the user might see.)
                if (active_tab) {
                    await browser.tabs.update(active_tab.id, {active: true});
                }

                moved_item_ids.push(t.id as Tabs.TabID);
                dont_steal_tabs.add(t.id as Tabs.TabID);
                continue;
            }

            // Else we just need to create a completely new tab.
            const t = await browser.tabs.create({
                active: false, url: urlToOpen(url), windowId:
                to_win_id, index: to_index,
            });
            moved_item_ids.push(t.id as Tabs.TabID);
            dont_steal_tabs.add(t.id as Tabs.TabID);
        }

        // Delete bookmarks for all the tabs we restored.
        await Promise.all(delete_bm_ids.map(bm => browser.bookmarks.remove(bm)));
        if (options.task) ++options.task.value;

        return moved_item_ids;
    }

    /** Deletes the specified bookmark subtree, saving it to deleted items.  You
     * should use {@link deleteBookmark()} for individual bookmarks, because it
     * will cleanup the parent folder if the parent folder has a "default" name
     * and would be empty. */
    async deleteBookmarkTree(id: Bookmarks.NodeID) {
        const bm = this.bookmarks.node(id);

        const toDelItem = (item: Bookmarks.Node): DeletedItems.DeletedItem => {
            if ('children' in item) return {
                title: item.title ?? '',
                children: filterMap(item.children, i =>
                    i && toDelItem(this.bookmarks.node(i))),
            };

            if ('url' in item) return {
                title: item.title ?? item.url ?? '',
                url: item.url ?? '',
                favIconUrl: this.favicons.get(item.url!).value?.favIconUrl
                    || undefined,
            };

            return {title: '', url: ''};
        };

        await this.deleted_items.add(toDelItem(bm));
        await browser.bookmarks.removeTree(bm.id);
    }

    /** Deletes the specified bookmark, saving it to deleted items.  If it was
     * the last bookmark in its parent folder, AND the parent folder has a
     * "default" name, removes the parent folder as well. */
    async deleteBookmark(bm: Bookmarks.Bookmark) {
        const parent = this.bookmarks.folder(bm.parentId!);

        await this.deleted_items.add({
            title: bm.title ?? '<no title>',
            url: bm.url ?? 'about:blank',
            favIconUrl: this.favicons.get(bm.url!)?.value?.favIconUrl || undefined,
        }, parent ? {
            folder_id: parent.id,
            title: parent.title!,
        } : undefined);

        await browser.bookmarks.remove(bm.id);

        if (! parent) return;
        await this.bookmarks.removeFolderIfEmptyAndUnnamed(parent?.id);
    }

    /** Un-delete a deleted item.  Removes it from deleted_items and adds it
     * back to bookmarks, hopefully in approximately the same place it was in
     * before. */
    async undelete(deletion: DeletedItems.Deletion): Promise<void> {
        const di = this.deleted_items;
        // We optimistically remove immediately from recentlyDeleted to prevent
        // users from trying to un-delete the same thing multiple times.
        di.state.recentlyDeleted = di.state.recentlyDeleted.filter(
            ({key: k}) => k !== deletion.key);

        const stash_root = await this.bookmarks.ensureStashRoot();

        if ('children' in deletion.item) {
            // Restoring an entire folder of bookmarks; just put it at the root.
            const folder = await browser.bookmarks.create({
                parentId: stash_root.id,
                title: deletion.item.title,
                index: 0,
            });
            const fid = folder.id as Bookmarks.NodeID;
            await this.putItemsInFolder({
                items: deletion.item.children,
                toFolderId: fid,
            });

            // Restore their favicons.
            for (const c of deletion.item.children) {
                if (! ('url' in c && c.favIconUrl)) continue;
                this.favicons.maybeSet(c.url, c.favIconUrl);
            }

        } else {
            // We're restoring an individual bookmark.  Try to find where to put
            // it, IF we remember where it came from.
            let folderId: Bookmarks.NodeID | undefined;

            if (deletion.deleted_from) {
                const from = deletion.deleted_from;
                try {
                    this.bookmarks.folder(from.folder_id as Bookmarks.NodeID);
                    // The exact bookmark we want still exists, use it
                    folderId = from.folder_id as Bookmarks.NodeID;
                } catch (_) {
                    // Search for an existing folder inside the stash root with
                    // the same name as the folder it was deleted from.
                    const child = stash_root.children
                        .map(id => this.bookmarks.node(id))
                        .find(c => 'children' in c && c.title === from.title);
                    if (child) folderId = child.id;
                }
            }

            // If we still don't know where it came from or its prior containing
            // folder was deleted, just put it in an unnamed folder.
            if (! folderId) folderId = await this.ensureRecentUnnamedFolder();

            // Restore the bookmark.
            await this.bookmarkTabs(folderId, [deletion.item]);

            // Restore its favicon.
            if (deletion.item.favIconUrl) {
                this.favicons.maybeSet(deletion.item.url, deletion.item.favIconUrl);
            }
        }

        await di.drop(deletion.key);
    }

    /** Un-delete a single child item inside a deleted folder.  Removes it from
     * deleted_items and re-stashes it as if it were a single stashed tab, into
     * a new (or recent) unnamed folder. */
    async undeleteChild(
        deletion: DeletedItems.Deletion,
        childIndex: number
    ): Promise<void> {
        // istanbul ignore if
        if (! ('children' in deletion.item)) {
            throw new Error(`Deletion ${deletion.key} is not a folder`);
        }

        const child = deletion.item.children[childIndex];
        if (! child) return;

        await this.bookmarkTabs(this.mostRecentUnnamedFolderId(), [child]);

        if ('url' in child && child.favIconUrl) {
            this.favicons.maybeSet(child.url, child.favIconUrl);
        }

        await this.deleted_items.dropChildItem(deletion.key, childIndex);
    }
};

export type BookmarkTabsResult = {
    tabs: Tabs.Tab[],
    bookmarks: Bookmarks.Bookmark[],
    newFolderId?: string,
};



//
// Private helper functions
//

/** Returns a function which returns true if a tab is looking at a particular
 * URL, taking into account any transformations done by urlToOpen(). */
function tabLookingAtP(url: string): (t?: {url?: string}) => boolean {
    const open_url = urlToOpen(url);
    return (t?: {url?: string}) => {
        if (! t || ! t.url) return false;
        const to_url = urlToOpen(t.url);
        return t.url === url || t.url === open_url
            || to_url === url || to_url === open_url;
    };
}

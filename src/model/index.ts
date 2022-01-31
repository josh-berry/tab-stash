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

import {
    backingOff, expect, filterMap, shortPoll, TaskMonitor,
    textMatcher, tryAgain, urlToOpen
} from '../util';
import {logError, logErrorsFrom} from '../util/oops';

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
    $selected?: boolean,
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

    /** Reload model data (where possible) in the event of an unexpected issue.
     * This should be used sparingly as it's quite expensive. */
    readonly reload = backingOff(async () => {
        await Promise.all([
            this.tabs.reload(),
            this.bookmarks.reload(),
            this.browser_settings.reload(),
        ]);
    });

    /** Run an async function.  If it throws, reload the model (to try to
     * eliminate any inconsistencies) and log the error for further study. */
    async attempt<R>(fn: () => Promise<R>): Promise<R> {
        try {
            return await fn();
        } catch (e) {
            logError(e);
            logErrorsFrom(async () => this.reload());
            throw e;
        }
    }

    //
    // Accessors
    //

    /** Fetch and return an item, regardless of whether it's a bookmark or tab. */
    item(id: string | number): ModelItem | undefined {
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

        // Invalid URLs are not stashable.
        try {
            new URL(url_str);
        } catch (e) { return false; }

        // Tab Stash URLs are never stashable.
        return ! url_str.startsWith(browser.runtime.getURL(''));
    }

    /** If the topmost folder in the stash root is an unnamed folder which was
     * created recently, return its ID.  Otherwise return `undefined`.  Used to
     * determine where to place single bookmarks we are trying to stash, if we
     * don't already know where they should go. */
    mostRecentUnnamedFolder(): Bookmarks.Folder | undefined {
        const root = this.bookmarks.stash_root.value;
        if (! root) return undefined;

        const topmost = root.children && root.children[0] !== undefined
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
        return topmost;
    }

    /** Yields all selected items (tabs and bookmarks). */
    *selectedItems(): Generator<ModelItem> {
        for (const item of this.tabs.selectedItems()) yield item;
        for (const item of this.bookmarks.selectedItems()) yield item;
    }

    /** Returns a list of tabs in a given window which should be stashed.
     *
     * This will exclude things like pinned and hidden tabs, or tabs with
     * privileged URLs.  If a window has multiple selected tabs (i.e. the user
     * has made an explicit choice about what to stash), only the selected tabs
     * will be returned.
     */
    stashableTabsInWindow(windowId: Tabs.WindowID): Tabs.Tab[] {
        const win = expect(this.tabs.window(windowId),
            () => `Trying to stash tabs to unknown window ${windowId}`);
        const tabs = this.tabs.tabsIn(win).filter(t => ! t.hidden);

        let selected = tabs.filter(t => t.highlighted);
        if (selected.length <= 1) {
            // If the user didn't specifically select a set of tabs to be
            // stashed, we ignore tabs which should not be included in the stash
            // for whatever reason (e.g. the new tab page).  If the user DID
            // explicitly select such tabs, however, we should include them (and
            // they will be restored using the privileged-tabs approach).
            selected = tabs.filter(t => this.isURLStashable(t.url));
        }

        // We filter out pinned tabs AFTER checking how many tabs are selected
        // because otherwise the user might have a pinned tab focused, and highlight
        // a single specific tab they want stashed (in addition to the active
        // pinned tab), and then ALL tabs would unexpectedly get stashed. [#61]
        return selected.filter(t => ! t.pinned);
    }

    //
    // Mutators
    //

    setFilter(text: string) {
        const filter = textMatcher(text);

        this.bookmarks.filter.value = node => {
            if (filter(node.title)) return true;

            if ('url' in node) {
                if (filter(node.url)) return true;

            } else if ('children' in node) {
                // Filter should pass if any of its children are not filtered
                // (so the parent is visible in the UI)
                const visible_child = node.children.find(id =>
                    this.bookmarks.node(id)?.$visible);
                if (visible_child) return true;
            }

            return false;
        };

        this.tabs.filter.value = t =>
               (!!t.title && filter(t.title))
            || (!!t.url && filter(t.url));
    }

    /** Garbage-collect various caches and deleted items. */
    async gc() {
        const deleted_exp = Date.now() -
            this.options.sync.state.deleted_items_expiration_days * 24*60*60*1000;

        await this.deleted_items.dropOlderThan(deleted_exp);
        await this.favicons.gc(url =>
            this.bookmarks.bookmarksWithURL(url).size > 0
            || this.tabs.tabsWithURL(url).size > 0);
        await this.bookmark_metadata.gc(id =>
            !! this.bookmarks.node(id as Bookmarks.NodeID));
    }

    /** Put the set of currently-selected items in the current window. */
    async putSelectedInWindow(options: {copy: boolean}) {
        await this.putItemsInWindow({
            items: copyIf(options.copy, Array.from(this.selectedItems())),
        });
    }

    /** Put the set of currently-selected items in the specified folder. */
    async putSelectedInFolder(options: {copy: boolean, toFolderId: Bookmarks.NodeID}) {
        await this.putItemsInFolder({
            items: copyIf(options.copy, Array.from(this.selectedItems())),
            toFolderId: options.toFolderId,
        });
    }

    /** Hide/discard/close the specified tabs, according to the user's settings
     * for what to do with stashed tabs.  Creates a new tab if necessary to keep
     * the browser window(s) open. */
    async hideOrCloseStashedTabs(tabIds: Tabs.TabID[]): Promise<void> {
        await this.tabs.refocusAwayFromTabs(tabIds);

        // Clear any highlights/selections on tabs we are stashing
        await Promise.all(
            tabIds.map(tid => browser.tabs.update(tid, {highlighted: false})));
        await this.tabs.setSelected(filterMap(tabIds, id => this.tabs.tab(id)), false);

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
                await this.tabs.remove(tabIds);
                break;
            case 'hide':
            default:
                await browser.tabs.hide(tabIds);
                break;
            }

        } else {
            // The browser does not support hiding tabs, so our only option is
            // to close them.
            await this.tabs.remove(tabIds);
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
    ): Promise<Tabs.Tab[]> {
        const toWindowId = this.tabs.targetWindow.value;
        if (toWindowId === undefined) {
            throw new Error(`No target window; not sure where to restore tabs`);
        }
        const cur_win = expect(this.tabs.window(toWindowId),
            () => `Target window ${toWindowId} is unknown to the model`);

        // As a special case, if we are restoring just a single tab, first check
        // if we already have the tab open and just switch to it.  (No need to
        // disturb the ordering of tabs in the browser window.)
        if (! options.background && urls.length === 1 && urls[0]) {
            const t = Array.from(this.tabs.tabsWithURL(urls[0]))
                .find(t => t.url === urls[0] && ! t.hidden
                        && t.windowId === toWindowId);
            if (t) {
                await browser.tabs.update(t.id, {active: true});
                return [t];
            }
        }

        // Remove duplicate URLs so we only try to restore each URL once.
        const url_set = new Set(filterMap(urls, url => url));

        // We want to know what tabs are currently open in the window, so we can
        // avoid opening duplicates.
        const win_tabs = this.tabs.tabsIn(cur_win);

        // We want to know which tab the user is currently looking at so we can
        // close it if it's just the new-tab page.
        const active_tab = win_tabs.filter(t => t.active)[0];

        const tabs = await this.putItemsInWindow({
            // NOTE: We rely on the fact that Set always remembers the order in
            // which items were inserted to be sure that tabs are always
            // restored in the correct order.
            items: Array.from(url_set).map(url => ({url})),
            toWindowId,
        });

        if (! options.background) {
            // Switch to the last tab that we restored (if desired).  We choose
            // the LAST tab to behave similarly to the user having just opened a
            // bunch of tabs.
            if (tabs.length > 0) {
                await browser.tabs.update(tabs[tabs.length - 1].id, {active: true});
            }

            // Finally, if we opened at least one tab, AND we were looking at
            // the new-tab page, close the new-tab page in the background.
            if (active_tab && tabs.length > 0
                && this.browser_settings.isNewTabURL(active_tab.url ?? '')
                && active_tab.status === 'complete')
            {
                browser.tabs.remove([active_tab.id]).catch(console.log);
            }
        }

        return tabs;
    }

    /** Returns the ID of an unnamed folder at the top of the stash, creating a
     * new one if necessary. */
    async ensureRecentUnnamedFolder(): Promise<Bookmarks.Folder> {
        const folder = this.mostRecentUnnamedFolder();
        if (folder !== undefined) return folder;
        return await this.bookmarks.createStashFolder();
    }

    /** Moves or copies items (bookmarks, tabs, and/or external items) to a
     * particular location in a particular bookmark folder.
     *
     * When `move` is true, if the source item is a bookmark, it will be moved
     * directly (so the ID remains the same).  If it's a tab, the tab will be
     * closed once the bookmark is created.  External items (without an ID) will
     * simply be created as new bookmarks, regardless of `move`. */
    async putItemsInFolder(options: {
        items: StashItem[],
        toFolderId: Bookmarks.NodeID,
        toIndex?: number,
        task?: TaskMonitor,
    }): Promise<Bookmarks.Node[]> {
        // First we try to find the folder we're moving to.
        const to_folder = expect(this.bookmarks.folder(options.toFolderId),
            () => `Destination folder does not exist: ${options.toFolderId}`);

        const items = options.items;

        // Note: We explicitly DON'T check stashability here because the caller
        // has presumably done this for us--and has explicitly chosen what to
        // put in the folder.

        if (options.task) options.task.max = options.items.length;

        // Now, we move everything into the folder.  `to_index` is maintained as
        // the insertion point (i.e. the next inserted item should have index
        // `to_index`).
        const moved_items: Bookmarks.Node[] = [];
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
                moved_items.push(model_item);
                if (pos && pos.parent === to_folder && pos.index < to_index) {
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
            const node = await this.bookmarks.create({
                title: item.title || item.url,
                url: item.url,
                parentId: to_folder.id,
                index: to_index,
            });
            moved_items.push(node);
            await this.bookmarks.setSelected([node], !!item.$selected);
        }

        // Hide/close any tabs which were moved from, since they are now
        // (presumably) in the stash.
        await this.hideOrCloseStashedTabs(close_tab_ids);

        return moved_items;
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
        items: StashItem[],
        toWindowId?: Tabs.WindowID,
        toIndex?: number,
        task?: TaskMonitor,
    }): Promise<Tabs.Tab[]> {
        const to_win_id = options.toWindowId ?? this.tabs.targetWindow.value;
        if (to_win_id === undefined) {
            throw new Error(`No target window available: ${to_win_id}`);
        }
        const win = expect(this.tabs.window(to_win_id),
            () => `Trying to put items in unknown window ${to_win_id}`);

        const items = options.items;

        // We want to know what tabs were recently closed, so we can
        // restore/un-hide tabs as appropriate.
        //
        // TODO Unit tests don't support sessions yet
        //
        // TODO Known to be buggy on some Firefoxen, see #188.  If nobody
        // complains, probably this whole path should just be removed.
        //
        // istanbul ignore if -- as above
        const closed_tabs = !! browser.sessions?.getRecentlyClosed
                && this.options.local.state.ff_restore_closed_tabs
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
        const moved_items: Tabs.Tab[] = [];
        const delete_bm_ids: Bookmarks.Bookmark[] = [];

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
                moved_items.push(model_item);
                dont_steal_tabs.add(model_item.id);

                if (pos && pos.window === win && pos.index < to_index) {
                    // This is a rotation in the same window; since move() first
                    // removes and then adds the tab, we need to decrement
                    // toIndex so the moved tab ends up in the right place.
                    --to_index;
                }
                continue;
            }

            // If we're "moving" a bookmark into a window, mark the bookmark
            // for deletion later.
            if (isBookmark(model_item)) delete_bm_ids.push(model_item);

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
                .filter(t => ! dont_steal_tabs.has(t.id) && ! t.pinned
                          && (t.hidden || t.windowId === to_win_id))
                .sort((a, b) => (-a.hidden) - (-b.hidden)); // prefer hidden tabs
            if (already_open.length > 0) {
                const t = already_open[0];
                const pos = this.tabs.positionOf(t);

                if (t.hidden && !! browser.tabs.show) await browser.tabs.show(t.id);

                await browser.tabs.move(t.id, {windowId: to_win_id, index: to_index});
                if (pos && pos.window === win && pos.index < to_index) --to_index;
                moved_items.push(t);
                dont_steal_tabs.add(t.id);
                await this.tabs.setSelected([t], !!item.$selected);
                continue;
            }

            // If we don't have a tab to move, let's see if a tab was recently
            // closed that we can restore.
            const closed = filterMap(closed_tabs, s => s.tab).find(tabLookingAtP(url));
            // istanbul ignore next - per Firefox bug noted above, see #188
            if (closed) {
                console.log(`Restoring recently-closed tab for URL: ${url}`, closed);
                // Remember the active tab in this window (if any), because
                // restoring a recently-closed tab will disturb the focus.
                const active_tab = this.tabs.tabsIn(win).find(t => t.active);

                const t = (await browser.sessions.restore(closed.sessionId!)).tab!;
                await browser.tabs.move(t.id!, {windowId: to_win_id, index: to_index});

                // Reset the focus to the previously-active tab. (We do this
                // immediately, inside the loop, so as to minimize any
                // flickering the user might see.)
                if (active_tab) {
                    await browser.tabs.update(active_tab.id, {active: true});
                }

                const tab = await shortPoll(() =>
                    this.tabs.tab(t.id as Tabs.TabID) || tryAgain());
                moved_items.push(tab);
                dont_steal_tabs.add(tab.id);
                await this.tabs.setSelected([tab], !!item.$selected);
                continue;
            }

            // Else we just need to create a completely new tab.
            const tab = await this.tabs.create({
                active: false, url: urlToOpen(url), windowId:
                to_win_id, index: to_index,
            });
            moved_items.push(tab);
            dont_steal_tabs.add(tab.id);
            await this.tabs.setSelected([tab], !!item.$selected);
        }

        // Delete bookmarks for all the tabs we restored.
        await Promise.all(delete_bm_ids.map(bm => this.deleteBookmark(bm)));
        if (options.task) ++options.task.value;

        return moved_items;
    }

    /** Deletes the specified items (bookmark nodes or tabs), saving any deleted
     * bookmarks to the deleted-items model. */
    async deleteItems(ids: Iterable<Bookmarks.NodeID | Tabs.TabID>) {
        const tabs = [];
        for (const id of ids) {
            if (typeof id === 'string') {
                // It's a bookmark
                const node = this.bookmarks.node(id);
                if (! node) continue;

                if ('children' in node) {
                    await this.deleteBookmarkTree(id);
                } else if ('url' in node) {
                    await this.deleteBookmark(node);
                } else {
                    // separator
                    await this.bookmarks.remove(id);
                }

            } else {
                tabs.push(id);
            }
        }

        await this.tabs.remove(tabs);
    }

    /** Deletes the specified bookmark subtree, saving it to deleted items.  You
     * should use {@link deleteBookmark()} for individual bookmarks, because it
     * will cleanup the parent folder if the parent folder has a "default" name
     * and would be empty. */
    async deleteBookmarkTree(id: Bookmarks.NodeID) {
        const bm = this.bookmarks.node(id);
        if (! bm) return; // Already deleted?

        const toDelItem = (item: Bookmarks.Node): DeletedItems.DeletedItem => {
            if ('children' in item) return {
                title: item.title,
                children: filterMap(item.children, i => i && this.bookmarks.node(i))
                    .map(i => toDelItem(i)),
            };

            if ('url' in item) return {
                title: item.title,
                url: item.url,
                favIconUrl: this.favicons.get(item.url!).value?.favIconUrl
                    || undefined,
            };

            return {title: '', url: ''};
        };

        await this.deleted_items.add(toDelItem(bm));
        await this.bookmarks.removeTree(bm.id);
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

        await this.bookmarks.remove(bm.id);
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
            const folder = await this.bookmarks.create({
                parentId: stash_root.id,
                title: deletion.item.title,
                index: 0,
            });
            await this.putItemsInFolder({
                items: deletion.item.children,
                toFolderId: folder.id,
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
                const folder = this.bookmarks.folder(from.folder_id as Bookmarks.NodeID);
                if (folder) {
                    // The exact bookmark we want still exists, use it
                    folderId = from.folder_id as Bookmarks.NodeID;
                } else {
                    // Search for an existing folder inside the stash root with
                    // the same name as the folder it was deleted from.
                    const child = this.bookmarks.childrenOf(stash_root)
                        .find(c => 'children' in c && c.title === from.title);
                    if (child) folderId = child.id;
                }
            }

            // If we still don't know where it came from or its prior containing
            // folder was deleted, just put it in an unnamed folder.
            if (! folderId) folderId = (await this.ensureRecentUnnamedFolder()).id;

            // Restore the bookmark.
            await this.putItemsInFolder({items: [deletion.item], toFolderId: folderId});

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

        await this.putItemsInFolder({
            items: [child],
            toFolderId: (await this.ensureRecentUnnamedFolder()).id,
        });

        if ('url' in child && child.favIconUrl) {
            this.favicons.maybeSet(child.url, child.favIconUrl);
        }

        await this.deleted_items.dropChildItem(deletion.key, childIndex);
    }
};

export type BookmarkTabsResult = {
    savedItems: StashItem[],
    bookmarks: Bookmarks.Node[],
    newFolderId?: string,
};

/** Apply `copying()` to a set of stash items if `predicate` is true. */
export function copyIf(predicate: boolean, items: StashItem[]): StashItem[] {
    if (predicate) return copying(items);
    return items;
}

/** Given a set of stash items, transform them such that passing them to a
 * put*() model method will copy them instead of moving them, leaving the
 * original sources untouched. */
export function copying(items: StashItem[]): StashItem[] {
    return items.map(({title, url}) => ({title, url}));
}


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

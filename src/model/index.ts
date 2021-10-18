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

import * as BrowserSettings from './browser-settings';
import * as Options from './options';

import * as Tabs from './tabs';
import * as Bookmarks from './bookmarks';
import * as DeletedItems from './deleted-items';

import * as Favicons from './favicons';
import * as BookmarkMetadata from './bookmark-metadata';
import {filterMap, TaskMonitor, urlToOpen} from '../util';

export {
    BrowserSettings, Options, Tabs, Bookmarks, DeletedItems, Favicons,
    BookmarkMetadata,
};

export type PartialTabInfo = {
    id?: number,
    title?: string,
    url?: string,
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

    constructor(src: Source) {
        this.browser_settings = src.browser_settings;
        this.options = src.options;

        this.tabs = src.tabs;
        this.bookmarks = src.bookmarks;
        this.deleted_items = src.deleted_items;

        this.favicons = src.favicons;
        this.bookmark_metadata = src.bookmark_metadata;
    }

    //
    // Accessors
    //

    /** Is the passed-in URL one we want to include in the stash?  Excludes
     * things like new-tab pages and Tab Stash pages (so we don't stash
     * ourselves). */
     isURLStashable(url_str: string): boolean {
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

    //
    // Mutators
    //

    /** Garbage-collect various caches and deleted items. */
    async gc() {
        const deleted_exp = this.options.sync.state.deleted_items_expiration_days * 24*60*60*1000;

        await this.deleted_items.dropOlderThan(deleted_exp);
        await this.favicons.gc(url =>
            this.bookmarks.bookmarksWithURL(url).size > 0 || this.tabs.by_url.has(url));
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
        windowId: number,
        options: {
            folderId?: Bookmarks.NodeID,
            close?: boolean
        }
    ): Promise<void> {
        const tabs = this.tabs.by_window.get(windowId)
            .filter(t => ! t.hidden)
            .sort((a, b) => a.index - b.index);

        let selected = tabs.filter(t => t.highlighted);
        if (selected.length <= 1) selected = tabs;

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
        tabs: PartialTabInfo[],
        options: {
            folderId?: Bookmarks.NodeID,
            close?: boolean
        }
    ): Promise<void> {
        const saved_tabs = (await this.bookmarkTabs(options.folderId, tabs)).tabs;

        if (options.close) {
            await this.hideOrCloseStashedTabs(filterMap(saved_tabs, t => t.id));
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
        all_tabs: PartialTabInfo[],
        options?: {newFolderTitle?: string, taskMonitor?: TaskMonitor},
    ): Promise<BookmarkTabsResult>
    {
        const tm = options?.taskMonitor;
        if (tm) {
            if (options?.newFolderTitle) {
                tm.status = `Creating bookmarks for ${options.newFolderTitle}...`;
            } else {
                tm.status = "Creating bookmarks...";
            }
        }

        // Figure out which of the tabs to save.  We ignore tabs with
        // unparseable URLs or which look like extensions and internal browser
        // things.
        //
        // We filter out all tabs without URLs below. #cast
        const tabs = <(PartialTabInfo & {url: string})[]>
            all_tabs.filter(t => t.url && this.isURLStashable(t.url));

        // If there are no tabs to save, early-exit here so we don't
        // unnecessarily create bookmark folders we don't need.
        if (tabs.length == 0) {
            if (tm) tm.value = tm.max;
            return {tabs, bookmarks: []};
        }

        // Find or create the root of the stash.
        const root = await this.bookmarks.ensureStashRoot();

        // Keep track of which tabs to actually save (we filter below based on
        // what we already have), and where in the folder to save them (we want
        // to append).
        let tabs_to_actually_save = tabs;
        let index = 0;
        let newFolderId: undefined | string = undefined;

        if (folderId === undefined) {
            // Create a new folder, if it wasn't specified.
            const folder = await browser.bookmarks.create({
                parentId: root.id,
                title: options?.newFolderTitle
                    ?? Bookmarks.genDefaultFolderName(new Date()),
                index: 0, // Newest folders should show up on top
            });
            folderId = folder.id as Bookmarks.NodeID;
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

            // Append new bookmarks to the end of the folder.
            index = existing_bms.length;
        }

        if (tm) tm.max = tabs_to_actually_save.length * 2;

        // Now save each tab as a bookmark.
        //
        // Unfortunately, Firefox doesn't have an API to save multiple bookmarks
        // in a single transaction, so to avoid this being unbearably slow, we
        // do this in two passes--create a bunch of empty bookmarks in parallel,
        // and then fill them in with the right values (again in parallel).
        let ps: Promise<browser.Bookmarks.BookmarkTreeNode>[] = [];
        const created_bm_ids = new Set();
        for (let _tab of tabs_to_actually_save) {
            ps.push(browser.bookmarks.create({
                parentId: folderId,
                title: 'Stashing...',
                // We provide a unique URL for each in-progress stash to avoid
                // problems with Firefox Sync erroneously de-duplicating
                // bookmarks with the same URL while the stash is in progress.
                // See issue #8 and Firefox bug 1549648.
                url: `about:blank#stashing-${folderId}-${index}`,
                index,
            }));
            ++index;
        }
        for (let p of ps) {
            created_bm_ids.add((await p).id);
            if (tm) ++tm.value;
        }
        ps = [];

        // We now read the folder back to determine the order of the created
        // bookmarks, so we can fill each of them in in the correct order.
        //
        // We know that the bookmark node returned from getSubTree() has
        // children because it's a folder we created or identified earlier, and
        // we were able to successfully create child bookmarks under it above.
        // #undef
        let child_bms = (await browser.bookmarks.getSubTree(folderId))[0].children!;

        // Now fill everything in.
        let tab_index = 0;
        for (let bm of child_bms) {
            if (! created_bm_ids.has(bm.id)) continue;
            created_bm_ids.delete(bm.id);
            ps.push(browser.bookmarks.update(bm.id, {
                title: tabs_to_actually_save[tab_index].title,
                url: tabs_to_actually_save[tab_index].url,
            }));
            ++tab_index;
        }

        const bookmarks: browser.Bookmarks.BookmarkTreeNode[] = [];
        for (let p of ps) {
            bookmarks.push(await p);
            if (tm) ++tm.value;
        }

        return {tabs, bookmarks, newFolderId};
    }

    /** Hide/discard/close the specified tabs, according to the user's settings
     * for what to do with stashed tabs.  Creates a new tab if necessary to keep
     * the browser window(s) open. */
    async hideOrCloseStashedTabs(tabIds: number[]): Promise<void> {
        await this.tabs.refocusAwayFromTabs(tabIds);

        // Clear any highlights/selections on tabs we are stashing
        await Promise.all(
            tabIds.map(tid => browser.tabs.update(tid, {highlighted: false})));

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
    ): Promise<number[]> {
        if (this.tabs.current_window === undefined) {
            throw new Error(`Not sure what the current window is`);
        }

        // Remove duplicate URLs so we only try to restore each URL once.
        const url_set = new Set(filterMap(urls, url => url));

        // We want to know what tabs were recently closed, so we can
        // restore/un-hide tabs as appropriate.
        const closed_tabs = await browser.sessions.getRecentlyClosed();

        // We want to know what tabs are currently open in the window, so we can
        // avoid opening duplicates.
        const win_id = this.tabs.current_window;
        const win_tabs = this.tabs.by_window.get(win_id);

        // We want to know which tab the user is currently looking at so we can
        // close it if it's just the new-tab page, and because if we restore any
        // closed tabs, the browser will re-focus (and we may want to shift the
        // focus back if we've been asked to restore in the background).
        const active_tab = win_tabs.filter(t => t.active)[0];

        // We can restore a tab in one of four(!) ways:
        //
        // 1. Do nothing (because the tab is already open).
        // 2. Un-hide() it, if it was previously hidden and is still open.
        // 3. Re-open a recently-closed tab with the same URL.
        // 4. Open a new tab.
        //
        // Let's figure out which strategy to use for each tab, and kick it off.
        const ps: Promise<number>[] = [];
        let index = win_tabs.length;
        for (const url of url_set) {
            const open = win_tabs.find(tabLookingAtP(url));
            if (open && open.id !== undefined) {
                // Tab is already open.  If it was hidden, un-hide it and move
                // it to the right location in the tab bar.
                if (open.hidden) {
                    ps.push(async function(open) {
                        if (browser.tabs.show) await browser.tabs.show([open.id!]);
                        await browser.tabs.move(open.id!, {windowId: win_id, index});
                        return open.id;
                    }(open));
                    ++index;
                }
                continue;
            }

            const closed = closed_tabs.map(s => s.tab).find(tabLookingAtP(url));
            if (closed) {
                // Tab was recently-closed.  Re-open it, and move it to the
                // right location in the tab bar.
                ps.push(async function(ct) {
                    // #undef We filtered out non-tab sessions above, and we know
                    // that /ct/ is a session-flavored Tab.
                    const t = (await browser.sessions.restore(ct.sessionId!)).tab!;
                    // #undef The restored tab is a normal (non-devtools) tab
                    await browser.tabs.move(t.id!, {windowId: win_id, index});
                    return t.id!;
                }(closed));
                ++index;
                continue;
            }

            ps.push(browser.tabs.create({
                active: false, url: urlToOpen(url), windowId: win_id, index})
                .then(t => t.id!));
            ++index;
        }

        // NOTE: Can't do this with .map() since await doesn't work in a nested
        // function context. :/
        let tab_ids: number[] = await Promise.all(ps);

        if (! options || ! options.background) {
            // Special case: If we were asked to open only one tab AND that tab
            // is already open, just switch to it.
            if (url_set.size == 1 && tab_ids.length == 0) {
                const url = url_set.values().next().value;
                const open_tab = win_tabs.find(tabLookingAtP(url));
                // #undef Since we opened no tabs, yet we were asked to open one
                // URL, the tab must be open and therefore listed in /win_tabs/.
                await browser.tabs.update(open_tab!.id, {active: true});
            }

            // Special case: If only one tab was restored, switch to it.  (This
            // is different from the special case above, in which NO tabs are
            // restored.)
            if (tab_ids.length == 1) {
                await browser.tabs.update(tab_ids[0], {active: true});
            }

            // Finally, if we opened at least one tab, AND the current tab is
            // looking at the new-tab page, close the current tab in the
            // background.
            if (tab_ids.length > 0
                && this.browser_settings.isNewTabURL(active_tab.url ?? '')
                && active_tab.status === 'complete')
            {
                // #undef devtools tabs don't have URLs and won't fall in here
                browser.tabs.remove([active_tab.id]).catch(console.log);
            }

        } else {
            // Caller has indicated they don't want the tab focus disturbed.
            // Unfortunately, if we restored any sessions, that WILL disturb the
            // focus, so we need to re-focus on the previously-active tab.
            await browser.tabs.update(active_tab.id, {active: true});
        }

        return tab_ids;
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

        if ('children' in deletion.item) {
            // Restoring an entire folder of bookmarks; just put it at the root.
            const stash_root = await this.bookmarks.ensureStashRoot();
            const folder = await browser.bookmarks.create({
                parentId: stash_root.id,
                title: deletion.item.title,
                index: 0,
            });
            const fid = folder.id as Bookmarks.NodeID;
            await this.bookmarkTabs(fid, deletion.item.children);

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
                try {
                    await browser.bookmarks.get(deletion.deleted_from.folder_id);

                    // The exact bookmark we want still exists, use it
                    folderId = deletion.deleted_from.folder_id as Bookmarks.NodeID;

                } catch (e) {
                    // Search for an existing folder inside the stash root with
                    // the same name as the folder it was deleted from.
                    const stash_root = this.bookmarks.stash_root.value;
                    for (const bm of await browser.bookmarks.search(
                            {title: deletion.deleted_from.title}))
                    {
                        if (bm.type !== 'folder') continue;
                        if (bm.parentId !== stash_root?.id) continue;
                        if (bm.title !== deletion.deleted_from.title) continue;
                        folderId = bm.id as Bookmarks.NodeID;
                        break;
                    }
                }
            }

            // If we still don't know where it came from or its prior containing
            // folder was deleted, just put it in an unnamed folder.
            if (! folderId) folderId = this.mostRecentUnnamedFolderId();

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
    tabs: PartialTabInfo[],
    bookmarks: browser.Bookmarks.BookmarkTreeNode[],
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

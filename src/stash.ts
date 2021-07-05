import {browser, Bookmarks, Tabs} from 'webextension-polyfill-ts';

import * as Options from './model/options';
import * as BrowserSettings from './model/browser-settings';

import {urlToOpen, TaskMonitor} from './util';

type BookmarkTreeNode = Bookmarks.BookmarkTreeNode;

// Interface used in place of Tabs.Tab, defining only the fields we care about
// for the purposes of stashing and restoring tabs.  Using this interface makes
// the API more permissive, because we can also take model objects in addition
// to official browser objects.
interface PartialTabInfo {
    id?: number,
    title?: string,
    url?: string,
}

// The name of the stash root folder.  This name must match exactly.
export const STASH_ROOT = 'Tab Stash';

const ROOT_FOLDER_HELP = 'https://github.com/josh-berry/tab-stash/wiki/Problems-Locating-the-Tab-Stash-Bookmark-Folder';

// Small cross-browser helper to tell if a BookmarkTreeNode is a folder or not.
// XXX This is duplicated in the browser model as well.
const isFolder = (bm: BookmarkTreeNode) =>
    bm.type === 'folder' || (! ('type' in bm) && ! ('url' in bm));

// Small model to keep track of browser settings like new-tab URLs and such.
// TODO move this into a proper model (with proper init sequencing) once
// stash.ts itself moves...
const the_browser_settings = BrowserSettings.Model.live_imm();

// Find or create the root of the stash.
export async function rootFolder(): Promise<BookmarkTreeNode> {
    let candidates = await candidateRootFolders();
    if (candidates.length > 0) return candidates[0];

    await browser.bookmarks.create({title: STASH_ROOT});

    // GROSS HACK to avoid creating duplicate roots follows.
    candidates = await candidateRootFolders();
    if (candidates.length > 1) {
        // If we find MULTIPLE candidates so soon after finding NONE, there must
        // be multiple threads trying to create the root folder.  Let's delete
        // all but the first one.  We are guaranteed that all threads see the
        // same ordering of candidate folders (and thus will all choose the same
        // folder to save) because the sort is deterministic.
        console.log("Oops! Created duplicate roots...");
        for (let i = 1; i < candidates.length; ++i) {
            console.log("Removing root", candidates[i]);
            await browser.bookmarks.remove(candidates[i].id).catch(console.warn);
        }
        console.log("Remaining root:", candidates[0]);
    }
    // END GROSS HACK

    return candidates[0];
}

// Find "candidate" root folders.  If there's more than one, we should show a
// warning to the user (see rootFolderWarning() below).
//
// The search is done by looking for folders named "Tab Stash", and choosing the
// one closest to the bookmark root.  If multiple folders are at the same level,
// multiple candidates are returned, sorted oldest first, and then by id
// if the ages are the same.  (NOTE: This sort must be deterministic--see
// rootFolder() above for why.)
export async function candidateRootFolders(): Promise<BookmarkTreeNode[]> {
    const paths = await Promise.all(
        (await browser.bookmarks.search({title: STASH_ROOT}))
            .filter(c => c && isFolder(c))
            .map(c => getPathTo(c)));

    const depth = Math.min(...paths.map(p => p.length));

    return paths
        .filter(p => p.length <= depth)
        .map(p => p[p.length - 1])
        .sort((a, b) => {
            const byDate = (a.dateAdded ?? 0) - (b.dateAdded ?? 0);
            if (byDate !== 0) return byDate;
            if (a.id < b.id) return -1;
            if (a.id > b.id) return 1;
            return 0;
        });
}

// This function checks for a variety of situations that can occur if users move
// their stashes around in ways that might cause ambiguity about which root to
// use, and tries to provide suitable warnings/remedies.
export async function rootFolderWarning():
    Promise<[string, () => void] | undefined>
{
    const candidates = await candidateRootFolders();

    // No stash root exists, or only one stash root exists, so no problem.
    if (candidates.length <= 1) return;

    // We have multiple root candidates, so we need to warn because of the
    // possibility of sync conflicts the user might not be aware of.
    return [
        `You have multiple "${STASH_ROOT}" bookmark folders, and Tab Stash isn't sure which one to use.  Click here to find out how to resolve the issue.`,
        () => { browser.tabs.create({active: true, url: ROOT_FOLDER_HELP}); },
    ];

    // Otherwise no warning is necessary and we implicitly return undefined.
}

// Given a BookmarkTreeNode, return the path from the root to that node,
// found by following parentId fields until a node is reached with no parent.
async function getPathTo(bm: BookmarkTreeNode): Promise<BookmarkTreeNode[]> {
    const path = [bm];
    while (bm.parentId) {
        const parent = (await browser.bookmarks.get(bm.parentId))[0];
        path.push(parent);
        bm = parent;
    }
    path.reverse();
    return path;
}

// Return the entire Tab Stash folder tree.
export async function tabStashTree() {
    return (await browser.bookmarks.getSubTree((await rootFolder()).id))[0];
}

export function getFolderNameISODate(n: string): string | null {
    let m = n.match(/saved-([-0-9:.T]+Z)/);
    return m ? m[1] : null;
}

export const genDefaultFolderName =
    (date: Date) => 'saved-' + date.toISOString();

export function friendlyFolderName(name: string): string {
    const folderDate = getFolderNameISODate(name);
    if (folderDate) return `Saved ${new Date(folderDate).toLocaleString()}`;
    return name;
}

export async function mostRecentUnnamedFolderId() {
    const {sync: options} = await Options.Model.live();
    const root = await rootFolder();
    const topmost = (await browser.bookmarks.getChildren(root.id))[0];

    // Is there a top-most item under the root folder, and is it a folder?
    if (! topmost) return undefined;
    if (! isFolder(topmost)) return undefined;

    // Does the folder have a name which looks like a default name?
    if (! getFolderNameISODate(topmost.title)) return undefined;

    // Did something create/update this folder recently?
    // #cast dateAdded is always present on folders
    const age_cutoff = Date.now() - options.state.new_folder_timeout_min *60*1000;
    if (topmost.dateAdded! < age_cutoff) {
        return undefined;
    }

    // If so, we can put new stuff here by default.  (Otherwise we should
    // probably assume this isn't recent enough and a new folder should be
    // created.)
    return topmost.id;
}

export function isURLStashable(urlstr: string): boolean {
    // New-tab URLs, homepages and the like are never stashable.
    if (the_browser_settings.isNewTabURL(urlstr)) return false;

    // Tab Stash URLs are never stashable.
    return ! urlstr.startsWith(browser.extension.getURL(''));
}

export async function stashTabsInWindow(
    windowId: number | undefined,
    options: {
        folderId?: string,
        close?: boolean
    }
): Promise<void> {
    // Stash either all tabs (if none are selected) or the selected tabs in the
    // window /windowId/ (or the current window, if /windowId/ is undefined).
    //
    // If /folderId/ is not specified, stashes into a new unnamed folder.
    //
    // If /close/ is true, closes/hides the stashed tabs according to the user's
    // preferences.
    if (windowId === undefined) windowId = browser.windows.WINDOW_ID_CURRENT;

    const tabs = (await browser.tabs.query({windowId}))
        .filter(t => ! t.hidden)
        .sort((a, b) => a.index - b.index);

    let selected = tabs.filter(t => t.highlighted);
    if (selected.length <= 1) selected = tabs;

    // We filter out pinned tabs AFTER checking how many tabs are selected
    // because otherwise the user might have a pinned tab focused, and highlight
    // a single specific tab they want stashed (in additioned to the active
    // pinned tab), and then ALL tabs would unexpectedly get stashed. [#61]
    selected = selected.filter(t => ! t.pinned);

    await stashTabs(selected, options);
}

export async function stashTabs(
    tabs: PartialTabInfo[],
    options: {
        folderId?: string,
        close?: boolean
    }
): Promise<void> {
    // Stashes the specified tabs into a bookmark folder.
    //
    // BIG WARNING: This function assumes that all passed-in tabs are in the
    // current window.  It WILL DO WEIRD THINGS if that's not the case.
    //
    // If /folderId/ is not specified, stashes into a new unnamed folder.
    //
    // If /close/ is true, closes/hides the stashed tabs according to the user's
    // preferences.

    const saved_tabs = (await bookmarkTabs(options.folderId, tabs)).tabs;

    if (options.close) await hideStashedTabs(saved_tabs);
}

// Hides tabs that we know are stashed.
export async function hideStashedTabs(tabs: PartialTabInfo[]): Promise<void> {
    const opts_p = Options.Model.live();

    await refocusAwayFromTabs(tabs);
    const opts = (await opts_p).local;

    const tids = <number[]>tabs.map(t => t.id).filter(id => id !== undefined);

    // Clear any highlights/selections on tabs we are stashing
    await Promise.all(
        tids.map(tid => browser.tabs.update(tid, {highlighted: false})));

    if (browser.tabs.hide) {
        switch (opts.state.after_stashing_tab) {
        case 'hide_discard':
            await browser.tabs.hide(tids);
            await browser.tabs.discard(tids);
            break;
        case 'close':
            await browser.tabs.remove(tids);
            break;
        case 'hide':
        default:
            await browser.tabs.hide(tids);
            break;
        }
    } else {
        await browser.tabs.remove(tids);
    }
}

export async function closeTabs(tabs: PartialTabInfo[]): Promise<void> {
    const tids = <number[]>tabs.map(t => t.id).filter(id => id !== undefined);
    await refocusAwayFromTabs(tabs);
    await browser.tabs.remove(tids);
}

export async function refocusAwayFromTabs(
    tabs: PartialTabInfo[]
): Promise<void> {
    const all_tabs = (await browser.tabs.query({currentWindow: true}))
        .filter(t => ! t.hidden);

    const front_tab_idx = all_tabs.findIndex(t => t.active);
    const front_tab = front_tab_idx == -1 ? undefined : all_tabs[front_tab_idx];
    if (front_tab && ! tabs.find(t => t.id === front_tab.id)) {
        // We are not closing the active tab.  Nothing to do.
        //
        // NOTE: If front_tab is undefined at this point, it's likely because
        // the user is looking at a pinned tab, since we are explicitly
        // filtering those out above.
        return;
    }

    if (tabs.length >= all_tabs.filter(t => ! t.pinned).length) {
        // If we are about to close all visible tabs in the window, we should
        // open a new tab so the window doesn't close.
        await browser.tabs.create({active: true});

    } else {
        // Otherwise we should make sure the currently-active tab isn't a tab we
        // are about to hide/discard.  The browser won't let us hide the active
        // tab, so we'll have to activate a different tab first.
        //
        // We do this search a little strangely--first looking only at tabs
        // AFTER the tabs we're stashing, followed by looking only at tabs
        // BEFORE the tabs we're stashing, to mimic the browser's behavior when
        // closing the front tab.

        let candidates = all_tabs.slice(front_tab_idx + 1);
        let focus_tab = candidates.find(
            t => t.id !== undefined && ! tabs.find(u => t.id === u.id));
        if (! focus_tab) {
            candidates = all_tabs.slice(0, front_tab_idx).reverse();
            focus_tab = candidates.find(
                t => t.id !== undefined && ! tabs.find(u => t.id === u.id));
        }

        // We should always have a /focus_tab/ at this point, but if we don't,
        // it's better to fail gracefully by doing nothing.
        console.assert(focus_tab);
        // We filter out tabs with undefined IDs above #undef
        if (focus_tab) await browser.tabs.update(focus_tab.id!, {active: true});
    }
}

export type BookmarkTabsResult = {
    tabs: PartialTabInfo[],
    bookmarks: BookmarkTreeNode[],
    newFolderId?: string,
};
export async function bookmarkTabs(
    folderId: string | undefined,
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

    // Figure out which of the tabs to save.  We ignore tabs with unparseable
    // URLs or which look like extensions and internal browser things.
    //
    // We filter out all tabs without URLs below. #cast
    const tabs = <(PartialTabInfo & {url: string})[]>
        all_tabs.filter(t => t.url && isURLStashable(t.url));

    // If there are no tabs to save, early-exit here so we don't unnecessarily
    // create bookmark folders we don't need.
    if (tabs.length == 0) {
        if (tm) tm.value = tm.max;
        return {tabs, bookmarks: []};
    }

    // Find or create the root of the stash.
    let root = await rootFolder();

    // Keep track of which tabs to actually save (we filter below based on what
    // we already have), and where in the folder to save them (we want to
    // append).
    let tabs_to_actually_save = tabs;
    let index = 0;
    let newFolderId: undefined | string = undefined;

    if (folderId === undefined) {
        // Create a new folder, if it wasn't specified.
        let folder = await browser.bookmarks.create({
            parentId: root.id,
            title: options?.newFolderTitle ?? genDefaultFolderName(new Date()),
            index: 0, // Newest folders should show up on top
        });
        folderId = folder.id;
        newFolderId = folderId;

        // When saving to this folder, we want to save all tabs we previously
        // identified as "save-worthy", and we want to insert them at the
        // beginning of the folder.  So, no changes to /tabs_to_actually_save/
        // or /index/ here.

    } else {
        // If we're adding to an existing folder, skip bookmarks which already
        // exist in that folder.
        //
        // Note, however, that these tabs are still considered "saved" for the
        // purposes of this function, because the already appear in the folder.
        // So it's okay for callers to assume that we saved them--that's why we
        // use a separate /tabs_to_actually_save/ array here.
        let existing_bms = (await browser.bookmarks.getChildren(folderId))
            .map(bm => bm.url);

        tabs_to_actually_save = tabs_to_actually_save.filter(
            tab => ! existing_bms.includes(tab.url));

        // Append new bookmarks to the end of the folder.
        index = existing_bms.length;
    }

    if (tm) tm.max = tabs_to_actually_save.length * 2;

    // Now save each tab as a bookmark.
    //
    // Unfortunately, Firefox doesn't have an API to save multiple bookmarks in
    // a single transaction, so to avoid this being unbearably slow, we do this
    // in two passes--create a bunch of empty bookmarks in parallel, and then
    // fill them in with the right values (again in parallel).
    let ps = [];
    let created_bm_ids = new Set();
    for (let _tab of tabs_to_actually_save) {
        ps.push(browser.bookmarks.create({
            parentId: folderId,
            title: 'Stashing...',
            // We provide a unique URL for each in-progress stash to avoid
            // problems with Firefox Sync erroneously de-duplicating bookmarks
            // with the same URL while the stash is in progress.  See issue #8
            // and Firefox bug 1549648.
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
    // We know that the bookmark node returned from getSubTree() has children
    // because it's a folder we created or identified earlier, and we were able
    // to successfully create child bookmarks under it above.  #undef
    let child_bms = (await browser.bookmarks.getSubTree(folderId))[0].children!;

    // Now fill everything in.
    let tab_index = 0;
    for (let bm of child_bms) {
        if (! created_bm_ids.has(bm.id)) continue;
        created_bm_ids.delete(bm.id);
        ps.push(browser.bookmarks.update(bm.id, {
            // #undef typedef is wrong; title/url are both optional
            title: tabs_to_actually_save[tab_index].title!,
            url: tabs_to_actually_save[tab_index].url!,
        }));
        ++tab_index;
    }

    const bookmarks = [];
    for (let p of ps) {
        bookmarks.push(await p);
        if (tm) ++tm.value;
    }

    return {tabs, bookmarks, newFolderId};
}

export async function restoreTabs(
    urls: (string | undefined)[],
    options: {background?: boolean}
): Promise<Tabs.Tab[]> {
    // Remove duplicate URLs so we only try to restore each URL once.
    const urlset = new Set(urls.filter(url => url) as string[]);

    // First collect some info from the browser; done in parallel to reduce
    // latency.

    // We also want to know what tabs were recently closed, so we can
    // restore/un-hide tabs as appropriate.
    const closed_tabs_p = browser.sessions.getRecentlyClosed();

    // We also need to know which window to restore tabs to, and what tabs are
    // presently open in that window.
    const win_p = browser.windows.getCurrent({populate: true});

    const closed_tabs = await closed_tabs_p;
    const win = await win_p;
    const winid = win.id!; // #undef ASSUME we aren't in a devtools window
    const wintabs = win.tabs!; // #undef because {populate: true} returns tabs

    // We want to know which tab the user is currently looking at so we can
    // close it if it's just the new-tab page, and because if we restore any
    // closed tabs, the browser will re-focus (and we may want to shift the
    // focus back if we've been asked to restore in the background).
    const curtab = wintabs.filter(t => t.active)[0];

    // We can restore a tab in one of four(!) ways:
    //
    // 1. Do nothing (because the tab is already open).
    // 2. Un-hide() it, if it was previously hidden and is still open.
    // 3. Re-open a recently-closed tab with the same URL.
    // 4. Open a new tab.
    //
    // Let's figure out which strategy to use for each tab, and kick it off.
    const ps: Promise<Tabs.Tab>[] = [];
    let index = wintabs.length;
    for (const url of urlset) {
        const open = wintabs.find(tabLookingAtP(url));
        if (open && open.id !== undefined) {
            // Tab is already open.  If it was hidden, un-hide it and move it to
            // the right location in the tab bar.
            if (open.hidden) {
                ps.push(async function(open) {
                    if (browser.tabs.show) await browser.tabs.show([open.id!]);
                    await browser.tabs.move(
                        open.id!, {windowId: winid, index});
                    return open;
                }(open));
                ++index;
            }
            continue;
        }

        const closed = closed_tabs.map(s => s.tab).find(tabLookingAtP(url));
        if (closed) {
            // Tab was recently-closed.  Re-open it, and move it to the right
            // location in the tab bar.
            ps.push(async function(ct) {
                // #undef We filtered out non-tab sessions above, and we know
                // that /ct/ is a session-flavored Tab.
                const t = (await browser.sessions.restore(ct.sessionId!)).tab!;
                // #undef The restored tab is a normal (non-devtools) tab
                await browser.tabs.move(t.id!, {windowId: winid, index});
                return t;
            }(closed));
            ++index;
            continue;
        }

        ps.push(browser.tabs.create({
            active: false, url: urlToOpen(url), windowId: winid, index}));
        ++index;
    }

    // NOTE: Can't do this with .map() since await doesn't work in a nested
    // function context. :/
    let tabs: Tabs.Tab[] = [];
    for (let p of ps) tabs.push(await p);

    if (! options || ! options.background) {
        // Special case: If we were asked to open only one tab AND that tab is
        // already open, just switch to it.
        if (urlset.size == 1 && tabs.length == 0) {
            const url = urlset.values().next().value;
            const open_tab = wintabs.find(tabLookingAtP(url));
            // #undef Since we opened no tabs, yet we were asked to open one
            // URL, the tab must be open and therefore listed in /wintabs/.
            await browser.tabs.update(open_tab!.id, {active: true});
        }

        // Special case: If only one tab was restored, switch to it.  (This is
        // different from the special case above, in which NO tabs are
        // restored.)
        if (tabs.length == 1) {
            const tab = tabs[0];
            // #undef Tabs we opened must always have IDs (they're not devtools)
            await browser.tabs.update(tab.id!, {active: true});
        }

        // Finally, if we opened at least one tab, AND the current tab is
        // looking at the new-tab page, close the current tab in the background.
        if (tabs.length > 0 && the_browser_settings.isNewTabURL(curtab.url ?? '')
            && curtab.status === 'complete')
        {
            // #undef devtools tabs don't have URLs and won't fall in here
            browser.tabs.remove([curtab.id!]).catch(console.log);
        }

    } else {
        // Caller has indicated they don't want the tab focus disturbed.
        // Unfortunately, if we restored any sessions, that WILL disturb the
        // focus, so we need to re-focus on the previously-active tab.
        //
        // #undef If the user is looking at a devtools tab, we can't switch back
        await browser.tabs.update(curtab.id!, {active: true});
    }

    return tabs;
}

// Returns a function which returns true if a tab is looking at a particular
// URL, taking into account any transformations done by urlToOpen().
function tabLookingAtP(url: string): (t?: PartialTabInfo) => boolean {
    const ourl = urlToOpen(url);
    return (t?: PartialTabInfo) => {
        if (! t || ! t.url) return false;
        const tourl = urlToOpen(t.url);
        return t.url === url || t.url === ourl
            || tourl === url || tourl === ourl;
    };
}

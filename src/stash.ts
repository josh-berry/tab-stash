import Options from './options-model';

import {urlToOpen, TaskMonitor} from './util';

type BookmarkTreeNode = browser.bookmarks.BookmarkTreeNode;

// Interface used in place of browser.tabs.Tab, defining only the fields we care
// about for the purposes of stashing and restoring tabs.  Using this interface
// makes the API more permissive, because we can also take model objects in
// addition to official browser objects.
interface PartialTabInfo {
    id?: number,
    title?: string,
    url?: string,
}

// The parent folder where we expect to find the stash root folder.  This is
// hard-coded to a Firefox built-in bookmark folder ID, which is technically an
// implementation detail, but is very unlikely to change. :/
const STASH_PARENT = 'unfiled_____';

// The name of the stash root folder.  This name must match exactly.
export const STASH_FOLDER = 'Tab Stash';

const ROOT_FOLDER_HELP = 'https://github.com/josh-berry/tab-stash/wiki/Problems-Locating-the-Tab-Stash-Bookmark-Folder';

// We have two ways of searching for the root folder--the first, which is more
// strict, looks only in "Other Bookmarks" for the first folder named "Tab
// Stash".  The second/fallback method is less strict but more
// backward-compatible, and designed to work in cases where users moved their
// stashes around.
//
// The problem with the old way is that if a user has more than one "Tab Stash"
// folder in their bookmarks, the old way might choose the wrong folder,
// depending on the order in which folders were created.  This reordering could
// happen spontaneously due to sync issues, or as the result of a backup/restore
// or similar; basically anything that disturbs the creation time of bookmarks
// is at risk of spontaneously changing which folder Tab Stash thinks of as the
// root.
//
// This function checks for a variety of situations that can occur if users move
// their stashes around in ways that might cause ambiguity about which root to
// use, and tries to provide suitable warnings/remedies.
export async function rootFolderWarning():
    Promise<[string, () => void] | undefined>
{
    const new_root_candidates = await candidateRootFolders();
    const old_root_candidates = await candidateRootFoldersCompat();

    // No stashes exist, so no problem.  (The old way of searching should always
    // find the new stuff as well.)
    if (old_root_candidates.length == 0) {
        return;
    }

    if (new_root_candidates.length == 0) {
        // No candidates from the new search means the stash isn't in Other
        // Bookmarks, and we need to warn the user.  If there's only one old
        // candidate, the good news is we can fix it up easily for them.
        if (old_root_candidates.length == 1) {
            return [
                `Your "${STASH_FOLDER}" bookmark folder was moved out of Other Bookmarks.  This may cause problems in the future.  Click here to move it back.`,
                async () => {
                    await browser.bookmarks.move(old_root_candidates[0].id, {
                        parentId: STASH_PARENT,
                        index: 0,
                    });
                    await window.location.reload();
                },
            ];
        } else {
            return [
                `Your "${STASH_FOLDER}" bookmark folder was moved out of Other Bookmarks, and Tab Stash isn't sure where to find it.  Click here to find out how to resolve the issue.`,
                () => { browser.tabs.create({active: true, url: ROOT_FOLDER_HELP}); },
            ];
        }
    }

    // We have at least one root candidate, possibly more.  If we have multiple
    // root candidates, we need to warn because of the possibility of sync
    // conflicts the user might not be aware of.  If we have a single root
    // candidate, but the new and old algorithms disagree, we also warn because
    // it's likely the user isn't seeing what they expected to see in the UI.
    // Otherwise, we can safely assume it's something relatively benign like a
    // "Tab Stash" stash inside the stash root.
    if (new_root_candidates[0].id != old_root_candidates[0].id
        || new_root_candidates.length > 1)
    {
        return [
            `You have multiple "${STASH_FOLDER}" bookmark folders, and Tab Stash isn't sure which one to use.  Click here to find out how to resolve the issue.`,
            () => { browser.tabs.create({active: true, url: ROOT_FOLDER_HELP}); },
        ];
    }

    // Otherwise no warning is necessary and we implicitly return undefined.
}

// Find a root folder using the new way, falling back to the old way, and
// falling back to creating a new folder if even the old way doesn't work.
export async function rootFolder(): Promise<BookmarkTreeNode> {
    const candidates = await candidateRootFolders();
    if (candidates.length > 0) return candidates[0];

    // If that doesn't work, fall back to the search method used in Tab Stash
    // 2.5 and earlier, which is error-prone but will find folders that have
    // been moved by the user.
    const old_roots = await candidateRootFoldersCompat();
    if (old_roots.length > 0) return old_roots[0];

    // If even that didn't work, create a new stash root.
    return await browser.bookmarks.create({
        parentId: STASH_PARENT,
        title: STASH_FOLDER,
        type: 'folder',
    });
}

// Old/backward-compatible way to find the root folder; DEPRECATED.  If this
// method is used, the user should be presented with a warning.
export const candidateRootFoldersCompat = async () =>
    (await browser.bookmarks.search({title: STASH_FOLDER}))
        .filter(c => c && c.type === 'folder');

// The new, "correct" way to find a root folder.
export const candidateRootFolders = async () =>
    (await browser.bookmarks.getChildren(STASH_PARENT))
        .filter(c => c && c.type === 'folder' && c.title == STASH_FOLDER);

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
    const options = await Options.sync();
    const root = await rootFolder();
    const topmost = (await browser.bookmarks.getChildren(root.id))[0];

    // Is there a top-most item under the root folder, and is it a folder?
    if (! topmost) return undefined;
    if (topmost.type !== 'folder') return undefined;

    // Does the folder have a name which looks like a default name?
    if (! getFolderNameISODate(topmost.title)) return undefined;

    // Did something create/update this folder recently?
    // #cast dateAdded is always present on folders
    const age_cutoff = Date.now() - options.new_folder_timeout_min *60*1000;
    if (topmost.dateAdded! < age_cutoff) {
        return undefined;
    }

    // If so, we can put new stuff here by default.  (Otherwise we should
    // probably assume this isn't recent enough and a new folder should be
    // created.)
    return topmost.id;
}

export function isURLStashable(urlstr: string): boolean {
    try {
        let url = new URL(urlstr);
        switch (url.protocol) {
            case 'about:':
                switch (url.pathname) {
                    // We carve out an exemption for about:reader URLs, since
                    // these are actual sites being viewed in reader mode.
                    case 'reader': return true;
                    default: return false;
                }
            case 'javascript:':
            case 'moz-extension:':
            case 'chrome-extension:': // Hey, you never know...
            case 'chrome:':
            case 'file:':
                return false;
        }
    } catch (e) {
        console.warn('Unparseable URL:', urlstr);
        return false;
    }

    return true;
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

    const tabs = await browser.tabs.query(
        {windowId, hidden: false, pinned: false});
    tabs.sort((a, b) => a.index - b.index);

    let selected = tabs.filter(t => t.highlighted);
    if (selected.length <= 1) selected = tabs;

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
    let opts_p = Options.local();

    await refocusAwayFromTabs(tabs);
    const opts = await opts_p;

    const tids = <number[]>tabs.map(t => t.id).filter(id => id !== undefined);

    switch (opts.after_stashing_tab) {
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
}

export async function closeTabs(tabs: PartialTabInfo[]): Promise<void> {
    const tids = <number[]>tabs.map(t => t.id).filter(id => id !== undefined);
    await refocusAwayFromTabs(tabs);
    await browser.tabs.remove(tids);
}

export async function refocusAwayFromTabs(
    tabs: PartialTabInfo[]
): Promise<void> {
    const all_tabs = await browser.tabs.query(
        {currentWindow: true, hidden: false});

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

// Determine if the specified tab has anything "useful" in it (where "useful" is
// defined as neither the new-tab page nor the user's home page).  Returns the
// tab itself if not, otherwise returns undefined.
export async function isNewTabURL(url: string | undefined): Promise<boolean> {
    let newtab_url_p = browser.browserSettings.newTabPageOverride.get({});
    let home_url_p = browser.browserSettings.newTabPageOverride.get({});
    let newtab_url = (await newtab_url_p).value;
    let home_url = (await home_url_p).value;

    switch (url) {
        case newtab_url:
        case home_url:
        case 'about:blank':
        case 'about:newtab':
            return true;
        default:
            return false;
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
            type: 'folder',
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
            url: urlToOpen(tabs_to_actually_save[tab_index].url!),
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
    urls: string[],
    options: {background?: boolean}
): Promise<browser.tabs.Tab[]> {
    // Remove duplicate URLs so we only try to restore each URL once.
    urls = Array.from(new Set(urls));

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
    let ps: Promise<browser.tabs.Tab>[] = [];
    let index = wintabs.length;
    for (const url of urls) {
        const open = wintabs.find(tab => (tab.url === url
                                          || urlToOpen(tab.url!) === url));
        if (open && open.id !== undefined) {
            // Tab is already open.  If it was hidden, un-hide it and move it to
            // the right location in the tab bar.
            if (open.hidden) {
                ps.push(async function(open) {
                    await browser.tabs.show([open.id!]);
                    await browser.tabs.move(
                        open.id!, {windowId: winid, index});
                    return open;
                }(open));
                ++index;
            }
            continue;
        }

        const closed = closed_tabs.find(
            sess => (sess.tab && (sess.tab.url === url
                                  || urlToOpen(sess.tab.url!) === url)
                     || false));
        if (closed) {
            const ct = closed.tab!;

            // Tab was recently-closed.  Re-open it, and move it to the right
            // location in the tab bar.
            ps.push(async function(ct) {
                // #undef We filtered out non-tab sessions above, and we know
                // that /ct/ is a session-flavored Tab.
                const t = (await browser.sessions.restore(ct.sessionId!)).tab!;
                // #undef The restored tab is a normal (non-devtools) tab
                await browser.tabs.move(t.id!, {windowId: winid, index});
                return t;
            }(ct));
            ++index;
            continue;
        }

        ps.push(browser.tabs.create({
            active: false, url: urlToOpen(url), windowId: winid, index}));
        ++index;
    }

    // NOTE: Can't do this with .map() since await doesn't work in a nested
    // function context. :/
    let tabs: browser.tabs.Tab[] = [];
    for (let p of ps) tabs.push(await p);

    if (! options || ! options.background) {
        // Special case: If we were asked to open only one tab AND that tab is
        // already open, just switch to it.
        if (urls.length == 1 && tabs.length == 0) {
            const open_tab = wintabs.find(t => t.url === urls[0]
                                          || urlToOpen(t.url!) === urls[0]);
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
        if (tabs.length > 0 && await isNewTabURL(curtab.url)
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

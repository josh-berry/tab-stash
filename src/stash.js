"use strict";

export const STASH_FOLDER = 'Tab Stash';

export function getFolderNameISODate(n) {
    let m = n.match(/saved-([-0-9:.T]+Z)/);
    return m ? m[1] : null;
}
export const genDefaultFolderName = (date) => 'saved-' + date.toISOString();



export async function stashFrontTab(folder_id) {
    // We have to open the sidebar before the first "await" call, otherwise we
    // won't actually have permission to do so per Firefox's API rules.
    browser.sidebarAction.open().catch(console.log);

    if (folder_id === undefined) {
        // To avoid creating a bunch of folders with only one bookmark, we
        // should append stashed tabs to the topmost folder, but only if it's
        // not named--since we don't exactly know the user's intentions, we
        // shouldn't mess with their named folders.
        let root = (await browser.bookmarks.search({title: STASH_FOLDER}))[0];
        if (root) {
            let topmost = (await browser.bookmarks.getChildren(root.id))[0];
            console.log(topmost);
            if (topmost
                && topmost.type === 'folder'
                && getFolderNameISODate(topmost.title))
            {
                folder_id = topmost.id;
            }
        }
    }

    let tabs = await browser.tabs.query({currentWindow: true});
    let front_tabs = tabs.filter(t => t.active);
    let [saved_tabs, _] = await bookmarkTabs(folder_id, front_tabs);

    if (saved_tabs.length >= tabs.length) {
        // If we are about to close all tabs in the window, we should open a new
        // one so that the window doesn't close.
        await browser.tabs.create({active: true});
    }

    await hideAndDiscardTabs(saved_tabs);
}

export async function stashOpenTabs(folder_id) {
    // We have to open the sidebar before the first "await" call, otherwise we
    // won't actually have permission to do so per Firefox's API rules.
    browser.sidebarAction.open().catch(console.log);

    let tabs = await browser.tabs.query({currentWindow: true});
    let [saved_tabs, remaining_tabs] = await bookmarkTabs(folder_id, tabs);

    // Create a new tab here (if we're not already looking at one), since we are
    // about to close a bunch of tabs in this window.  Technically there may
    // still be some tabs leftover (e.g. pinned and extension tabs, which are
    // ignored for different reasons), but typically the user will stash all
    // open tabs when they're about to switch contexts.  So giving them a fresh
    // new tab is probably a good idea.
    if (! await lookingAtNewTab()) await browser.tabs.create({active: true});

    await hideAndDiscardTabs(saved_tabs);
}

// Determine if the currently-focused tab is the new-tab page.  If so, return
// the tab (presumably because we may want to close it).  Otherwise, return
// undefined.
export async function lookingAtNewTab() {
    let curtabs_p = browser.tabs.query({active: true, currentWindow: true});
    let newtab_url_p = browser.browserSettings.newTabPageOverride.get({});
    let curtab = (await curtabs_p)[0];
    let newtab_url = (await newtab_url_p).value;

    if (curtab && curtab.url === newtab_url) return curtab;
    return undefined;
}

export async function bookmarkTabs(folderId, all_tabs) {
    // First figure out which of the tabs to save, and make sure they are sorted
    // by their actual position in the tab bar.  We ignore tabs with unparseable
    // URLs or which look like extensions and internal browser things.
    let is_normal_tab = tab => {
        try {
            let url = new URL(tab.url);
            switch (url.protocol) {
            case 'moz-extension:':
            case 'about:':
            case 'chrome:':
                return false;
            }
        } catch (e) {
            console.warn('Tab with unparseable URL:', tab, tab.url);
            return false;
        }

        if (tab.pinned) return false;
        if (tab.hidden) return false;
        return true;
    };
    let tabs = all_tabs.filter(is_normal_tab);
    let unsaved_tabs = all_tabs.filter(t => ! is_normal_tab(t));
    tabs.sort((a, b) => a.index - b.index);

    // If there are no tabs to save, early-exit here so we don't unnecessarily
    // create bookmark folders we don't need.
    if (tabs.length == 0) return [tabs, unsaved_tabs];

    // Find or create the root of the stash.
    let root = (await browser.bookmarks.search({title: STASH_FOLDER}))[0]
        || (await browser.bookmarks.create({
            title: STASH_FOLDER,
            type: 'folder',
        }));

    // Keep track of which tabs to actually save (we filter below based on what
    // we already have), and where in the folder to save them (we want to
    // append).
    let tabs_to_actually_save = tabs;
    let index = 0;

    if (folderId === undefined) {
        // Create a new folder, if it wasn't specified.
        let folder = await browser.bookmarks.create({
            parentId: root.id,
            title: genDefaultFolderName(new Date()),
            type: 'folder',
            index: 0, // Newest folders should show up on top
        });
        folderId = folder.id;

        // When saving to this folder, we want to save all tabs we previously
        // identified as "save-worthy", and we want to insert them at the
        // beginning of the folder.  So, no changes to /tabs_to_actually_save/
        // or /index/ here.

    } else {
        // If we're adding to an existing folder, skip bookmarks which already
        // exist in that folder.  These won't be picked up by
        // gcDuplicateBookmarks() below since we purposefully exclude the folder
        // we are adding to/just created (see below for why).
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

    // Now save each tab as a bookmark.
    //
    // Unfortunately, Firefox doesn't have an API to save multiple bookmarks in
    // a single transaction, so to avoid this being unbearably slow, we do this
    // in two passes--create a bunch of empty bookmarks in parallel, and then
    // fill them in with the right values (again in parallel).
    let ps = [];
    let created_bm_ids = new Set();
    for (let tab of tabs_to_actually_save) {
        ps.push(browser.bookmarks.create({
            parentId: folderId,
            title: 'Stashing...',
            url: 'about:blank',
            index,
        }));
        ++index;
    }
    for (let p of ps) created_bm_ids.add((await p).id);
    ps = [];

    // We now read the folder back to determine the order of the created
    // bookmarks, so we can fill each of them in in the correct order.
    let child_bms = (await browser.bookmarks.getSubTree(folderId))[0].children;

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
    for (let p of ps) await p;

    // In the background, remove any duplicate bookmarks in other tab-stash
    // folders.  gcDuplicateBookmarks() prefers to keep bookmarks that appear
    // earlier in the tree over those that appear later.  We purposefully
    // exclude the folder we just created/added to, since the user expressed a
    // preference to have open tabs saved to this folder (and not other
    // folders).  So it's better to remove from OTHER folders even if they
    // appear first.
    //
    // We also avoid touching URLs that weren't explicitly saved, since that may
    // be surprising to users (there are corner cases where we might have
    // duplicates if the user decides to rename a named folder to have a
    // default/temporary name once again).
    gcDuplicateBookmarks(root.id, new Set([folderId]),
                         new Set(tabs.map(t => t.url))).catch(console.log);

    return [tabs, unsaved_tabs];
}

export async function gcDuplicateBookmarks(
    root_id, ignore_folder_ids, urls_to_check)
{
    let folders = (await browser.bookmarks.getSubTree(root_id))[0].children;

    // We want to preserve/ignore duplicates in folders which are ignored
    // (/ignored_folder_ids/), and folders which were explicitly-named by the
    // user (i.e. folders which do not have a "default" name of the date/time at
    // which they were created).  These are "preserved folders".
    let should_preserve_folder = f =>
        (ignore_folder_ids && ignore_folder_ids.has(f.id))
        || ! getFolderNameISODate(f.title);

    // We do two passes--first, we look at preserved folders and add all their
    // URLs to the /seen_urls/ set.  Then, we look at all the NON-prserved
    // folders and remove URLs that we've already seen.
    //
    // The intention here is that by default, we remove duplicates that show up
    // later in the bookmarks tree, EXCEPT for preserved folders--we prefer to
    // keep duplicates in those folders instead, and we want to REMOVE
    // duplicates in non-preserved folders even if they show up earlier in the
    // tree.

    // Pass 1 - Note which bookmarks exist in preserved folders.
    let seen_urls = new Set();
    for (let f of folders) {
        if (! f.children) continue;
        if (! should_preserve_folder(f)) continue;

        for (let b of f.children) if (b.url) seen_urls.add(b.url);
    }

    // Pass 2 - Remove bookmarks from non-preserved folders.
    let ps = [];
    for (let f of folders) {
        if (! f.children) continue;
        if (should_preserve_folder(f)) continue;

        // Remove any bookmarks which we have already seen.  Keep track of how
        // many we removed so we know when the folder is empty and can itself be
        // removed.
        let rmcount = 0;
        for (let b of f.children) {
            if (! b.url) continue;

            if (urls_to_check.has(b.url) && seen_urls.has(b.url)) {
                ps.push(browser.bookmarks.remove(b.id));
                ++rmcount;
            } else {
                seen_urls.add(b.url);
            }
        }

        if (rmcount == f.children.length) {
            // This folder should be empty.  Remove it (using regular remove()
            // so if it's not actually empty, the remove will fail).
            //
            // First, however, wait for outstanding removes so we don't try to
            // remove a folder that has stuff that's still in the process of
            // being removed.
            for (let p of ps) try {await p} catch(e) {console.log(e)};
            ps = [];

            ps.push(browser.bookmarks.remove(f.id));
        }
    }

    for (let p of ps) try {await p} catch(e) {console.log(e)};
}

export async function hideAndDiscardTabs(tabs) {
    let tids = tabs.map((t) => t.id);
    await browser.tabs.hide(tids);
    await browser.tabs.discard(tids);
}

export function asyncEvent(async_fn) {
    return function() {
        async_fn.apply(this, arguments).catch(console.log);
    };
}

export async function restoreTabs(urls) {
    // Remove duplicate URLs so we only try to restore each URL once.
    urls = Array.from(new Set(urls));

    // First collect some info from the browser; done in parallel to reduce
    // latency.

    // We want to know which tab the user is currently looking at so
    // we can close it if it's just the new-tab page.
    let tab_to_close_p = lookingAtNewTab();

    // We also want to know what tabs were recently closed, so we can
    // restore/un-hide tabs as appropriate.
    let closed_tabs_p = browser.sessions.getRecentlyClosed();

    // We also need to know which window to restore tabs to, and what tabs are
    // presently open in that window.
    let win_p = browser.windows.getCurrent({
        windowTypes: ['normal'], populate: true});

    let tab_to_close = await tab_to_close_p;
    let closed_tabs = await closed_tabs_p;
    let win = await win_p;

    // We can restore a tab in one of four(!) ways:
    //
    // 1. Do nothing (because the tab is already open).
    // 2. Un-hide() it, if it was previously hidden and is still open.
    // 3. Re-open a recently-closed tab with the same URL.
    // 4. Open a new tab.
    //
    // Let's figure out which strategy to use for each tab, and kick it off.
    let ps = [];
    let index = win.tabs.length;
    for (let url of urls) {
        let open = win.tabs.find(tab => (tab.url === url));
        if (open) {
            // Tab is already open.  If it was hidden, un-hide it and move it to
            // the right location in the tab bar.
            if (open.hidden) {
                ps.push(browser.tabs.show([open.id])
                        .then(() => browser.tabs.move(
                            [open.id], {windowId: win.id, index}))
                        .then(() => open));
                ++index;
            }
            continue;
        }

        let closed = closed_tabs.find(
            sess => (sess.tab && sess.tab.url === url));
        if (closed) {
            // Tab was recently-closed.  Re-open it, and move it to the right
            // location in the tab bar.
            ps.push(browser.sessions.restore(closed.tab.sessionId)
                    .then(sess => browser.tabs.move(
                        [sess.tab.id], {windowId: win.id, index})
                          .then(() => sess.tab)));
            ++index;
            continue;
        }

        // Tab was never open in the first place.
        ps.push(browser.tabs.create({active: false, url, index}));
        ++index;
    }

    // NOTE: Can't do this with .map() since await doesn't work in a nested
    // function context. :/
    let tabs = [];
    for (let p of ps) tabs.push(await p);

    // Special case: If we were asked to open only one tab AND that tab is
    // already open, just switch to it.
    if (urls.length == 1 && tabs.length == 0) {
        await browser.tabs.update(open[0].id, {active: true});
    }

    // Special case: If only one tab was restored, switch to it.  (This is
    // different from the special case above, in which NO tabs are restored.)
    if (tabs.length == 1) {
        let tab = tabs[0];
        // It's actually a Session, but instanceof doesn't work here because
        // Session isn't a constructor (you can't create your own, you can only
        // get them from the browser).  So we have to do some true duck-typing.
        await browser.tabs.update(tab.id, {active: true});
    }

    // Finally, if we opened at least one tab, AND the current tab is looking at
    // the new-tab page, close the current tab in the background.
    if (tabs.length > 0 && tab_to_close) {
        browser.tabs.remove([tab_to_close.id]).catch(console.log);
    }
}

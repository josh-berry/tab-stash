"use strict";

export const STASH_FOLDER = 'Tab Stash';

export function getFolderNameISODate(n) {
    let m = n.match(/saved-([-0-9:.T]+Z)/);
    return m ? m[1] : null;
}
export const genDefaultFolderName = (date) => 'saved-' + date.toISOString();



export async function stashAllTabs(folder_id) {
    // We have to open the sidebar before the first "await" call, otherwise we
    // won't actually have permission to do so per Firefox's API rules.
    browser.sidebarAction.open().then(() => {});

    let [saved_tabs, remaining_tabs] = await bookmarkOpenTabs(folder_id);

    // Create a new tab here (if we're not already looking at one), since we are
    // about to close a bunch of tabs in this window.  Technically there may
    // still be some tabs leftover (e.g. pinned and extension tabs, which are
    // ignored for different reasons), but typically the browser action is
    // invoked when the user is about to switch contexts.  So giving them a
    // fresh new tab is probably a good idea.
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

export async function bookmarkOpenTabs(folderId) {
    // First figure out which of the open tabs to save, and make sure they are
    // sorted by their actual position in the tab bar.  We ignore tabs with
    // unparseable URLs or which look like extensions and internal browser
    // things.
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
    let all_tabs = await browser.tabs.query({currentWindow: true});
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
        let existing_bms = (await browser.bookmarks.getSubTree(folderId))[0]
            .children
            .map(bm => bm.url);

        tabs_to_actually_save = tabs_to_actually_save.filter(
            tab => ! existing_bms.includes(tab.url));

        // Append new bookmarks to the end of the folder.
        index = existing_bms.length;
    }

    // Now save each tab as a bookmark.
    //
    // This can't be parallelized because otherwise the bookmarks will get saved
    // in the wrong order.  Specifying the index is ALSO necessary because
    // again, bookmarks should be inserted in order--and if you leave it off,
    // the browser may do all kinds of random nonsense.
    //
    // I really wish Firefox would give us a way to add a bunch of bookmarks at
    // once as a single transaction... this is probably the slowest operation in
    // the whole extension. :/
    for (let tab of tabs_to_actually_save) {
        await browser.bookmarks.create({
            parentId: folderId,
            title: tab.title,
            url: tab.url,
            index,
        });
        ++index;
    }

    // In the background, remove duplicate bookmarks, since we just added a
    // bunch of new ones.  gcDuplicateBookmarks() prefers to keep bookmarks that
    // appear earlier in the tree over those that appear later.  We purposefully
    // exclude the folder we just created/added to, since the user expressed a
    // preference to have open tabs saved to this folder (and not other
    // folders).  So it's better to remove from OTHER folders even if they
    // appear first.
    //
    // We also avoid toucing URLs that weren't explicitly saved, since that may
    // be surprising to users.
    gcDuplicateBookmarks(root.id, new Set([folderId]),
                         new Set(tabs.map(t => t.url)))
        .then(() => {});

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
    // XXX Hide is presently experimental; once it's ready, we can use this
    // instead to preserve tab state.
    //let hide_p = browser.tabs.hide(tids);
    let hide_p = browser.tabs.remove(tids);
    await hide_p;
}

export function asyncEvent(async_fn) {
    return function() {
        async_fn.apply(this, arguments).then((x) => x);
    };
}

export async function restoreTabs(urls) {
    // Remove duplicate URLs so we only try to restore each URL once.
    urls = Array.from(new Set(urls));

    // Try to determine if the currently-focused tab is a new tab.  If so, we
    // should close it once we've opened the tabs we are restoring, so the user
    // doesn't have an errant "empty" tab floating around.
    let tab_to_close = await lookingAtNewTab();

    // See which tabs are already open and remove them from the list
    let open = await browser.tabs.query({currentWindow: true, url: urls});
    let to_open = urls.filter(url => ! open.some(tab => tab.url === url));

    // For each URL that we're going to restore, figure out how--are we
    // restoring by reopening a closed tab, or by creating a new tab?
    let sessions = await browser.sessions.getRecentlyClosed();
    let strategies = to_open.map(url => [
        url, sessions.find(sess => sess.tab && sess.tab.url === url)]);

    // Now restore tabs.  Done serially so we always restore in the same
    // positions.
    let win = (await browser.windows.getCurrent({windowTypes: ['normal']}));
    let ps = [];
    for (let [url, sess] of strategies) {
        console.log('restoring', url, sess);
        let p = sess
            ? browser.sessions.restore(sess.tab.sessionId)
              .then(sess => browser.tabs.move(
                            [sess.tab.id], {windowId: win.id, index: 0xffffff})
                        .then(() => sess))
            : browser.tabs.create({active: false, url, index: 0xffffff});
        ps.push(p);
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
        if (tab.tab) tab = tab.tab;
        await browser.tabs.update(tab.id, {active: true});
    }

    // Finally, if opened at least one tab, AND the current tab is looking at
    // the new-tab page, close the current tab in the background.
    if (tabs.length > 0 && tab_to_close) {
        browser.tabs.remove([tab_to_close.id]).then(() => {});
    }
}

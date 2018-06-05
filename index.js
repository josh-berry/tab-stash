"use strict";

// Tab Stash - Unified source for everything

const STASH_FOLDER = 'Tab Stash';

function getFolderNameISODate(n) {
    let m = n.match(/saved-([-0-9:.T]+Z)/);
    return m ? m[1] : null;
}
const genDefaultFolderName = (date) => 'saved-' + date.toISOString();

window.addEventListener('load', () => {
    if (! document.body.className) {
        // Background page
        browser.menus.create({
            contexts: ['browser_action', 'tab', 'tools_menu'],
            title: 'Show Stashed Tabs',
            id: 'show-stashed-tabs'
        });

        browser.menus.onClicked.addListener((info, tab) => {
            if (info.menuItemId == 'show-stashed-tabs') {
                browser.sidebarAction.open().then(() => {});
            }
        });

        browser.browserAction.onClicked.addListener(() => {
            browserAction().then(() => {});
        });
    }
});



async function browserAction() {
    // We have to open the sidebar before the first "await" call, otherwise we
    // won't actually have permission to do so per Firefox's API rules.
    browser.sidebarAction.open().then(() => {});

    let [saved_tabs, remaining_tabs] = await bookmarkOpenTabs();

    if (remaining_tabs.length == 0) {
        // We are about to close all tabs in this window.  To keep the window
        // itself open, we need to open a fresh tab so that there is always at
        // least one visible tab in the window.
        await browser.tabs.create({active: true});
    }
    await hideAndDiscardTabs(saved_tabs);
}

async function bookmarkOpenTabs(folderId, startIndex) {
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

    // Create the bookmarks folders (including the root folder if it doesn't
    // exist yet).
    if (folderId === undefined) {
        let root = (await browser.bookmarks.search({title: STASH_FOLDER}))[0]
            || (await browser.bookmarks.create({
                title: STASH_FOLDER,
                type: 'folder',
            }));
        let folder = await browser.bookmarks.create({
            parentId: root.id,
            title: genDefaultFolderName(new Date()),
            type: 'folder',
            index: 0, // Newest folders should show up on top
        });
        folderId = folder.id;
    }

    // Now save each tab as a bookmark.
    //
    // This can't be parallelized because otherwise the bookmarks will get saved
    // in the wrong order.  Specifying the index is ALSO necessary because
    // again, bookmarks should be inserted in order--and if you leave it off,
    // the browser may do all kinds of random nonsense.
    let index = startIndex ? startIndex : 0;
    for (let tab of tabs) {
        await browser.bookmarks.create({
            parentId: folderId,
            title: tab.title,
            url: tab.url,
            index,
        });
        ++index;
    }

    // In the background, remove duplicate bookmarks, since we just added a
    // bunch of new ones.
    gcDuplicateBookmarks().then(() => {});

    return [tabs, unsaved_tabs];
}

async function gcDuplicateBookmarks() {
    let root = (await browser.bookmarks.search({title: STASH_FOLDER}))[0];
    let folders = (await browser.bookmarks.getSubTree(root.id))[0].children;

    let seen_urls = new Set();
    let ps = [];
    for (let f of folders) {
        let rmcount = 0;
        for (let b of f.children) {
            if (seen_urls.has(b.url) && getFolderNameISODate(f.title)) {
                ps.push(browser.bookmarks.remove(b.id));
                ++rmcount;
            }
            seen_urls.add(b.url);
        }
        if (rmcount == f.children.length && getFolderNameISODate(f.title)) {
            // This folder should be empty, and it's a temporary/unnamed folder.
            // Remove it (using regular remove() so if it's not actually empty,
            // the remove will fail).
            //
            // First, however, wait for outstanding removes so we don't try to
            // remove a folder that has stuff that's still in the process of
            // being removed.
            for (let p of ps) try {await p} catch(e) {console.log(e)}

            ps = [];
            ps.push(browser.bookmarks.remove(f.id));
        }
    }

    for (let p of ps) try {await p} catch(e) {console.log(e)}
}

async function hideAndDiscardTabs(tabs) {
    let ps = [];
    let tids = tabs.map((t) => t.id);
    let discard_p = browser.tabs.discard(tids);
    // XXX Hide is presently experimental; once it's ready, we can use this
    // instead to preserve tab state.
    //let hide_p = browser.tabs.hide(tids);
    let hide_p = browser.tabs.remove(tids);
    await discard_p;
    await hide_p;
}

function asyncEvent(async_fn) {
    return function() {
        async_fn.apply(this, arguments).then((x) => x);
    };
}

async function restoreTabs(urls) {
    // Remove duplicate URLs so we only try to restore each URL once.
    urls = Array.from(new Set(urls));

    // See which tabs are already open and remove them from the list
    let open = await browser.tabs.query({currentWindow: true, url: urls});
    let to_open = urls.filter(url => ! open.some(tab => tab.url === url));

    // Special case: If we were asked to open only one tab AND that tab is
    // already open, just switch to it.
    if (urls.length == 1 && to_open.length == 0) {
        await browser.tabs.update(open[0].id, {active: true});
        return;
    }

    // Figure out which window the tab needs to go to.  Only needed for
    // restoring recently-closed tabs.
    let win = await browser.windows.getCurrent({windowTypes: ['normal']});

    // For each URL that we're going to restore, figure out how--are we
    // restoring by reopening a closed tab, or by creating a new tab?
    let sessions = await browser.sessions.getRecentlyClosed();
    let strategies = to_open.map(url => [
        url, sessions.find(sess => sess.tab && sess.tab.url === url)]);

    // Now restore tabs.  Done serially so we always restore in the same
    // positions.
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
}

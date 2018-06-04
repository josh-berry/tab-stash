"use strict";

// Tab Stash - Unified source for everything

const STASH_FOLDER = 'Tab Stash';

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
                showStashedTabsTab().then(() => {});
            }
        });

        browser.browserAction.onClicked.addListener(() => {
            browserAction().then(() => {});
        });
    }
});



async function browserAction() {
    let saved_tabs = await bookmarkOpenTabs();

    // Show stashed tabs FIRST so there is no time window in which the current
    // browser window has no tabs.
    await showStashedTabsTab();
    await hideAndDiscardTabs(saved_tabs);
}

async function bookmarkOpenTabs() {
    // First figure out which of the open tabs to save, and make sure they are
    // sorted by their actual position in the tab bar.  We ignore tabs with
    // unparseable URLs or which look like extensions and internal browser
    // things.
    let tabs = (await browser.tabs.query({currentWindow: true}))
        .filter(tab => {
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
        });
    tabs.sort((a, b) => a.index - b.index);

    // If there are no tabs to save, early-exit here so we don't unnecessarily
    // create bookmark folders we don't need.
    if (tabs.length == 0) return [];

    // Create the bookmarks folders (including the root folder if it doesn't
    // exist yet).
    let root = (await browser.bookmarks.search({title: STASH_FOLDER}))[0]
            || (await browser.bookmarks.create({
                    title: STASH_FOLDER,
                    type: 'folder',
               }));
    let folder = await browser.bookmarks.create({
        parentId: root.id,
        title: (new Date()).toISOString(), // XXX nicer date format
        type: 'folder',
        index: 0, // Newest folders should show up on top
    });

    // Now save each tab as a bookmark.
    //
    // This can't be parallelized because otherwise the bookmarks will get saved
    // in the wrong order.  Specifying the index is ALSO necessary because
    // again, bookmarks should be inserted in order--and if you leave it off,
    // the browser may do all kinds of random nonsense.
    let saved_tabs = [];
    let index = 0;
    for (let tab of tabs) {
        await browser.bookmarks.create({
            parentId: folder.id,
            title: tab.title,
            url: tab.url,
            index,
        });
        ++index;

        saved_tabs.push(tab);
    }

    return saved_tabs;
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

function showStashedTabsTab() {
    return restoreTabs([browser.extension.getURL('stash-list.html')]);
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
            ? browser.sessions.restore(sess.tab.sessionId).then(
                sess => browser.tabs.move([sess.tab.id], {index: 0xffffff}))
            : browser.tabs.create({active: false, url, index: 0xffffff});
        ps.push(p);
    }

    // NOTE: Can't do this with .map() since await doesn't work in a nested
    // function context. :/
    let tabs = [];
    for (let p in ps) tabs.push(await p);

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

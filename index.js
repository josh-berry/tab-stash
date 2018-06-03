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
    let root = (await browser.bookmarks.search({title: STASH_FOLDER}))[0];
    if (! root) {
        root = await browser.bookmarks.create({
            title: STASH_FOLDER,
            type: 'folder',
        });
    }

    // XXX Nicer date format
    let title = (new Date()).toISOString();
    let folder = await browser.bookmarks.create({
        parentId: root.id,
        title: title,
        type: 'folder',
        index: 0, // Newest folders should show up on top
    });

    // This can't be parallelized because otherwise the bookmarks will get saved
    // in the wrong order.  Specifying the index is ALSO necessary because
    // again, bookmarks should be inserted in order--and if you leave it off,
    // the browser may do all kinds of random nonsense.

    let tabs = await browser.tabs.query({currentWindow: true});
    tabs.sort((a, b) => a.index - b.index);

    console.log(tabs);

    let saved_tabs = [];
    let index = 0;
    for (let tab of tabs) {
        // Ignore tabs with unparseable URLs or which look like extensions and
        // internal browser things.
        try {
            let url = new URL(tab.url);
            switch (url.protocol) {
            case 'moz-extension:':
            case 'about:':
            case 'chrome:':
                continue;
            }
        } catch (e) {
            console.warn('Tab with unparseable URL:', tab, tab.url);
            continue;
        }

        if (tab.pinned) continue;
        if (tab.hidden) continue;

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
    return openOrSwitchToTab(browser.extension.getURL('stash-list.html'));
}

async function openOrSwitchToTab(url) {
    let open = (await browser.tabs.query({url}))[0];
    if (! open) {
        open = await browser.tabs.create({
            active: true,
            url,
        });
    }
    await browser.tabs.update(open.id, {active: true});
    await browser.windows.update(open.windowId, {focused: true});
}

function asyncEvent(async_fn) {
    return function() {
        async_fn.apply(this, arguments).then((x) => x);
    };
}

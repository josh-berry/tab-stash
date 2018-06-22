"use strict";

import {asyncEvent, urlsInTree} from 'util';
import {
    stashOpenTabs, stashFrontTab, restoreTabs, tabStashTree,
} from 'stash';

browser.menus.create({
    contexts: ['browser_action', 'tab', 'tools_menu'],
    title: 'Stashed Tabs (Sidebar)',
    id: 'show-stashed-tabs-sidebar'
});

browser.menus.create({
    contexts: ['browser_action', 'tab', 'tools_menu'],
    title: 'Stashed Tabs (New Tab)',
    id: 'show-stashed-tabs-tab'
});

browser.menus.onClicked.addListener((info, tab) => {
    if (info.menuItemId == 'show-stashed-tabs-sidebar') {
        browser.sidebarAction.open().catch(console.log);
    } else if (info.menuItemId == 'show-stashed-tabs-tab') {
        restoreTabs([browser.extension.getURL('stash-list.html')])
            .catch(console.log);
    }
});

browser.browserAction.onClicked.addListener(() => {
    stashOpenTabs(undefined).catch(console.log);
});

browser.pageAction.onClicked.addListener(() => {
    stashFrontTab(undefined).catch(console.log);
});



// These events garbage-collect hidden tabs when their corresponding bookmarks
// are removed from the tab stash.  Unfortunately, because Firefox doesn't
// provide a comprehensive accounting of all bookmarks that are removed (in
// particular, if a subtree is removed, we only get one notification for the
// top-level folder and NO information about the children that were deleted),
// the only way we can reliably identify which hidden tabs to throw away is by
// diffing the bookmark trees.
//
// This may be a bit over-aggressive if the user is using multiple extensions to
// manage hidden tabs, but there's unfortunately not much we can do about this.
// The alternative is to allow hidden tabs which belong to deleted folders to
// pile up, which will cause browser slowdowns over time.

tabStashTree().then(t => {
    let old_urls = new Set(urlsInTree(t));
    let update_running = false;
    let update_requested = false;

    const update = async function() {
        try {
            // NOTE: We yield to the event loop every time we `await` something.
            // So we check for updates in a loop and make sure the rest of the
            // system knows when we are mid-update.
            while (update_requested) {
                let new_urls = new Set(urlsInTree(await tabStashTree()));
                let windows = await browser.windows.getAll(
                    {windowTypes: ['normal'], populate: true});

                // Ugh, why am I open-coding a set-difference operation?  This
                // should be built-in!
                let removed_urls = new Set();
                for (let url of old_urls) {
                    if (! new_urls.has(url)) removed_urls.add(url);
                }

                let tids = [];
                for (let w of windows) {
                    for (let t of w.tabs) {
                        if (! t.hidden) continue;
                        if (removed_urls.has(t.url)) tids.push(t.id);
                    }
                }

                await browser.tabs.remove(tids);

                old_urls = new_urls;
                update_requested = false;
                // DO NOT `await` AFTER SETTING update_requested ABOVE.
            }
        } finally {
            update_running = false;
        }
    };

    const queue_update = () => {
        update_requested = true;
        if (update_running) return;
        update_running = true;

        // Not specifying a timeout since we are just garbage-collecting tabs in
        // the background.
        window.requestIdleCallback(asyncEvent(update));
    };

    browser.bookmarks.onRemoved.addListener(queue_update);
    browser.bookmarks.onChanged.addListener(queue_update);
    browser.bookmarks.onMoved.addListener(queue_update);
});

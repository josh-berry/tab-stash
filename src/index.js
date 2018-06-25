"use strict";

import {asyncEvent, urlsInTree, nonReentrant} from './util';
import {
    stashTabs, restoreTabs, tabStashTree,
    getFolderNameISODate, mostRecentUnnamedFolderId,
} from './stash';

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

browser.browserAction.onClicked.addListener(asyncEvent(async function() {
    // We have to open the sidebar before the first "await" call, otherwise we
    // won't actually have permission to do so per Firefox's API rules.
    browser.sidebarAction.open().catch(console.log);

    await stashTabs(undefined, await browser.tabs.query(
        {currentWindow: true, hidden: false, pinned: false}));
}));

browser.pageAction.onClicked.addListener(asyncEvent(async function() {
    // We have to open the sidebar before the first "await" call, otherwise we
    // won't actually have permission to do so per Firefox's API rules.
    browser.sidebarAction.open().catch(console.log);

    await stashTabs(await mostRecentUnnamedFolderId(), await browser.tabs.query(
        {currentWindow: true, hidden: false, active: true}));
}));



// Various garbage-collection tasks are handled here.
//
// Most importantly, we garbage-collect hidden tabs when their corresponding
// bookmarks are removed from the tab stash.  Unfortunately, because Firefox
// doesn't provide a comprehensive accounting of all bookmarks that are removed
// (in particular, if a subtree is removed, we only get one notification for the
// top-level folder and NO information about the children that were deleted),
// the only way we can reliably identify which hidden tabs to throw away is by
// diffing the bookmark trees.
//
// This may be a bit over-aggressive if the user is using multiple extensions to
// manage hidden tabs, but there's unfortunately not much we can do about this.
// The alternative is to allow hidden tabs which belong to deleted folders to
// pile up, which will cause browser slowdowns over time.
//
// We also garbage-collect empty, unnamed folders.

tabStashTree().then(t => {
    let old_urls = new Set(urlsInTree(t));

    const update = nonReentrant(async function() {
        let tree = await tabStashTree();

        // Garbage-collect empty, unnamed folders.
        //
        // If there are any such folders, this may trigger another GC run, but
        // that's okay because we will converge on the second iteration.
        for (let f of tree.children) {
            if (f.type !== 'folder') continue;
            if (! getFolderNameISODate(f.title)) continue;
            if (f.children.length > 0) continue;
            browser.bookmarks.remove(f.id).catch(console.log);
        }

        // Garbage-collect hidden tabs by diffing the old and new sets of URLs
        // in the tree.
        let new_urls = new Set(urlsInTree(tree));
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
    });

    browser.bookmarks.onRemoved.addListener(update);
    browser.bookmarks.onChanged.addListener(update);
    browser.bookmarks.onMoved.addListener(update);
});

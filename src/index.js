"use strict";

import {asyncEvent, urlsInTree, nonReentrant} from './util';
import {
    stashTabs, bookmarkTabs, restoreTabs, tabStashTree,
    getFolderNameISODate, mostRecentUnnamedFolderId,
} from './stash';



//
// User-triggered commands thru menu items, etc.  IDs in the menu items
// correspond to field names in the commands object.
//

const menu_contexts = ['browser_action', 'page_action', 'tab', 'tools_menu'];
browser.menus.create({
    contexts: menu_contexts,
    title: 'Copy All Tabs to Stash',
    id: 'copy_all'
});
browser.menus.create({
    contexts: menu_contexts,
    title: 'Copy Tab to Stash',
    id: 'copy_one'
});
browser.menus.create({
    contexts: menu_contexts,
    type: 'separator', enabled: false,
});
browser.menus.create({
    contexts: menu_contexts,
    title: 'Show Stashed Tabs (Sidebar)',
    id: 'show_sidebar'
});
browser.menus.create({
    contexts: menu_contexts,
    title: 'Show Stashed Tabs (New Tab)',
    id: 'show_tab'
});

const commands = {
    // NOTE: Several of these commands open the sidebar.  We have to open the
    // sidebar before the first "await" call, otherwise we won't actually have
    // permission to do so per Firefox's API rules.

    show_sidebar: async function(tab) {
        browser.sidebarAction.open().catch(console.log);
    },

    show_tab: async function(tab) {
        await restoreTabs([browser.extension.getURL('stash-list.html')]);
    },

    stash_all: async function() {
        browser.sidebarAction.open().catch(console.log);

        await stashTabs(undefined, await browser.tabs.query(
            {currentWindow: true, hidden: false, pinned: false}));
    },

    stash_one: async function(tab) {
        browser.sidebarAction.open().catch(console.log);
        await stashTabs(await mostRecentUnnamedFolderId(), [tab]);
    },

    copy_all: async function() {
        browser.sidebarAction.open().catch(console.log);
        await bookmarkTabs(undefined, await browser.tabs.query(
            {currentWindow: true, hidden: false, pinned: false}));
    },

    copy_one: async function(tab) {
        browser.sidebarAction.open().catch(console.log);
        await bookmarkTabs(await mostRecentUnnamedFolderId(), [tab]);
    },
};



//
// Top-level/user facing event bindings, which mostly just call commands.
//

browser.menus.onClicked.addListener((info, tab) => {
    console.assert(commands[info.menuItemId]);
    commands[info.menuItemId](tab).catch(console.log);
});

browser.browserAction.onClicked.addListener(asyncEvent(commands.stash_all));
browser.pageAction.onClicked.addListener(asyncEvent(commands.stash_one));



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

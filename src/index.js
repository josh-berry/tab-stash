"use strict";

import {asyncEvent, urlsInTree, nonReentrant} from './util';
import {
    stashTabs, bookmarkTabs, restoreTabs, tabStashTree,
    getFolderNameISODate, mostRecentUnnamedFolderId,
} from './stash';
import Options from './options-model';



//
// Continuously-updated (via browser events) objects representing the user's
// current preferences.  We need SYNCHRONOUS access to these preferences because
// of Firefox's restrictions on opening the sidebar--it must be done
// synchronously from an event handler.
//
// These are populated from within the async function at the bottom of index.js.
//
let OPTIONS = {sync: null, local: null};



//
// User-triggered commands thru menu items, etc.  IDs in the menu items
// correspond to field names in the commands object.
//

const menu_buttons = ['browser_action', 'page_action',
                      'tab', 'page', 'tools_menu'];
const menu_contexts = ['tab', 'page', 'tools_menu'];

const menu = (idprefix, contexts, def) => {
    for (let [id, title] of def) {
        if (id) {
            browser.menus.create({contexts, title, id: idprefix + id});
        } else {
            browser.menus.create({contexts, type: 'separator', enabled: false});
        }
    }
};

menu('1:', ['tab', 'page', 'tools_menu'], [
    ['stash_all', 'Stash All Tabs'],
    ['stash_one', 'Stash This Tab'],
    ['stash_one_newgroup', 'Stash This Tab to a New Group'],
    ['', ''],
    ['copy_all', 'Copy All Tabs to Stash'],
    ['copy_one', 'Copy Tab to Stash'],
    ['', ''],
    ['show_sidebar', 'Show Stashed Tabs in Sidebar'],
    ['show_tab', 'Show Stashed Tabs in a Tab'],
    ['', ''],
    ['options', 'Options...'],
]);

// These should only have like 6 items each
menu('2:', ['browser_action'], [
    ['stash_all', 'Stash All Tabs'],
    ['copy_all', 'Copy All Tabs to Stash'],
    ['', ''],
    ['show_sidebar', 'Show Stashed Tabs in Sidebar'],
    ['show_tab', 'Show Stashed Tabs in a Tab'],
]);

menu('3:', ['page_action'], [
    ['stash_one', 'Stash This Tab'],
    ['stash_one_newgroup', 'Stash This Tab to a New Group'],
    ['copy_one', 'Copy Tab to Stash'],
    ['', ''],
    ['show_sidebar', 'Show Stashed Tabs in Sidebar'],
    ['show_tab', 'Show Stashed Tabs in a Tab'],
]);

async function show_stash_if_desired() {
    switch (OPTIONS.sync.open_stash_in) {
    case 'none':
        break;

    case 'tab':
        await restoreTabs([browser.extension.getURL('stash-list.html')]);
        break;

    case 'sidebar':
    default:
        browser.sidebarAction.open().catch(console.log);
        break;
    }
}

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
        show_stash_if_desired().catch(console.log);

        let tabs = await browser.tabs.query(
            {currentWindow: true, hidden: false, pinned: false});
        await stashTabs(undefined, tabs);
    },

    stash_one: async function(tab) {
        show_stash_if_desired().catch(console.log);
        await stashTabs(await mostRecentUnnamedFolderId(), [tab]);
    },

    stash_one_newgroup: async function(tab) {
        show_stash_if_desired().catch(console.log);
        await stashTabs(undefined, [tab]);
    },

    copy_all: async function() {
        show_stash_if_desired().catch(console.log);
        await bookmarkTabs(undefined, await browser.tabs.query(
            {currentWindow: true, hidden: false, pinned: false}));
    },

    copy_one: async function(tab) {
        show_stash_if_desired().catch(console.log);
        await bookmarkTabs(await mostRecentUnnamedFolderId(), [tab]);
    },

    options: async function() {
        await browser.runtime.openOptionsPage();
    },
};



//
// Top-level/user facing event bindings, which mostly just call commands.
//

browser.menus.onClicked.addListener((info, tab) => {
    const cmd = info.menuItemId.replace(/^[^:]*:/, '');
    console.assert(commands[cmd]);
    commands[cmd](tab).catch(console.log);
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

(async function() {
    // First, populate the local and sync options objects, since we rely on
    // settings in here for a variety of things.
    let sync_p = Options.sync();
    let local_p = Options.local();
    OPTIONS.sync = await sync_p;
    OPTIONS.local = await local_p;

    if (OPTIONS.local.last_notified_version === undefined) {
        // This looks like a fresh install, (or an upgrade from a version that
        // doesn't keep track of the last-notified version, in which case, we
        // just assume it's a fresh install).  Record our current version number
        // here so we can detect upgrades in the future and show the user a
        // whats-new notification.
        OPTIONS.local.last_notified_version =
            (await browser.management.getSelf()).version;
    }



    // Next, setup the garbage collector -- we collect empty, unnamed folders in
    // the stash, as well as hidden tabs that are pointing to URLs that are
    // removed from the stash.  This is driven by browser bookmark events.
    let t = await tabStashTree();
    let managed_urls = new Set(urlsInTree(t));
    const close_removed_bookmarks = nonReentrant(async function() {
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
        for (let url of managed_urls) {
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

        managed_urls = new_urls;
    });

    browser.bookmarks.onRemoved.addListener(close_removed_bookmarks);
    browser.bookmarks.onChanged.addListener(close_removed_bookmarks);
    browser.bookmarks.onMoved.addListener(close_removed_bookmarks);



    // This periodic background job will discard hidden tabs if they are not
    // re-activated within a reasonable period of time.  Since under normal
    // usage, we can accumulate a LOT of hidden tabs if the user leaves their
    // browser open for a while, this is mostly a light-touch, precautionary
    // measure to keep the user's memory usage from becoming surprisingly high
    // over time.
    //
    // We could immediately discard a tab when stashing/hiding it, but this
    // causes performance problems if the user wants to temporarily stash a
    // bunch of tabs for a short period of time (e.g. if they are interrupted at
    // their desk by, "Can you just check on this thing for me really quick?").
    //
    // We try to be relatively intelligent about the age (defined as "time since
    // last access") of hidden tabs, to account for the fact that there will be
    // periods of higher and lower activity (where more or fewer hidden tabs
    // might be generated).  We do this by setting a target tab count and age,
    // and scaling the age boundary according to the number of loaded tabs.  The
    // target count/age are used as a reference point--when the target number of
    // tabs are open, we want to discard tabs older than the target age (in this
    // case, 50 tabs and 10 minutes).  If there are MORE than the target number
    // of tabs open, the age will scale asymptotically towards 0.  If there are
    // FEWER than the target number of tabs open, we are more lax on the age,
    // and we will always keep a certain minimum number of tabs open (for which
    // the age is effectively infinite).
    //
    // Note that active (non-hidden) tabs are counted towards the total, so if
    // the user has a lot of tabs open, we will discard hidden tabs more
    // aggressively to stay within reasonable memory limits.

    const discard_old_hidden_tabs = nonReentrant(async function() {
        // We setTimeout() first because the enable/disable flag could change at
        // runtime.
        setTimeout(discard_old_hidden_tabs,
                   OPTIONS.local.autodiscard_interval_min *60*1000);

        if (! OPTIONS.local.autodiscard_hidden_tabs) return;

        let now = Date.now();
        let tabs = await browser.tabs.query({discarded: false});
        let tab_count = tabs.length;
        let candidate_tabs = tabs.filter(t => t.hidden)
            .sort((a, b) => a.lastAccessed - b.lastAccessed);

        const min_keep_tabs = OPTIONS.local.autodiscard_min_keep_tabs;
        const target_tab_count = OPTIONS.local.autodiscard_target_tab_count;
        const target_age_ms = OPTIONS.local.autodiscard_target_age_min *60*1000;

        while (tab_count > min_keep_tabs) {
            // Keep discarding tabs until we have the minimum number of tabs
            // remaining, we run out of candidates, OR the age of the oldest tab
            // is less than the cutoff (as a function of the number of
            // non-discarded tabs).
            //
            // You'll have to graph /age_cutoff/ as a function of /tab_count/ to
            // (literally) see why this makes sense--it's basically a hyperbola
            // with the vertical asymptote at /MIN_KEEP_TABS/ and the horizontal
            // asymptote at 0.  I recommend https://www.desmos.com/calculator
            // for a good graphing calculator.
            let age_cutoff = (target_tab_count - min_keep_tabs) * target_age_ms
                / (tab_count - min_keep_tabs);

            let oldest_tab = candidate_tabs.pop();
            if (! oldest_tab) break;

            let age = now - oldest_tab.lastAccessed;
            if (age > age_cutoff) {
                --tab_count;
                await browser.tabs.discard([oldest_tab.id]);
            } else {
                break;
            }
        }
    });

    // We use setTimeout rather than setInterval here because the interval could
    // change at runtime if the corresponding option is changed.  This will
    // cause some drift but it's not a big deal--the interval doesn't need to be
    // exact.
    setTimeout(discard_old_hidden_tabs,
               OPTIONS.local.autodiscard_interval_min *60*1000);
})();

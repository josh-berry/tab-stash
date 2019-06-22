"use strict";

import {
    AsyncReturnTypeOf,
    asyncEvent, urlsInTree, urlToOpen, nonReentrant,
} from './util';
import {
    stashTabsInWindow, stashTabs, restoreTabs, tabStashTree,
    mostRecentUnnamedFolderId,
} from './stash';
import Options from './options-model';


//
// User-triggered commands thru menu items, etc.  IDs in the menu items
// correspond to field names in the commands object.
//

function menu(idprefix: string, contexts: browser.menus.ContextType[],
              def: string[][])
{
    for (let [id, title] of def) {
        if (id) {
            browser.menus.create({contexts, title, id: idprefix + id});
        } else {
            browser.menus.create({contexts, type: 'separator', enabled: false});
        }
    }
}

menu('1:', ['tab', 'page', 'tools_menu'], [
    ['show_tab', 'Show Stashed Tabs in a Tab'],
    ['show_sidebar', 'Show Stashed Tabs in Sidebar'],
    ['', ''],
    ['stash_all', 'Stash Tabs'],
    ['stash_one', 'Stash This Tab'],
    ['stash_one_newgroup', 'Stash This Tab to a New Group'],
    ['', ''],
    ['copy_all', 'Copy Tabs to Stash'],
    ['copy_one', 'Copy This Tab to Stash'],
    ['', ''],
    ['options', 'Options...'],
]);

// These should only have like 6 items each
menu('2:', ['browser_action'], [
    ['show_tab', 'Show Stashed Tabs in a Tab'],
    ['show_sidebar', 'Show Stashed Tabs in Sidebar'],
    ['', ''],
    ['stash_all', 'Stash Tabs'],
    ['copy_all', 'Copy Tabs to Stash'],
]);

menu('3:', ['page_action'], [
    ['show_tab', 'Show Stashed Tabs in a Tab'],
    ['show_sidebar', 'Show Stashed Tabs in Sidebar'],
    ['', ''],
    ['stash_one', 'Stash This Tab'],
    ['stash_one_newgroup', 'Stash This Tab to a New Group'],
    ['copy_one', 'Copy This Tab to Stash'],
]);

// show_stash_if_desired() shows either the Tab Stash sidebar, the Tab Stash
// tab, or nothing, depending on the `open_stash_in` synced setting.
//
// The extra layer of scoping is just to hide the SYNC_OPTIONS variable, for
// safety (since otherwise it would be a global).
const show_stash_if_desired = (() => {
    // Ugh, we have to load Options.sync() synchronously here (ha) so it's
    // synchronously accessible in show_stash_if_desired(), which absolutely
    // cannot yield to the browser because we will lose the user-event context
    // and not be able to open the sidebar, instead resulting in the dreaded
    // error: "sidebarAction.open may only be called from a user input handler".

    // Ugh, the "| undefined" is needed to work around a TypeScript limitation
    // related to uninitialized local variables -- see:
    // https://github.com/microsoft/TypeScript/issues/28013
    let SYNC_OPTIONS: AsyncReturnTypeOf<typeof Options.sync> | undefined;
    Options.sync().then(opts => {SYNC_OPTIONS = opts});

    // Actual implementation of show_stash_if_desired().
    return () => {
        // SYNC_OPTIONS should almost always be defined since we load it at
        // startup, but on the off chance the user gets to us before the promise
        // above returns (which is very very very unlikely), we'll just go with
        // the default behavior.
        switch (SYNC_OPTIONS && SYNC_OPTIONS.open_stash_in) {
            case 'none':
                break;

            case 'tab':
                restoreTabs([browser.extension.getURL('stash-list.html')], {})
                    .catch(console.log);
                break;

            case 'sidebar':
            default:
                browser.sidebarAction.open().catch(console.log);
                break;
        }
    };
})();


const commands: {[key: string]: (t: browser.tabs.Tab) => Promise<void>} = {
    // NOTE: Several of these commands open the sidebar.  We have to open the
    // sidebar before the first "await" call, otherwise we won't actually have
    // permission to do so per Firefox's API rules.

    show_sidebar: async function() {
        browser.sidebarAction.open().catch(console.log);
    },

    show_tab: async function() {
        await restoreTabs([browser.extension.getURL('stash-list.html')], {});
    },

    stash_all: async function(tab: browser.tabs.Tab) {
        show_stash_if_desired();
        await stashTabsInWindow(tab.windowId, {close: true});
    },

    stash_one: async function(tab: browser.tabs.Tab) {
        show_stash_if_desired();
        await stashTabs([tab], {
            folderId: await mostRecentUnnamedFolderId(),
            close: true,
        });
    },

    stash_one_newgroup: async function(tab: browser.tabs.Tab) {
        show_stash_if_desired();
        await stashTabs([tab], {close: true});
    },

    copy_all: async function(tab: browser.tabs.Tab) {
        show_stash_if_desired();
        await stashTabsInWindow(tab.windowId, {close: false});
    },

    copy_one: async function(tab: browser.tabs.Tab) {
        show_stash_if_desired();
        await stashTabs([tab], {
            folderId: await mostRecentUnnamedFolderId(),
            close: false,
        });
    },

    options: async function() {
        await browser.runtime.openOptionsPage();
    },
};



//
// Top-level/user facing event bindings, which mostly just call commands.
//

browser.menus.onClicked.addListener((info, tab) => {
    // #cast We only ever create menu items with string IDs
    const cmd = (<string>info.menuItemId).replace(/^[^:]*:/, '');
    console.assert(commands[cmd]);
    commands[cmd](tab).catch(console.log);
});

browser.browserAction.onClicked.addListener(asyncEvent(commands.stash_all));
browser.pageAction.onClicked.addListener(asyncEvent(commands.stash_one));



//
// Check for a fresh install and note which version we are, so we can notify the
// user when updates are installed.
//

(async () => {
    const localopts = await Options.local();

    if (localopts.last_notified_version === undefined) {
        // This looks like a fresh install, (or an upgrade from a version that
        // doesn't keep track of the last-notified version, in which case, we
        // just assume it's a fresh install).  Record our current version number
        // here so we can detect upgrades in the future and show the user a
        // whats-new notification.
        localopts.last_notified_version =
            (await browser.management.getSelf()).version;
    }

})().catch(console.log);



//
// Setup the hidden-tab garbage collector.  This GC is triggered by any bookmark
// event which could possibly change the set of URLs stored in the stash.
//
// We garbage-collect (close) hidden tabs with URLs that correspond to bookmarks
// which are removed from the stash.  Unfortunately, because Firefox doesn't
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
//

(async () => {
    let managed_urls = new Set(urlsInTree(await tabStashTree()));

    const close_removed_bookmarks = nonReentrant(async function() {
        let tree = await tabStashTree();

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
            // #undef We only asked for 'normal' windows, which have tabs
            for (let t of w.tabs!) {
                if (! t.hidden) continue;
                if (t.id === undefined) continue;
                if (! removed_urls.has(urlToOpen(t.url!))) continue;
                tids.push(t.id);
            }
        }

        await browser.tabs.remove(tids);

        managed_urls = new_urls;
    });

    browser.bookmarks.onRemoved.addListener(close_removed_bookmarks);
    browser.bookmarks.onChanged.addListener(close_removed_bookmarks);
    browser.bookmarks.onMoved.addListener(close_removed_bookmarks);

})().catch(console.log);



//
// Setup a background job to discard (unload, but keep open) hidden tabs that
// haven't been touched in a while.
//
// Since under normal usage, we can accumulate a LOT of hidden tabs if the user
// leaves their browser open for a while, this is mostly a light-touch,
// precautionary measure to keep the user's memory usage from becoming
// surprisingly high over time.
//
// We could immediately discard a tab when stashing/hiding it, but this causes
// performance problems if the user wants to temporarily stash a bunch of tabs
// for a short period of time (e.g. if they are interrupted at their desk by,
// "Can you just check on this thing for me really quick?").
//
// We try to be relatively intelligent about the age (defined as "time since
// last access") of hidden tabs, to account for the fact that there will be
// periods of higher and lower activity (where more or fewer hidden tabs might
// be generated).  We do this by setting a target tab count and age, and scaling
// the age boundary according to the number of loaded tabs.  The target
// count/age are used as a reference point--when the target number of tabs are
// open, we want to discard tabs older than the target age (in this case, 50
// tabs and 10 minutes).  If there are MORE than the target number of tabs open,
// the age will scale asymptotically towards 0.  If there are FEWER than the
// target number of tabs open, we are more lax on the age, and we will always
// keep a certain minimum number of tabs open (for which the age is effectively
// infinite).
//
// Note that active (non-hidden) tabs are counted towards the total, so if the
// user has a lot of tabs open, we will discard hidden tabs more aggressively to
// stay within reasonable memory limits.
//

(async () => {
    const localopts = await Options.local();

    const discard_old_hidden_tabs = nonReentrant(async function() {
        // We setTimeout() first because the enable/disable flag could change at
        // runtime.
        setTimeout(discard_old_hidden_tabs,
                   localopts.autodiscard_interval_min * 60 * 1000);

        if (! localopts.autodiscard_hidden_tabs) return;

        let now = Date.now();
        let tabs = await browser.tabs.query({discarded: false});
        let tab_count = tabs.length;
        let candidate_tabs = tabs.filter(t => t.hidden && t.id !== undefined)
            .sort((a, b) => a.lastAccessed - b.lastAccessed);

        const min_keep_tabs = localopts.autodiscard_min_keep_tabs;
        const target_tab_count = localopts.autodiscard_target_tab_count;
        const target_age_ms = localopts.autodiscard_target_age_min * 60 * 1000;

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
                // #undef We filter no-id tabs out of /candidate_tabs/ above
                await browser.tabs.discard([oldest_tab.id!]);
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
               localopts.autodiscard_interval_min * 60 * 1000);

})().catch(console.log);

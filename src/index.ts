// istanbul ignore file

import type {Menus} from "webextension-polyfill";
import browser from "webextension-polyfill";

import type {ShowWhatOpt, StashWhatOpt} from "./model/options";
import type {Tab, TabID, WindowID} from "./model/tabs";
import service_model from "./service-model";
import {asyncEvent, backingOff, nonReentrant, urlToOpen} from "./util";
import {logErrorsFrom} from "./util/oops";

logErrorsFrom(async () => {
  // BEGIN FILE-WIDE ASYNC BLOCK

  //
  // Migrations -- these are old DBs which are in the wrong format
  //

  indexedDB.deleteDatabase("cache:favicons");
  indexedDB.deleteDatabase("cache:bookmarks");

  //
  // Start our various services and set global variables used throughout the rest
  // of this file.
  //

  const model = await service_model();
  (<any>globalThis).model = model;

  //
  // User-triggered commands thru menu items, etc.  IDs in the menu items
  // correspond to field names in the commands object.
  //

  function menu(
    idprefix: string,
    contexts: Menus.ContextType[],
    def: string[][],
  ) {
    // Only create menus in contexts this browser understands.
    const allowed_ctxs = Object.values((<any>browser.contextMenus).ContextType);
    contexts = contexts.filter(x => allowed_ctxs.includes(x));

    for (let [id, title] of def) {
      if (id) {
        browser.contextMenus.create({contexts, title, id: idprefix + id});
      } else {
        browser.contextMenus.create({
          contexts,
          type: "separator",
          enabled: false,
        });
      }
    }
  }

  const SHOW_TAB_NAME = browser.sidebarAction
    ? "Show Stashed Tabs in a Tab"
    : "Show Stashed Tabs";

  menu(
    "1:",
    ["tab", "page", "tools_menu"],
    [
      ["show_tab", SHOW_TAB_NAME],
      ...(browser.sidebarAction
        ? [["show_sidebar_or_tab", "Show Stashed Tabs in Sidebar"]]
        : []),
      ["", ""],
      ["stash_all", "Stash Tabs"],
      ["stash_one", "Stash This Tab"],
      ["stash_one_newgroup", "Stash This Tab to a New Group"],
      ["", ""],
      ["copy_all", "Copy Tabs to Stash"],
      ["copy_one", "Copy This Tab to Stash"],
      ["", ""],
      ["options", "Options..."],
    ],
  );

  // These should only have like 6 items each
  menu(
    "2:",
    ["browser_action"],
    [
      ["show_tab", SHOW_TAB_NAME],
      ...(browser.sidebarAction
        ? [["show_sidebar_or_tab", "Show Stashed Tabs in Sidebar"]]
        : []),
      ["", ""],
      ["stash_all", "Stash Tabs"],
      ["copy_all", "Copy Tabs to Stash"],
    ],
  );

  menu(
    "3:",
    ["page_action"],
    [
      ["show_tab", SHOW_TAB_NAME],
      ...(browser.sidebarAction
        ? [["show_sidebar_or_tab", "Show Stashed Tabs in Sidebar"]]
        : []),
      ["", ""],
      ["stash_one", "Stash This Tab"],
      ["stash_one_newgroup", "Stash This Tab to a New Group"],
      ["copy_one", "Copy This Tab to Stash"],
    ],
  );

  const commands: {[key: string]: (t?: Tab) => Promise<void>} = {
    // NOTE: Several of these commands open the sidebar.  We have to open the
    // sidebar before the first "await" call, otherwise we won't actually have
    // permission to do so per Firefox's API rules.
    //
    // Also note that some browsers don't support the sidebar at all; in these
    // cases, we open the tab instead.

    show_sidebar_or_tab: () =>
      browser.sidebarAction
        ? browser.sidebarAction.open().catch(console.log)
        : commands.show_tab(),

    async show_popup() {
      // Ugh, this hack where we set and then clear the popup is necessary
      // because if the (Chrome) browser thinks ANY popup is set, either
      // programmatically or thru manifest.json, it will just show the popup
      // rather than running the browserAction.onClicked callback (which might
      // do other things besides setting the popup).
      try {
        await browser.browserAction.setPopup({
          popup: "stash-list.html?view=popup",
        });
        await browser.browserAction.openPopup();
      } finally {
        await browser.browserAction.setPopup({popup: ""});
      }
    },

    async show_tab() {
      await model.restoreTabs(
        [
          {
            title: "Tab Stash",
            url: browser.runtime.getURL("stash-list.html"),
          },
        ],
        {},
      );
    },

    async stash_all(tab?: Tab) {
      show_something(model.options.sync.state.open_stash_in);
      await stash_something({what: "all", copy: false, tab});
    },

    async stash_one(tab?: Tab) {
      show_something(model.options.sync.state.open_stash_in);
      await stash_something({what: "single", copy: false, tab});
    },

    async stash_one_newgroup(tab?: Tab) {
      show_something(model.options.sync.state.open_stash_in);
      if (!tab) return;
      await model.putItemsInFolder({
        items: [tab],
        toFolderId: (await model.bookmarks.createStashFolder()).id,
      });
    },

    async copy_all(tab?: Tab) {
      show_something(model.options.sync.state.open_stash_in);
      await stash_something({what: "all", copy: true, tab});
    },

    async copy_one(tab?: Tab) {
      show_something(model.options.sync.state.open_stash_in);
      await stash_something({what: "single", copy: true, tab});
    },

    async options() {
      await browser.runtime.openOptionsPage();
    },
  };

  // Shows the Tab Stash UI in the manner requested by /show_what/.  NOTE that to
  // be able to open the sidebar, this function must be invoked in a
  // user-initiated event handler context BEFORE any async operations are done.
  function show_something(show_what: ShowWhatOpt) {
    switch (show_what) {
      case "none":
        break;

      case "tab":
        model.attempt(commands.show_tab);
        break;

      case "popup":
        model.attempt(commands.show_popup);

      case "sidebar":
      default:
        model.attempt(commands.show_sidebar_or_tab);
        break;
    }
  }

  async function stash_something(options: {
    what: StashWhatOpt;
    copy?: boolean;
    tab?: Tab;
  }) {
    if (!options.tab || options.tab.position === undefined) return;

    switch (options.what) {
      case "all":
        await model.stashAllTabsInWindow(
          options.tab.position.parent.id as WindowID,
          {copy: !!options.copy},
        );
        break;

      case "single":
        await model.putItemsInFolder({
          items: model.copyIf(!!options.copy, [options.tab]),
          toFolderId: (await model.ensureRecentUnnamedFolder()).id,
        });
        break;

      case "none":
      default:
        break;
    }
  }

  //
  // Top-level/user facing event bindings, which mostly just call commands.
  //

  browser.contextMenus.onClicked.addListener((info, tab) => {
    // #cast We only ever create menu items with string IDs
    const cmd = (<string>info.menuItemId).replace(/^[^:]*:/, "");
    console.assert(!!commands[cmd]);
    const t = tab?.id ? model.tabs.tab(tab?.id) : undefined;
    commands[cmd](t).catch(console.log);
  });

  if (browser.browserAction) {
    // In order for show_something('popup') to work, we must preconfigure the
    // browser to know which popup to show.  This cannot be done at the time of
    // show_something() because doing so requires an async call, and Firefox
    // doesn't allow us to then show the popup after the async call
    // returns--because we're no longer in a user event context.
    function setupPopup() {
      model.attempt(async () => {
        if (model.options.sync.state.browser_action_show === "popup") {
          // As soon as we configure a popup, the onClicked handler below
          // will no longer run (the popup will be shown instead).  This
          // unfortunately means that we can't stash and show the popup at
          // the same time.  Sigh.
          await browser.browserAction.setPopup({
            popup: "stash-list.html?view=popup",
          });
        } else {
          // If the user turns off the popup, we must clear the popup in
          // the browser if we expect anything else to work.
          await browser.browserAction.setPopup({popup: ""});
        }
      });
    }
    setupPopup();
    model.options.sync.onChanged.addListener(setupPopup);

    browser.browserAction.onClicked.addListener(
      asyncEvent(async tab => {
        const opts = model.options.sync.state;
        // Special case so the user doesn't think Tab Stash is broken
        if (
          opts.browser_action_show === "none" &&
          opts.browser_action_stash === "none"
        ) {
          await browser.runtime.openOptionsPage();
          return;
        }
        show_something(opts.browser_action_show);
        await stash_something({what: opts.browser_action_stash, tab});
      }),
    );
  }

  if (browser.pageAction) {
    browser.pageAction.onClicked.addListener(
      asyncEvent(async tab => {
        commands.stash_one(model.tabs.tab(tab.id));
      }),
    );
  }

  //
  // Check for a fresh install and note which version we are, so we can notify the
  // user when updates are installed.
  //

  if (model.options.local.state.last_notified_version === undefined) {
    // This looks like a fresh install, (or an upgrade from a version that
    // doesn't keep track of the last-notified version, in which case, we
    // just assume it's a fresh install).  Record our current version number
    // here so we can detect upgrades in the future and show the user a
    // whats-new notification.
    model.attempt(async () =>
      model.options.local.set({
        last_notified_version: (await browser.management.getSelf()).version,
      }),
    );
  }

  // Check which options are selected for the browser and page actions, and change
  // their icons accordingly.
  model.options.sync.onChanged.addListener(opts =>
    model.attempt(async () => {
      function getTitle(stash: StashWhatOpt): string {
        switch (stash) {
          case "all":
            return "Stash all (or selected) tabs";
          case "single":
            return "Stash this tab";
          case "none":
          default:
            return "Show stashed tabs";
        }
      }

      if (browser.browserAction) {
        await browser.browserAction.setTitle({
          title: getTitle(opts.state.browser_action_stash),
        });
      }
    }),
  );

  //
  // Setup GC events to close hidden tabs which are removed from the stash.  This
  // GC is triggered by any bookmark event which could possibly change the set of
  // URLs stored in the stash.
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

  logErrorsFrom(async () => {
    let managed_urls = model.bookmarks.urlsInStash();

    const close_removed_bookmarks = backingOff(() =>
      model.attempt(async () => {
        // Garbage-collect hidden tabs by diffing the old and new sets of URLs
        // in the tree.
        const new_urls = model.bookmarks.urlsInStash();
        let windows = await browser.windows.getAll({
          windowTypes: ["normal"],
          populate: true,
        });

        // Ugh, why am I open-coding a set-difference operation?  This
        // should be built-in!
        let removed_urls = new Set();
        for (let url of managed_urls) {
          if (!new_urls.has(url)) removed_urls.add(url);
        }

        let tids = [];
        for (let w of windows) {
          // #undef We only asked for 'normal' windows, which have tabs
          for (let t of w.tabs!) {
            if (!t.hidden) continue;
            if (t.id === undefined) continue;
            if (!removed_urls.has(urlToOpen(t.url!))) continue;
            tids.push(t.id as TabID);
          }
        }

        await model.tabs.remove(tids);

        managed_urls = new_urls;
      }),
    );

    browser.bookmarks.onChanged.addListener(close_removed_bookmarks);
    browser.bookmarks.onMoved.addListener(close_removed_bookmarks);
    browser.bookmarks.onRemoved.addListener(close_removed_bookmarks);
  });

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

  const discard_old_hidden_tabs = nonReentrant(async function () {
    // We setTimeout() first because the enable/disable flag could change at
    // runtime.
    setTimeout(
      discard_old_hidden_tabs,
      model.options.local.state.autodiscard_interval_min * 60 * 1000,
    );

    if (!model.options.local.state.autodiscard_hidden_tabs) return;

    let now = Date.now();
    let tabs = await browser.tabs.query({discarded: false});
    let tab_count = tabs.length;
    let candidate_tabs = tabs
      .filter(t => t.hidden && t.id !== undefined)
      .sort((a, b) => (a.lastAccessed ?? 0) - (b.lastAccessed ?? 0));

    const min_keep_tabs = model.options.local.state.autodiscard_min_keep_tabs;
    const target_tab_count =
      model.options.local.state.autodiscard_target_tab_count;
    const target_age_ms =
      model.options.local.state.autodiscard_target_age_min * 60 * 1000;

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
      let age_cutoff =
        ((target_tab_count - min_keep_tabs) * target_age_ms) /
        (tab_count - min_keep_tabs);

      let oldest_tab = candidate_tabs.pop();
      if (!oldest_tab) break;

      const age = now - (oldest_tab.lastAccessed ?? 0);
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
  setTimeout(
    discard_old_hidden_tabs,
    model.options.local.state.autodiscard_interval_min * 60 * 1000,
  );

  //
  // Setup a periodic background job to cleanup various deleted items and caches.
  // Needed to prevent Tab Stash from consuming an unbounded amount of the user's
  // local storage.
  //

  const gc = nonReentrant(() =>
    model.attempt(async () => {
      // Hard-coded to a day for now, for people who don't restart their browsers
      // regularly.  If this ever needs to be changed, we can always add an option
      // for it later.
      setTimeout(gc, 24 * 60 * 60 * 1000);

      await model.gc();
    }),
  );

  // Here we call gc() on browser restart to ensure it happens
  // at least once.
  gc();
}); // END FILE-WIDE ASYNC BLOCK

/* c8 ignore start -- main entry point for the background page */

import type {Alarms, Menus, Tabs as BT} from "webextension-polyfill";
import browser from "webextension-polyfill";

import type {Model} from "./model/index.js";
import {copyIf} from "./model/index.js";
import type {ShowWhatOpt, StashWhatOpt} from "./model/options.js";
import type {Tab} from "./model/tabs.js";
import service_model from "./service-model.js";
import {backingOff, filterMap, nonReentrant, urlToOpen} from "./util/index.js";
import {registry} from "./util/nanoservice/index.js";
import {logErrorsFrom} from "./util/oops.js";

//
// Synchronous top-level section.
//
// When running as a MV3 service worker (i.e. on Chrome), we may be started at
// any time in response to an event--and that event is only delivered if its
// listener was registered synchronously during the first turn of the event
// loop.  So all browser event listeners are registered here, before any async
// initialization is done; their handlers wait for initialization to complete
// (see dispatch() below).
//
// On Firefox, the background page is persistent, so this distinction mostly
// doesn't matter--but the same registration order is used on both browsers so
// there is only one code path.
//

const MV3 = browser.runtime.getManifest().manifest_version >= 3;

// In an MV3 service worker, we may have been woken up BY an incoming
// connection from a UI page; start accepting (and parking) connections
// immediately, before the model and its services are ready.
if (MV3) registry.listenEagerly();

// MV3 has `action`; MV2 has `browserAction`.  The polyfill does not alias one
// to the other, so we must look for both.
const action = browser.action ?? browser.browserAction;

/** Everything the top-level event handlers need, available once async
 * initialization (init(), below) is complete. */
type InitState = {
  model: Model;
  commands: {[key: string]: (t?: Tab) => Promise<void>};
  onMenuClicked(info: Menus.OnClickData, tab?: BT.Tab): Promise<void>;
  onActionClicked(tab: BT.Tab): Promise<void>;
  onPageActionClicked(tab: BT.Tab): Promise<void>;
  closeRemovedBookmarks(): Promise<void>;
  gc(): Promise<void>;
};

let ready: InitState | undefined;

const initP = logErrorsFrom(init).then(s => (ready = s));

/** Runs an event handler with the init state, synchronously if initialization
 * has already finished.
 *
 * The synchronous path matters on Firefox: opening the sidebar is only
 * allowed while in the direct call stack of a user-input handler, so we
 * cannot await anything first.  (The handlers themselves are careful to do
 * anything gesture-sensitive before their first await.)
 *
 * On a cold service-worker start (MV3), we have no choice but to wait for
 * initialization; Chrome has no sidebar, and show_popup() falls back to
 * opening a tab if the popup can't be shown anymore. */
function dispatch<A extends unknown[]>(
  fn: (state: InitState, ...args: A) => void | Promise<void>,
): (...args: A) => void {
  return (...args) => {
    if (ready) {
      const s = ready;
      logErrorsFrom(async () => fn(s, ...args)).catch(() => {});
    } else {
      initP
        .then(s => logErrorsFrom(async () => fn(s, ...args)))
        .catch(console.log);
    }
  };
}

//
// Top-level/user facing event bindings, which mostly just call commands.
//

browser.contextMenus.onClicked.addListener(
  dispatch((s, info: Menus.OnClickData, tab?: BT.Tab) =>
    s.onMenuClicked(info, tab),
  ),
);

if (action) {
  action.onClicked.addListener(
    dispatch((s, tab?: BT.Tab) => s.onActionClicked(tab!)),
  );
}

if (browser.pageAction) {
  browser.pageAction.onClicked.addListener(
    dispatch((s, tab: BT.Tab) => s.onPageActionClicked(tab)),
  );
}

// GC events to close hidden tabs which are removed from the stash; see
// closeRemovedBookmarks() in init() below.
browser.bookmarks.onChanged.addListener(
  dispatch(s => s.closeRemovedBookmarks()),
);
browser.bookmarks.onMoved.addListener(dispatch(s => s.closeRemovedBookmarks()));
browser.bookmarks.onRemoved.addListener(
  dispatch(s => s.closeRemovedBookmarks()),
);

// On MV3, periodic jobs use alarms, since setTimeout() does not survive
// service-worker suspension.  (browser.alarms is undefined on Firefox, where
// the manifest does not request the "alarms" permission.)
if (browser.alarms) {
  browser.alarms.onAlarm.addListener(
    dispatch((s, alarm: Alarms.Alarm) => {
      if (alarm.name === "gc") return s.gc();
    }),
  );
}

//
// Asynchronous initialization--sets up the model, menus, and all the actual
// behavior behind the event handlers above.
//

async function init(): Promise<InitState> {
  const model = await service_model();
  (<any>globalThis).model = model;

  //
  // Migrations
  //

  // Delete old DBs that are in the wrong format
  indexedDB.deleteDatabase("cache:favicons");
  indexedDB.deleteDatabase("cache:bookmarks");

  // Tag hidden tabs which were hidden before upgrading to a version of Tab
  // Stash that keeps track of which tabs it was responsible for hiding.
  if (!model.options.local.state.migrated_tab_markers_applied) {
    logErrorsFrom(async () => {
      if (!!browser.tabs.hide && model.bookmarks.stash_root.value) {
        const tabs = await browser.tabs.query({hidden: true});

        await model.bookmarks.loadedStash();

        const stashed_hidden_tabs = tabs.filter(t =>
          model.bookmarks.isURLLoadedInStash(t.url!),
        );

        // This applies the tag as a side effect
        await model.tabs.hide(
          filterMap(stashed_hidden_tabs, t => model.tabs.tab(t.id!)),
        );
      }

      await model.options.local.set({migrated_tab_markers_applied: true});
    });
  }

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
    const allowed_ctxs = Object.values(
      (<any>browser.contextMenus).ContextType ||
        // ORION: contextMenus.ContextType is not provided so we have to guess
        // which menus are supported. This is a subset of all known types that
        // Tab Stash might use.
        [
          "browser_action",
          "page",
          "link",
          "image",
          "editable",
          "frame",
          "selection",
        ],
    );
    contexts = contexts.filter(x => allowed_ctxs.includes(x));

    // If this browser supports none of the requested contexts (e.g. Chrome
    // has no page_action), there is no menu to create--and create() throws
    // if given an empty contexts list.
    if (contexts.length === 0) return;

    let separators = 0;
    for (let [id, title] of def) {
      if (id) {
        browser.contextMenus.create({contexts, title, id: idprefix + id});
      } else {
        // MV3 service workers require an explicit ID on every menu item,
        // even separators.  (onMenuClicked never sees these--separators
        // aren't clickable.)
        browser.contextMenus.create({
          contexts,
          type: "separator",
          enabled: false,
          id: `${idprefix}separator#${++separators}`,
        });
      }
    }
  }

  const SHOW_TAB_NAME = browser.sidebarAction
    ? "Show Stashed Tabs in a Tab"
    : "Show Stashed Tabs";

  // On MV3, this whole file is re-run whenever the service worker is
  // restarted, but the menus it created previously are still registered with
  // the browser--so we must clear them before re-creating them, or creation
  // fails with duplicate-ID errors.
  await browser.contextMenus.removeAll();

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
    // MV3 renamed the "browser_action" context to "action".
    [MV3 ? "action" : "browser_action"],
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
        await action!.setPopup({
          popup: "stash-list.html?view=popup",
        });
        await action!.openPopup();
      } catch (e) {
        // On a cold MV3 service-worker start, openPopup() can fail because
        // the user gesture expired while we were initializing; show a tab
        // instead so the user's click still does something.
        await commands.show_tab();
      } finally {
        await action!.setPopup({popup: ""});
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
        toFolder: await model.createStashFolder(),
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
  function show_something(show_what?: ShowWhatOpt) {
    switch (show_what) {
      case "none":
        break;

      case "tab":
        model.attempt(commands.show_tab);
        break;

      case "popup":
        model.attempt(commands.show_popup);

      case "sidebar":
        model.attempt(commands.show_sidebar_or_tab);
        break;

      default:
        show_setup_page();
        break;
    }
  }

  async function stash_something(options: {
    what?: StashWhatOpt;
    copy?: boolean;
    tab?: Tab;
  }) {
    if (!options.tab || options.tab.position === undefined) return;

    switch (options.what) {
      case "all":
        await model.stashAllTabsInWindow(options.tab.position.parent, {
          copy: !!options.copy,
        });
        break;

      case "single":
        await model.putItemsInFolder({
          items: copyIf(!!options.copy, [options.tab]),
          toFolder: await model.ensureDefaultStashDestFolder(),
        });
        break;

      case "none":
      default:
        break;
    }
  }

  function show_setup_page() {
    model.attempt(() =>
      model.restoreTabs(
        [
          {
            title: "Tab Stash - Setup",
            url: browser.runtime.getURL("setup.html"),
          },
        ],
        {},
      ),
    );
  }

  //
  // Behavior behind the top-level event handlers.
  //

  async function onMenuClicked(info: Menus.OnClickData, tab?: BT.Tab) {
    // #cast We only ever create menu items with string IDs
    const cmd = (<string>info.menuItemId).replace(/^[^:]*:/, "");
    console.assert(!!commands[cmd]);
    const t = tab?.id ? model.tabs.tab(tab.id) : undefined;
    await commands[cmd](t);
  }

  async function onActionClicked(tab: BT.Tab) {
    const opts = model.options.sync.state;
    // Special case so the user doesn't think Tab Stash is broken
    if (!opts.browser_action_show || !opts.browser_action_stash) {
      show_setup_page();
      return;
    }
    show_something(opts.browser_action_show);
    await stash_something({
      what: opts.browser_action_stash,
      tab: model.tabs.tab(tab.id!)!,
    });
  }

  async function onPageActionClicked(tab: BT.Tab) {
    if (!model.options.sync.state.open_stash_in) {
      // User hasn't decided what this button should do yet
      show_setup_page();
      return;
    }
    await commands.stash_one(model.tabs.tab(tab.id!));
  }

  if (action) {
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
          await action!.setPopup({
            popup: "stash-list.html?view=popup",
          });
        } else {
          // If the user turns off the popup, we must clear the popup in
          // the browser if we expect anything else to work.
          await action!.setPopup({popup: ""});
        }
      });
    }
    setupPopup();
    model.options.sync.onChanged.addListener(setupPopup);
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
      function getTitle(stash?: StashWhatOpt): string {
        switch (stash) {
          case "all":
            return "Stash all (or selected) tabs";
          case "single":
            return "Stash this tab";
          case "none":
            return "Show stashed tabs";
          default:
            return "Set up Tab Stash";
        }
      }

      if (action) {
        await action.setTitle({
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

  let managed_urls = await model.bookmarks.urlsInStash();

  const closeRemovedBookmarks = backingOff(() =>
    model.attempt(async () => {
      // Garbage-collect hidden tabs by diffing the old and new sets of URLs
      // in the tree.
      const new_urls = await model.bookmarks.urlsInStash();

      // Ugh, why am I open-coding a set-difference operation?  This
      // should be built-in!
      let removed_urls = new Set();
      for (let url of managed_urls) {
        if (!new_urls.has(url)) removed_urls.add(url);
      }

      await model.tabs.remove(
        model.tabs
          .allTabs()
          .filter(t => t.hidden && removed_urls.has(urlToOpen(t.url))),
      );

      managed_urls = new_urls;
    }),
  );

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
      .filter(t => !t.audible || t.mutedInfo?.muted)
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
  //
  // This job only does anything on browsers with tab-hiding (i.e. Firefox),
  // where the background page is persistent, so it's fine to use setTimeout()
  // here--there is nothing to discard on other browsers.
  if (!!browser.tabs.hide) {
    setTimeout(
      discard_old_hidden_tabs,
      model.options.local.state.autodiscard_interval_min * 60 * 1000,
    );
  }

  //
  // Setup a periodic background job to cleanup various deleted items and caches.
  // Needed to prevent Tab Stash from consuming an unbounded amount of the user's
  // local storage.
  //
  // Hard-coded to a day for now, for people who don't restart their browsers
  // regularly.  If this ever needs to be changed, we can always add an option
  // for it later.
  //

  const gc = nonReentrant(() =>
    model.attempt(async () => {
      // On MV3, scheduling is done with an alarm (created below), which
      // survives service-worker suspension; setTimeout() does not.
      if (!MV3) setTimeout(gc, 24 * 60 * 60 * 1000);

      await model.gc();
    }),
  );

  if (browser.alarms) {
    // Only create the alarm if it doesn't already exist, so that
    // service-worker restarts don't keep pushing the next GC further out.
    const gc_alarm = await browser.alarms.get("gc");
    if (!gc_alarm) {
      browser.alarms.create("gc", {
        delayInMinutes: 1,
        periodInMinutes: 24 * 60,
      });
    }
  } else {
    // Here we call gc() on browser restart to ensure it happens at least
    // once.
    gc();
  }

  return {
    model,
    commands,
    onMenuClicked,
    onActionClicked,
    onPageActionClicked,
    closeRemovedBookmarks,
    gc,
  };
}

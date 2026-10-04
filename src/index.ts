/* c8 ignore start -- main entry point for the background service worker */

import "./util/chrome-compat.js";

import type {Menus} from "webextension-polyfill";
import browser from "webextension-polyfill";

import type {Model} from "./model/index.js";
import {copyIf} from "./model/index.js";
import type {ShowWhatOpt, StashWhatOpt} from "./model/options.js";
import type {Tab} from "./model/tabs.js";
import service_model from "./service-model.js";
import {
  backingOff,
  filterMap,
  nonReentrant,
  urlToOpen,
  $t,
} from "./util/index.js";
import {registry} from "./util/nanoservice/index.js";
import {logErrorsFrom} from "./util/oops.js";

// Register the onConnect listener synchronously so UI contexts (side panel,
// popup, tab) can connect to the background's services as soon as the service
// worker starts--MV3 may wake the worker precisely to deliver such a
// connection.
registry.start();

// The model loads asynchronously (it reads bookmarks/tabs and opens IndexedDB
// databases).  We create the promise at module-load time and register all event
// listeners synchronously, dispatching to this promise.  This is required for
// MV3 service workers: Chrome may wake the worker up for any of these events,
// and the listeners must already be registered when the event is dispatched.
const modelReady: Promise<Model> = service_model();

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

function menu(
  idprefix: string,
  contexts: Menus.ContextType[],
  def: string[][],
) {
  // Only create menus in contexts this browser understands.
  const allowed_ctxs = Object.values(
    (<any>browser.contextMenus).ContextType || [
      "action",
      "page",
      "link",
      "image",
      "editable",
      "frame",
      "selection",
    ],
  );
  contexts = contexts.filter(x => allowed_ctxs.includes(x));

  let sep_count = 0;
  for (let [id, title] of def) {
    if (id) {
      browser.contextMenus.create({contexts, title, id: idprefix + id});
    } else {
      // MV3 requires every context menu item (including separators) to have
      // an explicit id.
      browser.contextMenus.create({
        contexts,
        type: "separator",
        enabled: false,
        id: `${idprefix}sep${sep_count++}`,
      });
    }
  }
}

const has_side_ui = !!browser.sidebarAction || !!(browser as any).sidePanel;
const SHOW_TAB_NAME = has_side_ui
  ? $t("showStashedTabsInTabMenu")
  : $t("showStashedTabsMenu");
const SHOW_SIDE_NAME = $t("showStashedTabsInSidebarMenu");

menu(
  "1:",
  ["page"],
  [
    ["show_tab", SHOW_TAB_NAME],
    ...(has_side_ui ? [["show_side_panel", SHOW_SIDE_NAME]] : []),
    ["", ""],
    ["stash_all", $t("stashTabsMenu")],
    ["stash_pinned", $t("stashPinnedTabsMenu")],
    ["stash_one", $t("stashThisTabMenu")],
    ["stash_one_newgroup", $t("stashThisTabToNewGroupMenu")],
    ["", ""],
    ["copy_all", $t("copyTabsToStashMenu")],
    ["copy_one", $t("copyThisTabToStashMenu")],
    ["", ""],
    ["options", $t("optionsMenu")],
  ],
);

// These should only have like 6 items each
menu(
  "2:",
  ["action"],
  [
    ["show_tab", SHOW_TAB_NAME],
    ...(has_side_ui ? [["show_side_panel", SHOW_SIDE_NAME]] : []),
    ["", ""],
    ["stash_all", $t("stashTabsMenu")],
    ["stash_pinned", $t("stashPinnedTabsMenu")],
    ["copy_all", $t("copyTabsToStashMenu")],
  ],
);

// ---------------------------------------------------------------------------
// Command handlers (all of these need the model, so they are constructed once
// the model is available)
// ---------------------------------------------------------------------------

function makeCommands(model: Model) {
  const commands: {[key: string]: (t?: Tab) => Promise<void>} = {
    async show_side_panel() {
      const sidePanel = (browser as any).sidePanel;
      if (!sidePanel) {
        await commands.show_tab();
        return;
      }
      await open_side_panel();
    },

    async show_popup() {
      // Ugh, this hack where we set and then clear the popup is necessary
      // because if the (Chrome) browser thinks ANY popup is set, either
      // programmatically or thru manifest.json, it will just show the popup
      // rather than running the action.onClicked callback (which might do
      // other things besides setting the popup).
      try {
        await browser.action.setPopup({popup: "stash-list.html?view=popup"});
        await browser.action.openPopup();
      } finally {
        await browser.action.setPopup({popup: ""});
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

    async stash_pinned(tab?: Tab) {
      show_something(model.options.sync.state.open_stash_in);
      if (!tab || tab.flattenedPosition === undefined) return;
      const pinnedTabs = model.pinnedTabsInWindow(tab.flattenedPosition.parent);
      if (pinnedTabs.length === 0) return;
      await model.putItemsInFolder({
        items: pinnedTabs,
        toFolder: await model.createStashFolder(),
      });
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

  // Shows the Tab Stash UI in the manner requested by /show_what/.  NOTE that
  // to be able to open the side panel (or popup), this function must be invoked
  // in a user-initiated event handler context BEFORE any async operations are
  // done.
  function show_something(show_what?: ShowWhatOpt) {
    switch (show_what) {
      case "none":
        break;

      case "tab":
        model.attempt(commands.show_tab);
        break;

      case "popup":
        model.attempt(commands.show_popup);
        break;

      case "sidepanel":
        model.attempt(commands.show_side_panel);
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
    if (!options.tab || options.tab.flattenedPosition === undefined) return;

    switch (options.what) {
      case "all":
        await model.stashAllTabsInWindow(options.tab.flattenedPosition.parent, {
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
            title: $t("setupTabTitle"),
            url: browser.runtime.getURL("setup.html"),
          },
        ],
        {},
      ),
    );
  }

  return {commands, show_something, stash_something, show_setup_page};
}

// ---------------------------------------------------------------------------
// Side panel support
//
// Chrome requires `sidePanel.open()` to be called within a user gesture (e.g.
// a keyboard shortcut, context-menu click, or action click).  Waiting for the
// model (which loads asynchronously) before calling it would consume that
// gesture, so we track what we need synchronously:
//   - the most recently focused window id (for the keyboard shortcut), and
//   - the current "action button → show" preference (for the action click).
// ---------------------------------------------------------------------------

let focused_window_id: number | undefined;
let cached_action_show: ShowWhatOpt | undefined;
let cached_open_stash_in: ShowWhatOpt | undefined;

// Chrome requires `sidePanel.open()` to specify a windowId (or tabId), and to
// be called within a user gesture.  We therefore always resolve a window id
// before opening, never calling `sidePanel.open({})`.
async function open_side_panel(win_id?: number): Promise<void> {
  const sidePanel = (browser as any).sidePanel;
  if (!sidePanel) return;

  let windowId = win_id ?? focused_window_id;
  if (windowId === undefined) {
    try {
      windowId = (await browser.windows.getLastFocused({populate: false})).id;
    } catch (e) {
      console.log("open_side_panel: no focused window", e);
      return;
    }
  }

  await sidePanel.open({windowId}).catch(console.log);
}

// Chrome has no sidePanel.toggle() and no reliable way to ask whether the
// panel is currently open, so we implement toggling as: call open() (a no-op
// if the panel is already open, and it must be called synchronously to keep
// the user gesture), then message the panel to close itself if it is open.
// If the panel was closed, there is no receiver for the message and it is
// ignored, leaving the freshly-opened panel open.
function toggle_side_panel(win_id?: number): void {
  open_side_panel(win_id).catch(console.log);
  browser.runtime
    .sendMessage({type: "tab-stash:close-side-panel"})
    .catch(() => {});
}

browser.windows.onFocusChanged.addListener(win_id => {
  if (win_id !== browser.windows.WINDOW_ID_NONE) {
    focused_window_id = win_id;
  }
});

// Track the most recently focused window as early as possible (independent of
// the model), so the keyboard-shortcut handler below always has a window id to
// open the side panel in.
browser.windows
  .getLastFocused({populate: false})
  .then(w => {
    focused_window_id = w.id;
  })
  .catch(() => {});

// ---------------------------------------------------------------------------
// Event listeners (registered synchronously)
// ---------------------------------------------------------------------------

browser.contextMenus.onClicked.addListener((info, tab) => {
  // #cast We only ever create menu items with string IDs
  const cmd = (<string>info.menuItemId).replace(/^[^:]*:/, "");

  // Opening the side panel needs the user gesture, so handle it synchronously
  // (before any async model loading).
  if (cmd === "show_side_panel") {
    if ((browser as any).sidePanel) {
      open_side_panel(tab?.windowId).catch(console.log);
      return;
    }
  } else if (cached_open_stash_in === "sidepanel") {
    // A stash command whose "open stash in" preference is the side panel:
    // open the panel now to preserve the click gesture.
    open_side_panel(tab?.windowId).catch(console.log);
  }

  modelReady
    .then(model => {
      const {commands} = makeCommands(model);
      console.assert(!!commands[cmd]);
      const t = tab?.id ? model.tabs.tab(tab?.id) : undefined;
      return commands[cmd](t);
    })
    .catch(console.log);
});

browser.action.onClicked.addListener(tab => {
  // If the user has configured the action button to show the side panel, open
  // it now (synchronously, preserving the click gesture), then stash below.
  const show_panel = cached_action_show === "sidepanel";
  if (show_panel) {
    open_side_panel(tab.windowId).catch(console.log);
  }

  modelReady
    .then(async model => {
      const {show_something, stash_something, show_setup_page} =
        makeCommands(model);
      const opts = model.options.sync.state;
      // Special case so the user doesn't think Tab Stash is broken
      if (!opts.browser_action_show || !opts.browser_action_stash) {
        show_setup_page();
        return;
      }
      if (!(show_panel && opts.browser_action_show === "sidepanel")) {
        show_something(opts.browser_action_show);
      }
      await stash_something({
        what: opts.browser_action_stash,
        tab: model.tabs.tab(tab.id!)!,
      });
    })
    .catch(console.log);
});

browser.commands.onCommand.addListener(command => {
  if (command === "open-side-panel") {
    // Toggle: open the side panel if it's closed, close it if it's open.
    toggle_side_panel();
    return;
  }
});

// ---------------------------------------------------------------------------
// GC of hidden tabs whose bookmarks were removed from the stash.  This is only
// relevant in browsers that support tab hiding (Chrome never hides tabs), but
// the listeners are registered synchronously so we never miss an event.
// ---------------------------------------------------------------------------

let managed_urls: Set<string> | undefined;

const close_removed_bookmarks = backingOff(() =>
  modelReady
    .then(async model => {
      // Garbage-collect hidden tabs by diffing the old and new sets of URLs
      // in the tree.
      if (managed_urls === undefined) {
        managed_urls = await model.bookmarks.urlsInStash();
        return;
      }
      const new_urls = await model.bookmarks.urlsInStash();

      const removed_urls = new Set<string>();
      for (const url of managed_urls) {
        if (!new_urls.has(url)) removed_urls.add(url);
      }

      await model.tabs.remove(
        model.tabs
          .allTabs()
          .filter(t => t.hidden && removed_urls.has(urlToOpen(t.url))),
      );

      managed_urls = new_urls;
    })
    .catch(console.log),
);

browser.bookmarks.onChanged.addListener(close_removed_bookmarks);
browser.bookmarks.onMoved.addListener(close_removed_bookmarks);
browser.bookmarks.onRemoved.addListener(close_removed_bookmarks);

// ---------------------------------------------------------------------------
// Periodic background jobs (via chrome.alarms, since setTimeout is unreliable
// in a service worker which may be suspended at any time).
// ---------------------------------------------------------------------------

// The model is stored here once loaded, so the (parameterless) periodic-job
// handlers below can access it.
let bgModel: Model | undefined;

const discard_old_hidden_tabs = nonReentrant(async () => {
  if (!bgModel) return;
  if (!bgModel.options.local.state.autodiscard_hidden_tabs) return;

  const now = Date.now();
  const tabs = await browser.tabs.query({discarded: false});
  let tab_count = tabs.length;
  const candidate_tabs = tabs
    .filter(t => t.hidden && t.id !== undefined)
    .filter(t => !t.audible || t.mutedInfo?.muted)
    .sort((a, b) => (a.lastAccessed ?? 0) - (b.lastAccessed ?? 0));

  const min_keep_tabs = bgModel.options.local.state.autodiscard_min_keep_tabs;
  const target_tab_count =
    bgModel.options.local.state.autodiscard_target_tab_count;
  const target_age_ms =
    bgModel.options.local.state.autodiscard_target_age_min * 60 * 1000;

  while (tab_count > min_keep_tabs) {
    const age_cutoff =
      ((target_tab_count - min_keep_tabs) * target_age_ms) /
      (tab_count - min_keep_tabs);

    const oldest_tab = candidate_tabs.pop();
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

const run_gc = nonReentrant(async () => {
  if (!bgModel) return;
  await bgModel.gc();
});

function updateDiscardAlarm(interval_min: number) {
  const period = Math.max(1, Math.round(interval_min));
  return browser.alarms.create("discard-old-hidden-tabs", {
    periodInMinutes: period,
  });
}

browser.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "discard-old-hidden-tabs") {
    discard_old_hidden_tabs().catch(console.log);
  } else if (alarm.name === "gc") {
    run_gc().catch(console.log);
  }
});

// ---------------------------------------------------------------------------
// One-time initialization, run once the model has finished loading.
// ---------------------------------------------------------------------------

modelReady
  .then(async loaded => {
    const model: Model = loaded;
    bgModel = loaded;
    (<any>globalThis).model = model;

    //
    // Migrations
    //

    // Delete old DBs that are in the wrong format
    indexedDB.deleteDatabase("cache:favicons");
    indexedDB.deleteDatabase("cache:bookmarks");

    //
    // Initialize our synchronous caches (used by gesture-sensitive handlers).
    // (focused_window_id is already tracked at startup and via
    // onFocusChanged; here we just cache the option values.)
    //

    cached_action_show = model.options.sync.state.browser_action_show;
    cached_open_stash_in = model.options.sync.state.open_stash_in;
    model.options.sync.onChanged.addListener(opts => {
      cached_action_show = opts.state.browser_action_show;
      cached_open_stash_in = opts.state.open_stash_in;
    });

    // Tag hidden tabs which were hidden before upgrading to a version of Tab
    // Stash that keeps track of which tabs it was responsible for hiding.
    // (In browsers that support tab hiding; on Chrome browser.tabs.hide is
    // undefined and this just records the migration flag.)
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
    // Configure the action button (popup vs. onClicked handling).
    //

    function setupPopup() {
      model.attempt(async () => {
        if (model.options.sync.state.browser_action_show === "popup") {
          await browser.action.setPopup({popup: "stash-list.html?view=popup"});
        } else {
          await browser.action.setPopup({popup: ""});
        }
      });
    }
    setupPopup();
    model.options.sync.onChanged.addListener(setupPopup);

    // Check which options are selected for the action button, and change its
    // title accordingly.
    model.options.sync.onChanged.addListener(opts =>
      model.attempt(async () => {
        function getTitle(stash?: StashWhatOpt): string {
          switch (stash) {
            case "all":
              return $t("stashAllTabs");
            case "single":
              return $t("stashThisTab");
            case "none":
              return $t("showStashedTabsTooltip");
            default:
              return $t("setUpTabStashTooltip");
          }
        }

        await browser.action.setTitle({
          title: getTitle(opts.state.browser_action_stash),
        });
      }),
    );

    // Keep the discard alarm in sync with the (possibly changed) interval.
    await updateDiscardAlarm(
      model.options.local.state.autodiscard_interval_min,
    );
    model.options.local.onChanged.addListener(opts =>
      model.attempt(() =>
        updateDiscardAlarm(opts.state.autodiscard_interval_min),
      ),
    );

    //
    // Check for a fresh install and note which version we are, so we can notify
    // the user when updates are installed.
    //

    if (model.options.local.state.last_notified_version === undefined) {
      model.attempt(async () =>
        model.options.local.set({
          last_notified_version: browser.runtime.getManifest().version,
        }),
      );
    }

    //
    // Setup periodic background jobs (and run GC once at startup).
    //

    await browser.alarms.create("gc", {periodInMinutes: 24 * 60});
    run_gc().catch(console.log);
  })
  .catch(console.error);

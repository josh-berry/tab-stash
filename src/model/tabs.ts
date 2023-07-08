import {computed, reactive, ref, watch, type Ref} from "vue";
import type {Tabs, Windows} from "webextension-polyfill";
import browser from "webextension-polyfill";

import {
  AsyncTaskQueue,
  backingOff,
  expect,
  filterMap,
  shortPoll,
  tryAgain,
  urlToOpen,
  type OpenableURL,
} from "../util";
import {trace_fn} from "../util/debug";
import {logErrorsFrom} from "../util/oops";
import {EventWiring} from "../util/wiring";

import {setPosition, type TreeNode, type TreeParent} from "./tree";

export interface Window extends TreeParent<Window, Tab> {
  readonly id: WindowID;
  readonly position: undefined;
  readonly children: Tab[];
}

export interface Tab extends TreeNode<Window, Tab> {
  id: TabID;
  status: Tabs.TabStatus;
  title: string;
  url: string;
  favIconUrl: string;
  cookieStoreId: string | undefined;
  pinned: boolean;
  hidden: boolean;
  active: boolean;
  highlighted: boolean;
  discarded: boolean;
}

export type WindowID = number & {readonly __window_id: unique symbol};
export type TabID = number & {readonly __tab_id: unique symbol};

const trace = trace_fn("tabs");

/** How many tabs do we want to allow to be loaded at once?  (NOTE: This is
 * approximate, since the model may not be fully up to date, and the user can
 * always trigger tab loading on their own.) */
const MAX_LOADING_TABS = navigator.hardwareConcurrency ?? 4;

/** A Vue model for the state of all open browser windows and their tabs.
 *
 * This model basically follows the WebExtension API, but some things are
 * tweaked from the WebExtension types to deal with the fact that we're
 * maintaining a persistent, JSON-serializable data structure and not simply
 * passing tab info around transiently.
 *
 * We avoid any classes or circular references in the data itself so it is
 * JSON-serializable (for transmission between contexts).
 */
export class Model {
  private readonly windows = new Map<WindowID, Window>();
  private readonly tabs = new Map<TabID, Tab>();
  private readonly tabs_by_url = new Map<OpenableURL, Set<Tab>>();

  /** The initial window that this model was opened with (if it still exists). */
  readonly initialWindow: Ref<Window | WindowID | undefined> = ref();

  /** The window that currently has the focus (if any). */
  readonly focusedWindow: Ref<Window | WindowID | undefined> = ref();

  /** The "target" window that this model should be for.  Controls for things
   * like which window is shown in the UI, tab selection, etc.  This isn't
   * precisely the same as `focusedWindow`, because it accounts for the fact
   * that the user could tear off the Tab Stash tab into a new window, and yet
   * still want to manage the window that the tab was originally opened in. */
  readonly targetWindow = computed(() => {
    if (typeof this.initialWindow.value === "object") {
      return this.initialWindow.value;
    }
    if (typeof this.focusedWindow.value === "object") {
      return this.focusedWindow.value;
    }
    return undefined;
  });

  /** The number of tabs being loaded. */
  readonly loadingCount = ref(0);

  /** A queue of tabs to load.  We only want to allow so many tabs to load at
   * once (to avoid overwhelming the user's machine), so every single call that
   * could cause a tab to be loaded must go through here. */
  private _loading_queue = new AsyncTaskQueue();

  /** Did we receive an event since the last (re)load of the model? */
  private _event_since_load: boolean = false;

  //
  // Loading data and wiring up events
  //

  /** Construct a model by loading tabs from the browser.  The model will keep
   * itself updated by listening to browser events. */
  static async from_browser(bg?: "background"): Promise<Model> {
    const win = bg ? undefined : await browser.windows.getCurrent();

    const model = new Model(win?.id as WindowID | undefined);
    await model.reload();
    return model;
  }

  private constructor(initial_window?: WindowID) {
    this.initialWindow.value = initial_window;

    trace("Wiring events");
    const wiring = new EventWiring(this, {
      onFired: () => {
        this._event_since_load = true;
      },
      // istanbul ignore next -- safety net; reload the model in the event
      // of an unexpected exception.
      onError: () => {
        logErrorsFrom(() => this.reload());
      },
    });

    wiring.listen(browser.windows.onCreated, this.whenWindowCreated);
    wiring.listen(browser.windows.onFocusChanged, this.whenWindowFocusChanged);
    wiring.listen(browser.windows.onRemoved, this.whenWindowRemoved);
    wiring.listen(browser.tabs.onCreated, this.whenTabCreated);
    wiring.listen(browser.tabs.onUpdated, this.whenTabUpdated);
    wiring.listen(browser.tabs.onAttached, this.whenTabAttached);
    wiring.listen(browser.tabs.onMoved, this.whenTabMoved);
    wiring.listen(browser.tabs.onReplaced, this.whenTabReplaced);
    wiring.listen(browser.tabs.onActivated, this.whenTabActivated);
    wiring.listen(browser.tabs.onHighlighted, this.whenTabsHighlighted);
    wiring.listen(browser.tabs.onRemoved, this.whenTabRemoved);
  }

  dumpState(): any {
    return {
      windows: JSON.parse(JSON.stringify(Object.fromEntries(this.windows))),
      tabs: JSON.parse(JSON.stringify(Object.fromEntries(this.tabs))),
    };
  }

  /** Fetch tabs/windows from the browser again and update the model's
   * understanding of the world with the browser's data.  Use this if it looks
   * like the model has gotten out of sync with the browser (e.g. for crash
   * recovery). */
  readonly reload = backingOff(async () => {
    // We loop until we can complete a reload without receiving any
    // concurrent events from the browser--if we get a concurrent event, we
    // need to try loading again, since we don't know how the event was
    // ordered with respect to the query().
    this._event_since_load = true;
    while (this._event_since_load) {
      this._event_since_load = false;
      trace("(Re-)loading the model");

      const cur_win = await browser.windows.getCurrent();
      this.focusedWindow.value = cur_win.id as WindowID;

      let tabs = await browser.tabs.query({});

      // We sort tabs by index so that they always get inserted into their
      // parent windows in the correct order, even if they're provided to
      // us out of order.
      tabs = tabs.sort((a, b) => a.index - b.index);
      for (const t of tabs) this.whenTabCreated(t);

      // Clean up any old tabs/windows that don't exist anymore.
      const old_tabs = new Set(this.tabs.keys());
      const old_windows = new Set(this.windows.keys());
      for (const t of tabs) {
        old_tabs.delete(t.id as TabID);
        old_windows.delete(t.windowId as WindowID);
      }
      for (const t of old_tabs) this.whenTabRemoved(t);
      for (const w of old_windows) this.whenWindowRemoved(w);
      trace(
        "Model (re-)load finished; seen events since load started =",
        this._event_since_load,
      );
    }
  });

  //
  // Accessors
  //

  window(id: number): Window | undefined {
    return this.windows.get(id as WindowID);
  }
  tab(id: number): Tab | undefined {
    return this.tabs.get(id as TabID);
  }

  /** Returns the active tab in the specified window (or in
   * `this.current_window`, if no window is specified). */
  activeTab(windowId?: WindowID): Tab | undefined {
    if (windowId === undefined) windowId = this.targetWindow.value?.id;
    if (windowId === undefined) return undefined;

    const window = this.window(windowId);
    if (!window) return undefined;

    return window.children.filter(t => t.active)[0];
  }

  /** Returns a reactive set of tabs with the specified URL. */
  tabsWithURL(url: string): Set<Tab> {
    let index = this.tabs_by_url.get(urlToOpen(url));
    if (!index) {
      index = reactive(new Set<Tab>());
      this.tabs_by_url.set(urlToOpen(url), index);
    }
    return index;
  }

  //
  // User-level operations on tabs
  //

  /** Creates a new tab and waits for the model to reflect its existence.
   *
   * Note that creation of non-discarded is rate-limited, to avoid
   * overwhelming the user's system with a lot of loading tabs. */
  async create(tab: browser.Tabs.CreateCreatePropertiesType): Promise<Tab> {
    const create_tab = Object.assign({}, tab);

    if (!browser.tabs.hide || !tab.url || tab.url.startsWith("about:")) {
      // This is Chrome; it doesn't support discarded tabs, so we can only load
      // so many at once.  This is a little awkward because to the user, it will
      // look like there is a big delay in opening tabs.
      //
      // (It could also be Firefox, which doesn't support creating discarded
      // `about:` tabs.)
      delete create_tab.discarded;
      delete create_tab.title;
      return await this._loading_queue.run(async () => {
        await this._safe_to_load_another_tab();
        trace("creating tab", create_tab);
        const t = await browser.tabs.create(create_tab);
        return await shortPoll(
          () => this.tabs.get(t.id as TabID) || tryAgain(),
        );
      });
    }

    // This is Firefox; it DOES support discarded tabs. We can be fancier and
    // create the discarded tab immediately, and then try to load it in the
    // background only if it's "safe" (i.e. the user's machine can handle it).
    create_tab.discarded = true;

    // Create the tab and find its equivalent in the model
    trace("creating tab", create_tab);
    const t = await browser.tabs.create(create_tab);
    const m = await shortPoll(() => this.tabs.get(t.id as TabID) || tryAgain());

    // If the caller requested that we load the tab, do so as soon as we
    // can--but don't try to load too many at once so we don't overwhelm the
    // user's machine.
    if (!tab.discarded) {
      this._loading_queue.run(async () => {
        await this._safe_to_load_another_tab();
        if (this.tabs.get(m.id) !== m) return; // Tab was closed
        if (!m.discarded) return; // Tab was already loaded

        // Load the tab if it's still discarded.
        trace("loading tab after creation", create_tab);
        await browser.tabs.update(m.id, {url: m.url});
        await shortPoll(
          () => this.tabs.get(m.id) !== m || !m.discarded || tryAgain(),
        );
      });
    }

    return m;
  }

  /** Moves a tab such that it precedes the item with index `toIndex` in
   * the destination window.  (You can pass an index `>=` the length of the
   * windows's tab list to move the item to the end of the window.) */
  async move(id: TabID, toWindow: WindowID, toIndex: number): Promise<void> {
    // This method mainly exists to provide consistent behavior between
    // bookmarks.move() and tabs.move().
    const tab = expect(this.tab(id), () => `Tab ${id} does not exist`);

    // Unlike browser.bookmarks.move(), browser.tabs.move() behaves the same
    // on both Firefox and Chrome.
    const pos = tab.position;
    if (pos?.parent.id === toWindow && toIndex > pos.index) toIndex--;

    trace("moving tab", id, {toWindow, toIndex});
    await browser.tabs.move(id, {windowId: toWindow, index: toIndex});
    await shortPoll(() => {
      const pos = tab.position;
      if (!pos) tryAgain();
      if (pos.parent.id !== toWindow || pos.index !== toIndex) tryAgain();
    });
  }

  /** Close the specified tabs, but leave the browser window open (and create
   * a new tab if necessary to keep it open). */
  async remove(tabIds: TabID[]): Promise<void> {
    trace("removing tabs", tabIds);
    await this.refocusAwayFromTabs(tabIds);
    await browser.tabs.remove(tabIds);
    await shortPoll(() => {
      if (tabIds.find(tid => this.tabs.has(tid)) !== undefined) tryAgain();
    });
  }

  /** Closes the specified browser windows. */
  async removeWindows(windows: Window[]) {
    await Promise.all(windows.map(win => browser.windows.remove(win.id)));
    await shortPoll(() => {
      if (windows.find(w => this.windows.has(w.id)) !== undefined) tryAgain();
    });
  }

  /** If any of the provided tabIds are the active tab, change to a different
   * active tab.  If the tabIds include all open tabs in a window, create a
   * fresh new tab to activate.
   *
   * The intention here is to prep the browser window(s) so that it stays open
   * even if we close every tab in the window(s), and to move away from any
   * active tabs which we are about to close (so the browser doesn't stop us
   * from closing them).
   */
  async refocusAwayFromTabs(tabIds: TabID[]): Promise<void> {
    const closing_tabs = filterMap(tabIds, id => this.tabs.get(id));
    const active_tabs = closing_tabs.filter(t => t.active);

    // NOTE: We expect there to be at most one active tab per window.
    for (const active_tab of active_tabs) {
      const pos = expect(
        active_tab.position,
        () => `Couldn't find position of active tab ${active_tab.id}`,
      );
      const win = pos.parent;
      const tabs_in_window = win.children.filter(t => !t.hidden && !t.pinned);
      const closing_tabs_in_window = closing_tabs.filter(
        t => t.position?.parent === active_tab.position?.parent,
      );

      if (closing_tabs_in_window.length >= tabs_in_window.length) {
        // If we are about to close all visible tabs in the window, we
        // should open a new tab so the window doesn't close.
        trace("creating new empty tab in window", win.id);
        await browser.tabs.create({active: true, windowId: win.id});
      } else {
        // Otherwise we should make sure the currently-active tab isn't
        // a tab we are about to hide/discard.  The browser won't let us
        // hide the active tab, so we'll have to activate a different
        // tab first.
        //
        // We do this search a little strangely--first looking only at
        // tabs AFTER the tabs we're focusing away from, followed by
        // looking only at tabs BEFORE the tabs we're focusing away
        // from, to mimic the browser's behavior when closing the front
        // tab.

        let candidates = tabs_in_window.slice(pos.index + 1);
        let focus_tab = candidates.find(
          t => t.id !== undefined && !tabIds.find(id => t.id === id),
        );
        if (!focus_tab) {
          candidates = tabs_in_window.slice(0, pos.index).reverse();
          focus_tab = candidates.find(
            t => t.id !== undefined && !tabIds.find(id => t.id === id),
          );
        }

        // We should always have a /focus_tab/ at this point, but if we
        // don't, it's better to fail gracefully by doing nothing.
        console.assert(!!focus_tab);
        // We filter out tabs with undefined IDs above #undef
        if (focus_tab) {
          trace("switching focus to tab", focus_tab.id!);
          await browser.tabs.update(focus_tab.id!, {active: true});
        }
      }
    }
  }

  //
  // Events which are detected automatically by this model; these can be
  // called for testing purposes but otherwise you can ignore them.
  //
  // (In contrast to onFoo-style things, they are event listeners, not event
  // senders.)
  //

  whenWindowCreated(win: Windows.Window): Window {
    const wid = win.id as WindowID;
    let window = this.windows.get(wid);
    if (!window) {
      window = reactive({
        id: wid,
        position: undefined,
        children: [],
      } as Window);
      this.windows.set(wid, window);
    }
    trace("event windowCreated", win.id, win);
    // istanbul ignore else
    if (win.tabs !== undefined) {
      for (const t of win.tabs) this.whenTabCreated(t);
    }

    // HACK: If we know the window ID, but not the window object, for the
    // initial window, we must update here, otherwise reactive effects that
    // depend on the contents of the initialWindow will never happen.  Same goes
    // for focusedWindow.
    if (window.id === this.initialWindow.value) {
      this.initialWindow.value = window;
    }
    if (window.id === this.focusedWindow.value) {
      this.focusedWindow.value = window;
    }

    return window;
  }

  whenWindowFocusChanged(winId: number) {
    if (winId === browser.windows.WINDOW_ID_NONE) {
      this.focusedWindow.value = undefined;
      return;
    }

    const win = this.window(winId);
    this.focusedWindow.value = win ?? (winId as WindowID);
  }

  whenWindowRemoved(winId: number) {
    const win = this.windows.get(winId as WindowID);
    trace("event windowRemoved", winId, win);
    if (!win) return;

    if (this.initialWindow.value === winId) {
      this.initialWindow.value = undefined;
    }
    if (this.focusedWindow.value === winId) {
      this.focusedWindow.value = undefined;
    }

    // We clone the array to avoid disturbances while iterating
    for (const t of Array.from(win.children)) this.whenTabRemoved(t.id);
    this.windows.delete(winId as WindowID);
  }

  whenTabCreated(tab: Tabs.Tab) {
    trace(
      "event tabCreated",
      "window",
      tab.windowId,
      "tab",
      tab.id,
      tab.url,
      tab,
    );
    let t = this.tabs.get(tab.id as TabID);
    if (!t) {
      // CAST: Tabs.Tab says the id should be optional, but it isn't...
      t = reactive({
        position: undefined,
        id: tab.id as TabID,
        status: (tab.status as Tabs.TabStatus) ?? "loading",
        title: tab.title ?? "",
        url: tab.url ?? "",
        favIconUrl: tab.favIconUrl ?? "",
        cookieStoreId: tab.cookieStoreId,
        pinned: tab.pinned,
        hidden: tab.hidden ?? false,
        active: tab.active,
        highlighted: tab.highlighted,
        discarded: tab.discarded ?? false,
      } satisfies Tab);
      this.tabs.set(tab.id as TabID, t);
    } else {
      this._remove_url(t);
      if (t.status === "loading") --this.loadingCount.value;

      t.status = (tab.status as Tabs.TabStatus) ?? "loading";
      t.title = tab.title ?? "";
      t.url = tab.url ?? "";
      t.favIconUrl = tab.favIconUrl ?? "";
      t.cookieStoreId = tab.cookieStoreId;
      t.pinned = tab.pinned;
      t.hidden = tab.hidden ?? false;
      t.active = tab.active;
      t.highlighted = tab.highlighted;
      t.discarded = tab.discarded ?? false;
    }

    // Insert the tab in its new position in the window
    const wid = tab.windowId as WindowID;
    let win = this.windows.get(wid);
    if (!win) {
      win = this.whenWindowCreated({
        id: tab.windowId,
        focused: false,
        incognito: false,
        alwaysOnTop: false,
      });
    }
    setPosition(t, {parent: win, index: tab.index});

    // Insert the tab in its index
    this._add_url(t);
    if (t.status === "loading") ++this.loadingCount.value;
  }

  whenTabUpdated(id: number, info: Tabs.OnUpdatedChangeInfoType) {
    trace("event tabUpdated", id, info.url, info);
    const t = this.tab(id as TabID);
    if (!t) {
      // Firefox sometimes sends onUpdated events for a tab after it has been
      // closed.  Worse, the usual technique of reloading the model breaks
      // things even more, because the closed tab hasn't been cleared out of
      // Firefox's internal state at the time we receive the onUpdated event, so
      // browser.tabs.query() still returns the closed tab.  We work around this
      // by simply ignoring onUpdated events for tabs we don't recognize.
      // https://github.com/josh-berry/tab-stash/issues/321
      console.warn(
        `Got onUpdated event for an unknown tab ${id}; ignoring it.`,
      );
      return;
    }

    if (info.status !== undefined) {
      if (t.status === "loading") --this.loadingCount.value;
      t.status = info.status as Tabs.TabStatus;
      if (t.status === "loading") ++this.loadingCount.value;
    }
    if (info.title !== undefined) t.title = info.title;
    if (info.url !== undefined) {
      this._remove_url(t);
      t.url = info.url;
      this._add_url(t);
    }
    if (info.favIconUrl !== undefined) t.favIconUrl = info.favIconUrl;
    if (info.pinned !== undefined) t.pinned = info.pinned;
    if (info.hidden !== undefined) t.hidden = info.hidden;
    if (info.discarded !== undefined) t.discarded = info.discarded;
  }

  whenTabAttached(id: number, info: Tabs.OnAttachedAttachInfoType) {
    this.whenTabMoved(id, {
      windowId: info.newWindowId,
      toIndex: info.newPosition,
    });
  }

  whenTabMoved(tabId: number, info: {windowId: number; toIndex: number}) {
    trace("event tabMoved", tabId, info);
    const t = this.tab(tabId as TabID);
    if (!t) {
      console.warn(`Got move event for unknown tab ${tabId}`);
      return;
    }

    let newWindow = this.window(info.windowId as WindowID);
    if (!newWindow) {
      // Sometimes Firefox sends tabAttached (aka tabMoved) events before
      // (or instead of) the window-creation event itself.  This usually
      // happens when tearing a tab off of an existing window to make a
      // new window.  Handle this by synthesizing a new window.
      //
      // There's unfortunately no way to synthesize this in a unit test
      // because it would require the WebExtension API to allow us to move
      // a tab to an invalid window...
      newWindow = this.whenWindowCreated({
        id: info.windowId,
        focused: false,
        incognito: false,
        alwaysOnTop: false,
      });
    }

    setPosition(t, {parent: newWindow, index: info.toIndex});
  }

  whenTabReplaced(newId: number, oldId: number) {
    trace("event tabReplaced", oldId, "=>", newId);
    const t = this.tab(oldId as TabID);
    if (!t) {
      console.warn(`Got replace event for unknown tab ${oldId} (-> ${newId})`);
      return;
    }

    t.id = newId as TabID;
    this.tabs.delete(oldId as TabID);
    this.tabs.set(t.id, t);
  }

  whenTabActivated(info: Tabs.OnActivatedActiveInfoType) {
    trace("event tabActivated", info.tabId, info);
    const tab = this.tab(info.tabId as TabID);
    if (!tab) {
      console.warn(`Got activated event for unknown tab ${info.tabId}`);
      return;
    }

    // Chrome doesn't tell us which tab was deactivated, so we have to
    // find it and mark it deactivated ourselves...
    const win = this.window(info.windowId as WindowID);
    if (win) for (const t of win.children) t.active = false;

    tab.active = true;
  }

  whenTabsHighlighted(info: Tabs.OnHighlightedHighlightInfoType) {
    trace("event tabsHighlighted", info);
    const win = this.window(info.windowId as WindowID);
    if (!win) {
      console.log(`Got highlighted event for unknown window ${info.windowId}`);
      return;
    }

    for (const t of win.children) {
      t.highlighted = info.tabIds.findIndex(id => id === t.id) !== -1;
    }
  }

  whenTabRemoved(tabId: number) {
    trace("event tabRemoved", tabId);
    const t = this.tabs.get(tabId as TabID);
    if (!t) return; // tab is already removed

    const pos = t.position;
    setPosition(t, undefined);

    trace("event ...tabRemoved", tabId, pos);

    this.tabs.delete(t.id);
    this._remove_url(t);
    if (t.status === "loading") --this.loadingCount.value;
  }

  private _add_url(t: Tab) {
    this.tabsWithURL(t.url).add(t);
  }

  private _remove_url(t: Tab) {
    const index = this.tabs_by_url.get(urlToOpen(t.url));
    // istanbul ignore if -- internal consistency
    if (!index) return;
    index.delete(t);
  }

  /** Wait until the number of tabs being loaded concurrently drops below a
   * reasonable threshold.  This prevents us from opening so many tabs at once
   * that we lock up the user's whole machine. :/ */
  private _safe_to_load_another_tab(): Promise<void> {
    return new Promise<void>(resolve => {
      const check = () => {
        if (this.loadingCount.value >= MAX_LOADING_TABS) return;
        resolve();
        cancel();
      };
      const cancel = watch(this.loadingCount, check);
      check();
    });
  }
}

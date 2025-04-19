import type {
  ExtensionTypes,
  Runtime,
  Tabs as T,
  Windows as W,
} from "webextension-polyfill";

import {later} from "../../util/index.js";
import * as events from "../events.js";

type Window = Omit<W.Window, "id" | "tabs"> & {id: number; tabs: Tab[]};
type Tab = Omit<T.Tab, "id" | "windowId"> & {id: number; windowId: number};

// Exported because it's also used by the sessions mock
export class State {
  readonly onWindowCreated: events.MockEvent<(window: W.Window) => void>;
  readonly onWindowRemoved: events.MockEvent<(windowId: number) => void>;
  readonly onWindowFocusChanged: events.MockEvent<(windowId: number) => void>;

  readonly onTabCreated: events.MockEvent<(tab: T.Tab) => void>;
  readonly onTabUpdated: events.MockEvent<
    (tabId: number, changeInfo: T.OnUpdatedChangeInfoType, tab: Tab) => void
  >;
  readonly onTabMoved: events.MockEvent<
    (tabId: number, moveInfo: T.OnMovedMoveInfoType) => void
  >;
  readonly onTabActivated: events.MockEvent<
    (activeInfo: T.OnActivatedActiveInfoType) => void
  >;
  readonly onTabHighlighted: events.MockEvent<
    (highlightInfo: T.OnHighlightedHighlightInfoType) => void
  >;
  readonly onTabDetached: events.MockEvent<
    (tabId: number, detachInfo: T.OnDetachedDetachInfoType) => void
  >;
  readonly onTabAttached: events.MockEvent<
    (tabId: number, attachInfo: T.OnAttachedAttachInfoType) => void
  >;
  readonly onTabRemoved: events.MockEvent<
    (tabId: number, removeInfo: T.OnRemovedRemoveInfoType) => void
  >;
  readonly onTabReplaced: events.MockEvent<
    (addedTabId: number, removedTabId: number) => void
  >;
  readonly onTabZoomChange: events.MockEvent<
    (ZoomChangeInfo: T.OnZoomChangeZoomChangeInfoType) => void
  >;

  next_tab_id = 0;
  readonly windows: (Window | undefined)[] = [];

  constructor() {
    this.onWindowCreated = new events.MockEvent("browser.windows.onCreated");
    this.onWindowRemoved = new events.MockEvent("browser.windows.onRemoved");
    this.onWindowFocusChanged = new events.MockEvent(
      "browser.windows.onFocusChanged",
    );

    this.onTabCreated = new events.MockEvent("browser.tabs.onCreated");
    this.onTabUpdated = new events.MockEvent("browser.tabs.onUpdated");
    this.onTabMoved = new events.MockEvent("browser.tabs.onMoved");
    this.onTabActivated = new events.MockEvent("browser.tabs.onActivated");
    this.onTabHighlighted = new events.MockEvent("browser.tabs.onHighlighted");
    this.onTabDetached = new events.MockEvent("browser.tabs.onDetached");
    this.onTabAttached = new events.MockEvent("browser.tabs.onAttached");
    this.onTabRemoved = new events.MockEvent("browser.tabs.onRemoved");
    this.onTabReplaced = new events.MockEvent("browser.tabs.onReplaced");
    this.onTabZoomChange = new events.MockEvent("browser.tabs.onCreated");
  }

  win(id: number): Window {
    const win = this.windows[id];
    /* c8 ignore next -- bug-checking */
    if (!win) throw new Error(`No such window: ${id}`);
    return win;
  }

  tab(id: number): Tab {
    for (const w of this.windows) {
      /* c8 ignore next -- tests don't delete windows right now */
      if (!w) continue;
      const tab = w.tabs.find(t => t.id === id);
      if (tab) return tab;
    }
    /* c8 ignore next -- bug-checking*/
    throw new Error(`No such tab: ${id}`);
  }

  validate() {
    const seen_tab_ids = new Set<number>();
    let focused_win: Window | undefined = undefined;

    for (const w of this.windows) {
      if (!w) continue;
      if (w.focused) {
        /* c8 ignore next -- bug-checking */
        if (focused_win) throw new Error(`Multiple focused windows found`);
        focused_win = w;
      }

      let active_tab: Tab | undefined = undefined;
      for (const t of w.tabs) {
        if (t.active) {
          /* c8 ignore next 3 -- bug-checking */
          if (active_tab) {
            throw new Error(`Multiple active tabs in window ${w.id}`);
          }
          active_tab = t;
        }
        /* c8 ignore next 4 -- bug-checking */
        if (t.windowId !== w.id) {
          throw new Error(
            `Inconsistent windowId for tab ${t.id} in window ${w.id}`,
          );
        }
        /* c8 ignore next 3 -- bug-checking */
        if (seen_tab_ids.has(t.id)) {
          throw new Error(`Duplicate tab ID ${t.id} in window ${w.id}`);
        }
        seen_tab_ids.add(t.id);
      }
    }
    /* c8 ignore next 3 -- bug-checking */
    if (this.windows.length > 0 && !focused_win) {
      throw new Error(`No focused windows found`);
    }
  }

  fixup_tab_indices(win: Window) {
    let i = 0;
    for (const t of win.tabs) {
      t.windowId = win.id;
      t.index = i++;
    }
  }

  focus_window(win: Window) {
    let oldWin: Window | undefined = undefined;
    for (const w of this.windows) {
      if (!w) continue;
      if (w.focused) {
        /* c8 ignore next -- bug-checking */
        if (oldWin) throw new Error(`Multiple windows are focused`);
        oldWin = w;
        w.focused = false;
      }
    }
    win.focused = true;
    this.onWindowFocusChanged.send(win.id);
  }

  activate_tab(tab: Tab) {
    const win = this.win(tab.windowId!);
    let oldTab: Tab | undefined = undefined;
    for (const t of win.tabs) {
      if (t.active) {
        /* c8 ignore next -- bug-checking */
        if (oldTab) throw new Error(`Multiple active tabs in window ${win.id}`);
        oldTab = t;
        t.active = false;
      }
      if (t.highlighted) t.highlighted = false;
    }

    tab.active = true;
    this.onTabActivated.send({
      windowId: win.id,
      tabId: tab.id,
      previousTabId: oldTab?.id,
    });

    tab.highlighted = true;
    this.onTabHighlighted.send({
      windowId: win.id,
      tabIds: win.tabs.filter(t => t.highlighted).map(t => t.id),
    });

    /* c8 ignore start -- Tab Stash doesn't currently un-discard tabs */
    if (tab.discarded) {
      tab.discarded = false;
      this.onTabUpdated.send(
        tab.id,
        {discarded: false},
        JSON.parse(JSON.stringify(tab)),
      );
    }
    /* c8 ignore stop */
  }
}

class MockWindows implements W.Static {
  readonly onCreated: events.MockEvent<(window: W.Window) => void>;
  readonly onRemoved: events.MockEvent<(windowId: number) => void>;
  readonly onFocusChanged: events.MockEvent<(windowId: number) => void>;
  readonly WINDOW_ID_NONE: -1 = -1;
  readonly WINDOW_ID_CURRENT: -2 = -2;

  private readonly _state: State;

  constructor(state: State) {
    this.onCreated = state.onWindowCreated;
    this.onRemoved = state.onWindowRemoved;
    this.onFocusChanged = state.onWindowFocusChanged;
    this._state = state;
  }

  /* c8 ignore next 3 -- not implemented */
  async get(windowId: number, getInfo?: W.GetInfo): Promise<W.Window> {
    throw new Error("Method not implemented.");
  }

  async getCurrent(getInfo?: W.GetInfo): Promise<W.Window> {
    // This is an over-simplification; generally the "current" window is the
    // one where the tab/UI is
    const win = this._state.windows.find(w => w?.focused === true);
    /* c8 ignore next -- bug-checking */
    if (!win) throw new Error(`There is no focused window`);

    /* c8 ignore next -- Tab Stash doesn't ever ask for population currently */
    if (getInfo?.populate) return JSON.parse(JSON.stringify(win));
    return only_win(win);
  }

  /* c8 ignore start -- not implemented */
  async getLastFocused(getInfo?: W.GetInfo): Promise<W.Window> {
    throw new Error("Method not implemented.");
  }

  async getAll(getInfo?: W.GetAllGetInfoType): Promise<W.Window[]> {
    throw new Error("Method not implemented.");
  }
  /* c8 ignore stop */

  async create(createData?: W.CreateCreateDataType): Promise<W.Window> {
    const notImplemented = (name: keyof W.CreateCreateDataType) => {
      /* c8 ignore next 3 -- not implemented */
      if (createData && createData[name] !== undefined) {
        throw new Error(`Property ${name} not implemented for window.create()`);
      }
    };
    notImplemented("tabId");
    notImplemented("left");
    notImplemented("top");
    notImplemented("width");
    notImplemented("height");
    notImplemented("incognito");
    notImplemented("type");
    notImplemented("state");
    notImplemented("allowScriptsToClose");
    notImplemented("cookieStoreId");
    notImplemented("titlePreface");

    const win_id = this._state.windows.length;
    const win: Window = {
      id: win_id,
      focused: false,
      incognito: false,
      alwaysOnTop: false,
      type: "normal",
      tabs: [],
    };
    this._state.windows.push(win);
    this.onCreated.send(only_win(win));
    if (this._state.windows.length === 0 || createData?.focused !== false) {
      this._state.focus_window(win);
    }

    const urls = createData?.url
      ? createData.url instanceof Array
        ? createData.url
        : [createData.url]
      : ["about:blank"];
    let i = 0;
    for (const url of urls) {
      const tab_id = this._state.next_tab_id++;
      const tab: Tab = {
        id: tab_id,
        windowId: win_id,
        index: i++,
        url,
        highlighted: false,
        active: false,
        pinned: false,
        incognito: false,
        status: "loading",
      };
      win.tabs.push(tab);
      this._state.onTabCreated.send(JSON.parse(JSON.stringify(tab)));
      later(() => {
        tab.status = "complete";
        this._state.onTabUpdated.send(
          tab.id,
          {status: "complete"},
          JSON.parse(JSON.stringify(tab)),
        );
      });
    }
    this._state.activate_tab(win.tabs[win.tabs.length - 1]);

    this._state.validate();
    return JSON.parse(JSON.stringify(win));
  }

  async update(
    windowId: number,
    updateInfo: W.UpdateUpdateInfoType,
  ): Promise<W.Window> {
    const win = this._state.win(windowId);

    const notImplemented = (name: keyof W.UpdateUpdateInfoType) => {
      /* c8 ignore next 3 -- not implemented */
      if (name in updateInfo) {
        throw new Error(`Parameter ${name} is not implemented`);
      }
    };
    notImplemented("left");
    notImplemented("top");
    notImplemented("width");
    notImplemented("height");
    notImplemented("drawAttention");
    notImplemented("state");
    notImplemented("titlePreface");

    if (updateInfo.focused !== undefined) {
      if (updateInfo.focused) {
        this._state.focus_window(win);
      } else {
        // Not quite Z-order, but close enough...
        const w = this._state.windows.find(w => w);
        if (w) {
          this._state.focus_window(w);
        } else {
          win.focused = false;
        }
      }
    }

    return only_win(win);
  }

  async remove(windowId: number): Promise<void> {
    const win = this._state.win(windowId);
    this._state.windows[windowId] = undefined;
    this.onRemoved.send(windowId);

    if (win.focused) {
      // This is an oversimplification, but it works
      const w = this._state.windows.find(w => w);
      /* c8 ignore next -- tests never close the focused window currently */
      if (w) this._state.focus_window(w);
    }

    this._state.validate();
  }
}

function only_win(win: W.Window): W.Window {
  const ret: W.Window = JSON.parse(JSON.stringify(win));
  delete ret.tabs;
  return ret;
}

class MockTabs implements T.Static {
  readonly onCreated: events.MockEvent<(tab: T.Tab) => void>;
  readonly onUpdated: events.MockEvent<
    (tabId: number, changeInfo: T.OnUpdatedChangeInfoType, tab: Tab) => void
  >;
  readonly onMoved: events.MockEvent<
    (tabId: number, moveInfo: T.OnMovedMoveInfoType) => void
  >;
  readonly onActivated: events.MockEvent<
    (activeInfo: T.OnActivatedActiveInfoType) => void
  >;
  readonly onHighlighted: events.MockEvent<
    (highlightInfo: T.OnHighlightedHighlightInfoType) => void
  >;
  readonly onDetached: events.MockEvent<
    (tabId: number, detachInfo: T.OnDetachedDetachInfoType) => void
  >;
  readonly onAttached: events.MockEvent<
    (tabId: number, attachInfo: T.OnAttachedAttachInfoType) => void
  >;
  readonly onRemoved: events.MockEvent<
    (tabId: number, removeInfo: T.OnRemovedRemoveInfoType) => void
  >;
  readonly onReplaced: events.MockEvent<
    (addedTabId: number, removedTabId: number) => void
  >;
  readonly onZoomChange: events.MockEvent<
    (ZoomChangeInfo: T.OnZoomChangeZoomChangeInfoType) => void
  >;

  readonly TAB_ID_NONE: -1 = -1;

  private readonly _state: State;

  constructor(state: State) {
    this.onCreated = state.onTabCreated;
    this.onUpdated = state.onTabUpdated;
    this.onMoved = state.onTabMoved;
    this.onActivated = state.onTabActivated;
    this.onHighlighted = state.onTabHighlighted;
    this.onDetached = state.onTabDetached;
    this.onAttached = state.onTabAttached;
    this.onRemoved = state.onTabRemoved;
    this.onReplaced = state.onTabReplaced;
    this.onZoomChange = state.onTabZoomChange;
    this._state = state;
  }

  async get(tabId: number): Promise<T.Tab> {
    return JSON.parse(JSON.stringify(this._state.tab(tabId)));
  }

  /* c8 ignore start -- not implemented */
  async getCurrent(): Promise<T.Tab> {
    throw new Error("Method not implemented.");
  }

  connect(tabId: number, connectInfo?: T.ConnectConnectInfoType): Runtime.Port {
    throw new Error("Method not implemented.");
  }

  async sendMessage(
    tabId: number,
    message: any,
    options?: T.SendMessageOptionsType,
  ): Promise<any> {
    throw new Error("Method not implemented.");
  }
  /* c8 ignore stop */

  async create(options: T.CreateCreatePropertiesType): Promise<T.Tab> {
    /* c8 ignore next 3 -- not implemented */
    let windowId = options.windowId;
    windowId ??= this._state.windows.find(w => w?.focused)?.id;
    windowId ??= this._state.windows[0]?.id;
    if (windowId === undefined) {
      throw new Error(`No windows are open`);
    }

    if (options.url) {
      const url = new URL(options.url);
      if (url.protocol === "file:") {
        throw new Error(`File URLs are not supported`);
      } else if (url.protocol === "about:") {
        // about:blank is fine, but about:config and others are not
        if (url.pathname !== "blank") {
          throw new Error(`About URLs are not supported`);
        }
      }
    }

    const win = this._state.win(windowId);
    const id = this._state.next_tab_id++;
    const tab: Tab = {
      id,
      windowId: windowId,
      index: options.index ?? win.tabs.length,
      url: options.url ?? "about:blank",
      title: options.title,
      discarded: options.discarded,
      highlighted: false,
      active: false,
      pinned: options.pinned ?? false,
      incognito: false,
      status: "loading",
    };
    this._finish_loading(tab);

    // If the tab is pinned, it must have an index before all unpinned tabs
    if (tab.pinned) {
      let first_unpinned = win.tabs.find(t => !t.pinned);
      /* c8 ignore next -- we never create pinned after creating unpinned */
      tab.index = Math.min(tab.index, first_unpinned?.index ?? win.tabs.length);
    }

    win.tabs.splice(tab.index, 0, tab);
    this._state.fixup_tab_indices(win);

    this.onCreated.send(JSON.parse(JSON.stringify(tab)));
    /* c8 ignore next -- active isn't explicitly specified by tests */
    if (options.active ?? true) this._state.activate_tab(tab);

    this._state.validate();
    return JSON.parse(JSON.stringify(tab));
  }

  /* c8 ignore start -- not implemented */
  async duplicate(
    tabId: number,
    duplicateProperties?: T.DuplicateDuplicatePropertiesType,
  ): Promise<T.Tab> {
    throw new Error("Method not implemented.");
  }
  /* c8 ignore stop */

  async query(queryInfo: T.QueryQueryInfoType): Promise<T.Tab[]> {
    let res: Tab[] = [];
    for (const w of this._state.windows) {
      /* c8 ignore next -- windows are never closed by tests */
      if (w) for (const t of w.tabs) res.push(t);
    }

    const filterEqual = (name: keyof T.QueryQueryInfoType & keyof T.Tab) => {
      if (name in queryInfo) res = res.filter(t => t[name] === queryInfo[name]);
    };
    const notImplemented = (name: keyof T.QueryQueryInfoType) => {
      /* c8 ignore next 3 -- not implemented */
      if (name in queryInfo) {
        throw new Error(`Query parameter ${name} is not implemented`);
      }
    };
    filterEqual("active");
    filterEqual("attention");
    filterEqual("pinned");
    filterEqual("audible");
    notImplemented("muted");
    filterEqual("highlighted");
    notImplemented("currentWindow");
    notImplemented("lastFocusedWindow");
    notImplemented("status");
    filterEqual("discarded");
    filterEqual("hidden");
    notImplemented("title");
    notImplemented("url");
    filterEqual("windowId");
    notImplemented("windowType");
    notImplemented("index");
    notImplemented("cookieStoreId");
    notImplemented("openerTabId");
    notImplemented("screen");
    notImplemented("camera");
    notImplemented("microphone");
    notImplemented("autoDiscardable");

    if ("windowId" in queryInfo) {
      // If we're looking at a particular window, return tabs in sorted order
      res = res.sort((a, b) => a.index - b.index);
    }
    return JSON.parse(JSON.stringify(res));
  }

  /* c8 ignore next 5 -- not implemented */
  async highlight(
    highlightInfo: T.HighlightHighlightInfoType,
  ): Promise<W.Window> {
    throw new Error("Method not implemented.");
  }

  async update(
    tabId: number | undefined,
    updateProperties: T.UpdateUpdatePropertiesType,
  ): Promise<T.Tab>;
  async update(updateProperties: T.UpdateUpdatePropertiesType): Promise<T.Tab>;
  async update(tabId: any, updateProperties?: any): Promise<T.Tab> {
    /* c8 ignore next 5 -- not implemented */
    if (typeof tabId !== "number") {
      throw new Error(
        `Calling tabs.update() without a tab ID is not implemented`,
      );
    }
    const options: T.UpdateUpdatePropertiesType = updateProperties;
    /* c8 ignore next 5 -- not implemented*/
    if (!options) {
      throw new Error(
        `Calling tabs.update() without options is not implemented`,
      );
    }

    const notImplemented = (name: keyof T.UpdateUpdatePropertiesType) => {
      /* c8 ignore next 3 -- not implemented */
      if (options[name] !== undefined) {
        throw new Error(`Passing ${name} to tabs.update() is not implemented`);
      }
    };

    const tab = this._state.tab(tabId);

    notImplemented("pinned");
    notImplemented("muted");
    notImplemented("openerTabId");
    notImplemented("loadReplace");
    notImplemented("successorTabId");
    notImplemented("autoDiscardable");

    const dirty: T.OnUpdatedChangeInfoType = {};
    if (options.url !== undefined) {
      dirty.url = options.url;
      tab.url = options.url;
      dirty.status = "loading";
      tab.status = "loading";
      // Updating a tab's URL causes it to become un-discarded
      if (tab.discarded) {
        dirty.discarded = false;
        tab.discarded = false;
      }
      this._finish_loading(tab);
    }
    if (options.highlighted !== undefined) {
      const win = this._state.win(tab.windowId);
      if (tab.highlighted !== options.highlighted) {
        tab.highlighted = options.highlighted;
        this.onHighlighted.send({
          windowId: win.id,
          tabIds: win.tabs.filter(t => t.highlighted).map(t => t.id),
        });
      }
    }
    if (options.active !== undefined) {
      if (options.active) {
        this._state.activate_tab(tab);
      } /* c8 ignore next 3 -- not implemented */ else {
        throw new Error(`De-activating tabs is not implemented`);
      }
    }

    if (Object.keys(dirty).length > 0) {
      this.onUpdated.send(tabId, dirty, JSON.parse(JSON.stringify(tab)));
    }

    return JSON.parse(JSON.stringify(tab));
  }

  async move(
    tabIds: number | number[],
    moveProperties: T.MoveMovePropertiesType,
  ): Promise<T.Tab | T.Tab[]> {
    /* c8 ignore next -- tests always move single tabs */
    const tab_ids = tabIds instanceof Array ? tabIds : [tabIds];
    const ret: T.Tab[] = [];

    /* c8 ignore next -- tests never move zero tabs */
    if (tab_ids.length === 0) return [];

    /* c8 ignore next 2 -- tests always specify window IDs */
    const to_win_id =
      moveProperties.windowId ?? this._state.tab(tab_ids[0]).windowId;
    const to_win = this._state.win(to_win_id);

    let to_index = moveProperties.index;
    const windows_to_fixup = new Set<Window>([to_win]);

    for (const tid of tab_ids) {
      const tab = this._state.tab(tid);
      ret.push(tab);

      const from_win = this._state.win(tab.windowId);
      windows_to_fixup.add(from_win);

      /* c8 ignore next 5 -- bug-checking */
      if (from_win.tabs[tab.index] !== tab) {
        throw new Error(
          `BUG: Window ${from_win.id} does not have tab ${tab.id} at index ${tab.index}`,
        );
      }

      // console.log('from before', from_win.tabs);
      // console.log('to before', to_win.tabs);
      from_win.tabs.splice(tab.index, 1);
      // console.log('after remove', from_win.tabs);
      to_win.tabs.splice(to_index, 0, tab);
      // console.log('after insert', to_win.tabs);

      if (from_win !== to_win) {
        this.onAttached.send(tid, {
          newWindowId: to_win.id,
          newPosition: to_index,
        });
      } else {
        this.onMoved.send(tid, {
          windowId: to_win.id,
          fromIndex: tab.index,
          toIndex: to_index,
        });
      }
      ++to_index;
    }

    for (const w of windows_to_fixup) this._state.fixup_tab_indices(w);
    // console.log(`After window fixup`);
    // for (const w of windows_to_fixup) console.log(w);

    /* c8 ignore next -- tests never move multiple tabs */
    if (tabIds instanceof Array) return JSON.parse(JSON.stringify(ret));
    return JSON.parse(JSON.stringify(ret[0]));
  }

  /* c8 ignore start -- not implemented */
  async reload(
    tabId?: number,
    reloadProperties?: T.ReloadReloadPropertiesType,
  ): Promise<void> {
    throw new Error("Method not implemented.");
  }

  warmup(tabId: number): void {
    throw new Error("Method not implemented.");
  }
  /* c8 ignore stop */

  async remove(tabIds: number | number[]): Promise<void> {
    /* c8 ignore next -- tests always remove single tabs */
    if (typeof tabIds === "number") tabIds = [tabIds];
    for (const tid of tabIds) {
      const tab = this._state.tab(tid);
      const win = this._state.win(tab.windowId);

      /* c8 ignore next 5 -- bug-checking */
      if (tab !== win.tabs[tab.index]) {
        throw new Error(
          `BUG: Tab ${tid} is not at the right index in window ${win.id}`,
        );
      }

      win.tabs.splice(tab.index, 1);
      this._state.fixup_tab_indices(win);

      this.onRemoved.send(tid, {
        windowId: win.id,
        isWindowClosing: win.tabs.length === 0,
      });

      /* c8 ignore next 6 -- tests never close windows by closing tabs */
      if (win.tabs.length === 0) {
        this._state.onWindowRemoved.send(win.id);
        this._state.windows[win.id] = undefined;
      } else if (tab.active) {
        this._state.activate_tab(win.tabs[0]);
      }
    }

    this._state.validate();
  }

  async discard(tabIds: number | number[]): Promise<void> {
    /* c8 ignore next -- tests always discard individual tabs */
    if (typeof tabIds === "number") tabIds = [tabIds];
    for (const tid of tabIds) {
      const tab = this._state.tab(tid);
      if (!tab.active && !tab.discarded) {
        tab.discarded = true;
        this.onUpdated.send(
          tid,
          {discarded: true},
          JSON.parse(JSON.stringify(tab)),
        );
      }
    }
  }

  /* c8 ignore start -- not implemented */
  async detectLanguage(tabId?: number): Promise<string> {
    throw new Error("Method not implemented.");
  }

  async toggleReaderMode(tabId?: number): Promise<void> {
    throw new Error("Method not implemented.");
  }

  async captureTab(
    tabId?: number,
    options?: ExtensionTypes.ImageDetails,
  ): Promise<string> {
    throw new Error("Method not implemented.");
  }

  async captureVisibleTab(
    windowId?: number,
    options?: ExtensionTypes.ImageDetails,
  ): Promise<string> {
    throw new Error("Method not implemented.");
  }

  async executeScript(
    tabId: number | undefined,
    details: ExtensionTypes.InjectDetails,
  ): Promise<any[]>;
  async executeScript(details: ExtensionTypes.InjectDetails): Promise<any[]>;
  async executeScript(tabId: any, details?: any): Promise<any[]> {
    throw new Error("Method not implemented.");
  }

  async insertCSS(
    tabId: number | undefined,
    details: ExtensionTypes.InjectDetails,
  ): Promise<void>;
  async insertCSS(details: ExtensionTypes.InjectDetails): Promise<void>;
  async insertCSS(tabId: any, details?: any): Promise<void> {
    throw new Error("Method not implemented.");
  }

  async removeCSS(
    tabId: number | undefined,
    details: ExtensionTypes.InjectDetails,
  ): Promise<void>;
  async removeCSS(details: ExtensionTypes.InjectDetails): Promise<void>;
  async removeCSS(tabId: any, details?: any): Promise<void> {
    throw new Error("Method not implemented.");
  }

  async setZoom(tabId: number | undefined, zoomFactor: number): Promise<void>;
  async setZoom(zoomFactor: number): Promise<void>;
  async setZoom(tabId: any, zoomFactor?: any): Promise<void> {
    throw new Error("Method not implemented.");
  }

  async getZoom(tabId?: number): Promise<number> {
    throw new Error("Method not implemented.");
  }

  async setZoomSettings(
    tabId: number | undefined,
    zoomSettings: T.ZoomSettings,
  ): Promise<void>;
  async setZoomSettings(zoomSettings: T.ZoomSettings): Promise<void>;
  async setZoomSettings(tabId: any, zoomSettings?: any): Promise<void> {
    throw new Error("Method not implemented.");
  }

  async getZoomSettings(tabId?: number): Promise<T.ZoomSettings> {
    throw new Error("Method not implemented.");
  }

  print(): void {
    throw new Error("Method not implemented.");
  }

  async printPreview(): Promise<void> {
    throw new Error("Method not implemented.");
  }

  async saveAsPDF(pageSettings: T.PageSettings): Promise<string> {
    throw new Error("Method not implemented.");
  }
  /* c8 ignore stop */

  async show(tabIds: number | number[]): Promise<void> {
    /* c8 ignore next -- tests never show multiple tabs at once */
    tabIds = tabIds instanceof Array ? tabIds : [tabIds];
    for (const tid of tabIds) {
      const tab = this._state.tab(tid);
      if (tab.hidden) {
        tab.hidden = false;
        this.onUpdated.send(
          tid,
          {hidden: false},
          JSON.parse(JSON.stringify(tab)),
        );
      }
    }
  }

  async hide(tabIds: number | number[]): Promise<number[]> {
    /* c8 ignore next -- tests never hide multiple tabs at once */
    tabIds = tabIds instanceof Array ? tabIds : [tabIds];
    const ret = [];
    for (const tid of tabIds) {
      const tab = this._state.tab(tid);
      if (!tab.hidden) {
        ret.push(tid);
        tab.hidden = true;
        this.onUpdated.send(
          tid,
          {hidden: true},
          JSON.parse(JSON.stringify(tab)),
        );
      }
    }
    return ret;
  }

  /* c8 ignore start -- not implemented */
  moveInSuccession(
    tabIds: number[],
    tabId?: number,
    options?: T.MoveInSuccessionOptionsType,
  ): void {
    throw new Error("Method not implemented.");
  }

  async goForward(tabId?: number): Promise<void> {
    throw new Error("Method not implemented.");
  }

  async goBack(tabId?: number): Promise<void> {
    throw new Error("Method not implemented.");
  }
  /* c8 ignore stop */

  _finish_loading(t: Tab) {
    later(() => {
      t.status = "complete";
      this.onUpdated.send(
        t.id,
        {status: "complete"},
        JSON.parse(JSON.stringify(t)),
      );
    });
  }
}

export interface UpdateTabInfoOptions {
  title?: string;
  favIconUrl?: string;
  url?: string;
}

export default (() => {
  let state = new State();

  const exports = {
    state,
    windows: new MockWindows(state),
    tabs: new MockTabs(state),

    reset() {
      exports.state = state = new State();
      exports.windows = new MockWindows(state);
      exports.tabs = new MockTabs(state);
      (<any>globalThis).browser.windows = exports.windows;
      (<any>globalThis).browser.tabs = exports.tabs;
    },

    updateTabInfo(tabId: number, options: UpdateTabInfoOptions) {
      const tab = state.tab(tabId);

      const mods: UpdateTabInfoOptions = {};
      for (const field of ["title", "url", "favIconUrl"] as const) {
        if (options[field] !== undefined && options[field] !== tab[field]) {
          mods[field] = options[field];
          tab[field] = options[field];
        }
      }

      if (Object.keys(mods).length === 0) return;
      state.onTabUpdated.send(tabId, mods, JSON.parse(JSON.stringify(tab)));
    },
  };

  exports.reset();

  return exports;
})();

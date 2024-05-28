import type {Sessions, Tabs as T, Windows as W} from "webextension-polyfill";

import * as events from "../events";
import type {State} from "./tabs-and-windows";
import tabs_and_windows from "./tabs-and-windows";

type Metadata = Map<string, any>;

class MockSessions implements Sessions.Static {
  readonly MAX_SESSION_RESULTS = 25;

  readonly onChanged: events.MockEvent<() => void> = new events.MockEvent(
    "browser.sessions.onChanged",
  );

  private readonly _state: State;
  private readonly _windows = new WeakMap<W.Window, Metadata>();
  private readonly _tabs = new WeakMap<T.Tab, Metadata>();

  constructor(state: State) {
    this._state = state;
  }

  forgetClosedTab(windowId: number, sessionId: string): Promise<void> {
    throw new Error("Method not implemented.");
  }
  forgetClosedWindow(sessionId: string): Promise<void> {
    throw new Error("Method not implemented.");
  }
  getRecentlyClosed(
    filter?: Sessions.Filter | undefined,
  ): Promise<Sessions.Session[]> {
    throw new Error("Method not implemented.");
  }
  restore(sessionId?: string | undefined): Promise<Sessions.Session> {
    throw new Error("Method not implemented.");
  }

  async setTabValue(tabId: number, key: string, value: any): Promise<void> {
    const md = this._tab(tabId);
    md.set(key, JSON.stringify(value));
  }
  async getTabValue(tabId: number, key: string): Promise<any> {
    const md = this._tab(tabId);
    const val = md.get(key);
    if (val === undefined) return undefined;
    return JSON.parse(val);
  }
  async removeTabValue(tabId: number, key: string): Promise<void> {
    const md = this._tab(tabId);
    md.delete(key);
  }

  async setWindowValue(
    windowId: number,
    key: string,
    value: any,
  ): Promise<void> {
    const md = this._window(windowId);
    md.set(key, JSON.stringify(value));
  }
  async getWindowValue(windowId: number, key: string): Promise<any> {
    const md = this._window(windowId);
    const val = md.get(key);
    if (val === undefined) return undefined;
    return JSON.parse(val);
  }
  async removeWindowValue(windowId: number, key: string): Promise<void> {
    const md = this._window(windowId);
    md.delete(key);
  }

  private _window(id: number): Metadata {
    const win = this._state.win(id);
    let md = this._windows.get(win);
    if (!md) {
      md = new Map();
      this._windows.set(win, md);
    }
    return md;
  }

  private _tab(id: number): Metadata {
    const tab = this._state.tab(id);
    let md = this._tabs.get(tab);
    if (!md) {
      md = new Map();
      this._tabs.set(tab, md);
    }
    return md;
  }
}

export default (() => {
  const exports = {
    sessions: new MockSessions(tabs_and_windows.state),
    reset() {
      exports.sessions = new MockSessions(tabs_and_windows.state);
      (<any>globalThis).browser.sessions = exports.sessions;
    },
  };

  exports.reset();

  return exports;
})();

/* c8 ignore start -- global state for the UI */

import browser from "webextension-polyfill";

import KVSClient from "./datastore/kvs/client.js";
import {KVSCache} from "./datastore/kvs/index.js";
import type {BookmarkMetadata} from "./model/bookmark-metadata.js";
import type {Favicon} from "./model/favicons.js";
import * as M from "./model/index.js";
import {resolveNamed} from "./util/index.js";
import {tracersEnabled} from "./util/debug.js";

/** Global variables.  The core conceit here is these are all initialized as
 * `undefined!`, and then initialized properly in the async `init()` function
 * which must be called on startup. */
const the = {
  /** The OS the browser is running on. */
  os: undefined! as string,

  /** The browser the extension is running in. */
  browser: undefined! as string,

  /** The version number of Tab Stash. */
  version: undefined! as string,

  /** The main model, describing open windows, saved bookmarks, and any other
   * persistent data kept by Tab Stash. */
  model: undefined! as M.Model,

  /** The UI form factor. */
  view: "tab" as "tab" | "popup" | "sidebar",

  /** Flags to enable/disable debug tracing. */
  tracersEnabled: tracersEnabled,
};

(<any>globalThis).the = the;
export default the;

export async function initTheGlobals() {
  performance.mark("PAGE LOAD START");

  const loc = new URL(document.location.href);

  // Figure out which form factor we're running in.
  switch (loc.searchParams.get("view")) {
    case "popup":
    case "sidebar":
    case "tab":
      the.view = loc.searchParams.get("view") as "tab" | "popup" | "sidebar";
      break;
  }

  // Enable tracing at load time if needed
  const trace = (loc.searchParams.get("trace") ?? "").split(",");
  for (const t of trace) {
    the.tracersEnabled[t] = true;
  }

  const sources = await resolveNamed({
    browser: browser.runtime.getBrowserInfo
      ? browser.runtime.getBrowserInfo()
      : {name: "chrome"},
    os: browser.runtime.getPlatformInfo
      ? browser.runtime.getPlatformInfo()
      : {os: "unknown"},
    version: browser.management.getSelf(),

    browser_settings: M.BrowserSettings.Model.live(),
    options: M.Options.Model.live(),
    tabs: M.Tabs.Model.from_browser(), // TODO load from cache
    containers: M.Containers.Model.from_browser(),
    bookmarks: M.Bookmarks.Model.from_browser(), // TODO load from cache
    deleted_items: new M.DeletedItems.Model(
      new KVSClient<string, M.DeletedItems.SourceValue>("deleted_items"),
    ),
  });

  the.os = sources.os.os;
  the.browser = sources.browser.name.toLowerCase();
  the.version = sources.version.version;

  the.model = new M.Model({
    ...sources,
    favicons: new M.Favicons.Model(
      new KVSCache(new KVSClient<string, Favicon>("favicons")),
    ),
    bookmark_metadata: new M.BookmarkMetadata.Model(
      new KVSCache(
        new KVSClient<string, BookmarkMetadata>("bookmark-metadata"),
      ),
    ),
  });

  // Hack to allow manual selection of the window to track, for debugging purposes
  const winId = loc.searchParams.get("window");
  if (winId !== null) {
    const win = the.model.tabs.window(Number.parseInt(winId));
    if (win) the.model.tabs.initialWindow.value = win;
  }
}

// istanbul ignore file -- global state for the UI

import browser from "webextension-polyfill";

import {KVSCache} from "@/datastore/kvs";
import KVSClient from "@/datastore/kvs/client";
import * as M from "@/model";
import type {BookmarkMetadata} from "@/model/bookmark-metadata";
import type {Favicon} from "@/model/favicons";
import {resolveNamed} from "@/util";

/** Global variables.  The core conceit here is these are all initialized as
 * `undefined!`, and then initialized properly in the async `init()` function
 * which must be called on startup. */
const the = {
  /** The version number of Tab Stash. */
  version: undefined! as string,

  /** The main model, describing open windows, saved bookmarks, and any other
   * persistent data kept by Tab Stash. */
  model: undefined! as M.Model,
};

(<any>globalThis).the = the;
export default the;

export async function init() {
  const sources = await resolveNamed({
    browser_settings: M.BrowserSettings.Model.live(),
    options: M.Options.Model.live(),
    tabs: M.Tabs.Model.from_browser(), // TODO load from cache
    containers: M.Containers.Model.from_browser(),
    bookmarks: M.Bookmarks.Model.from_browser(), // TODO load from cache
    deleted_items: new M.DeletedItems.Model(
      new KVSClient<string, M.DeletedItems.SourceValue>("deleted_items"),
    ),
  });

  the.version = (await browser.management.getSelf()).version;

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
}

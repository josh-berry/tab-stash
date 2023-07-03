// istanbul ignore file -- global state for the UI

import {ref, type Ref} from "vue";
import browser from "webextension-polyfill";

import {KVSCache} from "@/datastore/kvs";
import KVSClient from "@/datastore/kvs/client";
import * as M from "@/model";
import type {BookmarkMetadata} from "@/model/bookmark-metadata";
import type {Favicon} from "@/model/favicons";
import {resolveNamed} from "@/util";
import {isFolder, type Folder, type Node} from "./model/bookmarks";
import type {Tab, Window} from "./model/tabs";
import {TreeFilter} from "./model/tree-filter";

const filter_fn = ref((_: Window | Tab | Node) => true as boolean);

/** Global variables.  The core conceit here is these are all initialized as
 * `undefined!`, and then initialized properly in the async `init()` function
 * which must be called on startup. */
const the = {
  /** The version number of Tab Stash. */
  version: undefined! as string,

  /** The main model, describing open windows, saved bookmarks, and any other
   * persistent data kept by Tab Stash. */
  model: undefined! as M.Model,

  /** A predicate function that implements the currently-active search in the UI
   * (e.g. if the search bar at the top of the page has something in it).  If
   * there is no active search, the predicate should always return `true`. */
  filter_fn: undefined! as Ref<(_: Window | Tab | Node) => boolean>,

  /** The filtered state of all open windows/tabs, according to `the.filter_fn`.
   * */
  tab_filter: undefined! as TreeFilter<Window, Tab>,

  /** The filtered state of all bookmarks, according to `the.filter_fn`. */
  bookmark_filter: undefined! as TreeFilter<Folder, Node>,
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

  the.filter_fn = ref(_ => true);

  the.tab_filter = new TreeFilter<Window, Tab>({
    isParent(node): node is Window {
      return "children" in node;
    },
    predicate(node) {
      return filter_fn.value(node);
    },
  });

  the.bookmark_filter = new TreeFilter<Folder, Node>({
    isParent(node): node is Folder {
      return isFolder(node);
    },
    predicate(node) {
      return filter_fn.value(node);
    },
  });
}

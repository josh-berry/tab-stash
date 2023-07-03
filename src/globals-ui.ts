// istanbul ignore file -- global state for the UI

import {ref} from "vue";
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

const the = {
  version: undefined! as string,
  model: undefined! as M.Model,

  filter_fn,

  bookmark_filter: new TreeFilter<Folder, Node>({
    isParent(node): node is Folder {
      return isFolder(node);
    },
    predicate(node) {
      return filter_fn.value(node);
    },
  }),

  tab_filter: new TreeFilter<Window, Tab>({
    isParent(node): node is Window {
      return "children" in node;
    },
    predicate(node) {
      return filter_fn.value(node);
    },
  }),
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

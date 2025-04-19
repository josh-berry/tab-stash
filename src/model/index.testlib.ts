import {expect} from "chai";

import storage_mock from "../mock/browser/storage.js";
import * as events from "../mock/events.js";
import type {BookmarkFixture, TabFixture} from "./fixtures.testlib.js";
import {
  STASH_ROOT_NAME,
  make_bookmark_metadata,
  make_bookmarks,
  make_deleted_items,
  make_favicons,
  make_tabs,
} from "./fixtures.testlib.js";

import * as M from "./index.js";
import type {KeyValueStore} from "../datastore/kvs/index.js";
import {KVSCache} from "../datastore/kvs/index.js";
import MemoryKVS from "../datastore/kvs/memory.js";
import {_StoredObjectFactory} from "../datastore/stored-object.js";
import {LOCAL_DEF, SYNC_DEF} from "./options.js";

export interface ModelTestEnv {
  tabs: TabFixture["tabs"];
  windows: TabFixture["windows"];
  bookmarks: BookmarkFixture;

  bookmark_metadata: KeyValueStore<string, M.BookmarkMetadata.BookmarkMetadata>;

  favicons: KeyValueStore<string, M.Favicons.Favicon>;
  deleted_items: KeyValueStore<string, M.DeletedItems.SourceValue>;

  model: M.Model;
}

export async function setupModelTestEnv(): Promise<ModelTestEnv> {
  let tabs: TabFixture["tabs"];
  let windows: TabFixture["windows"];
  let bookmarks: BookmarkFixture;

  let bookmark_metadata: KeyValueStore<
    string,
    M.BookmarkMetadata.BookmarkMetadata
  >;
  let favicons: KeyValueStore<string, M.Favicons.Favicon>;
  let deleted_items: KeyValueStore<string, M.DeletedItems.SourceValue>;

  let model: M.Model;

  storage_mock.reset();
  const stored_object_factory = new _StoredObjectFactory();

  const tw = await make_tabs();
  tabs = tw.tabs;
  windows = tw.windows;
  bookmarks = await make_bookmarks();

  bookmark_metadata = new MemoryKVS("bookmark_metadata");
  await make_bookmark_metadata(bookmark_metadata, bookmarks);

  favicons = new MemoryKVS("favicons");
  await make_favicons(favicons);

  deleted_items = new MemoryKVS("deleted_items");
  await make_deleted_items(deleted_items);

  const tab_model = await M.Tabs.Model.from_browser();
  const bm_model = await M.Bookmarks.Model.from_browser(STASH_ROOT_NAME);
  model = new M.Model({
    browser_settings: await M.BrowserSettings.Model.live(),
    options: new M.Options.Model({
      sync: await stored_object_factory.get("sync", "test_options", SYNC_DEF),
      local: await stored_object_factory.get(
        "local",
        "test_options",
        LOCAL_DEF,
      ),
    }),
    tabs: tab_model,
    containers: await M.Containers.Model.from_browser(),
    bookmarks: bm_model,
    deleted_items: new M.DeletedItems.Model(deleted_items),
    favicons: new M.Favicons.Model(new KVSCache(favicons)),
    bookmark_metadata: new M.BookmarkMetadata.Model(
      new KVSCache(bookmark_metadata),
    ),
  });

  // Cleanup timeouts
  afterEach(() => {
    model.deleted_items.clearRecentlyDeletedItems();
  });

  // We also need to wait for the favicon cache to update itself
  await model.favicons.sync();
  await events.watch(favicons.onSet).untilNextTick();

  // We need the indexes in the models to be populated
  await events
    .watch(["EventfulMap.onInsert", "EventfulMap.onUpdate"])
    .untilNextTick();
  expect(tab_model.window(windows.left.id)!.children.length).to.equal(3);
  expect(tab_model.window(windows.right.id)!.children.length).to.equal(3);
  expect(tab_model.window(windows.real.id)!.children.length).to.equal(11);
  expect(bm_model.stash_root.value!.id).to.equal(bookmarks.stash_root.id);

  return {
    tabs,
    windows,
    bookmarks,
    bookmark_metadata,
    favicons,
    deleted_items,
    model,
  };
}

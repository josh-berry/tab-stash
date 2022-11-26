// An instantiation of the model for use in the UI (as opposed to the background
// context)

// istanbul ignore file
import {KVSCache} from "./datastore/kvs";
import KVSClient from "./datastore/kvs/client";
import {resolveNamed} from "./util";

import * as M from "./model";
import type {BookmarkMetadata} from "./model/bookmark-metadata";
import type {Favicon} from "./model/favicons";

export default async function (): Promise<M.Model> {
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

  const model = new M.Model({
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
  (<any>globalThis).model = model;
  return model;
}

//
// The model--a centralized place for all Tab Stash data.
//

// istanbul ignore file
import {KVSCache} from "./datastore/kvs";
import KVSService from "./datastore/kvs/service";
import {resolveNamed} from "./util";
import {listen} from "./util/nanoservice";

import * as M from "./model";

export default async function (): Promise<M.Model> {
  const kvs = await resolveNamed({
    deleted_items: KVSService.open<string, M.DeletedItems.SourceValue>(
      "deleted_items",
      "deleted_items",
    ),
    favicons: KVSService.open<string, M.Favicons.Favicon>(
      "favicons",
      "favicons",
    ),
    bookmark_metadata: KVSService.open<
      string,
      M.BookmarkMetadata.BookmarkMetadata
    >("bookmark-metadata", "bookmark-metadata"),
  });

  const sources = await resolveNamed({
    browser_settings: M.BrowserSettings.Model.live(),
    options: M.Options.Model.live(),
    tabs: M.Tabs.Model.from_browser("background"),
    containers: M.Containers.Model.from_browser(),
    bookmarks: M.Bookmarks.Model.from_browser(),
    deleted_items: new M.DeletedItems.Model(kvs.deleted_items),
  });

  listen("deleted_items", kvs.deleted_items);
  listen("favicons", kvs.favicons);
  listen("bookmark-metadata", kvs.bookmark_metadata);

  const model = new M.Model({
    ...sources,
    favicons: new M.Favicons.Model(new KVSCache(kvs.favicons)),
    bookmark_metadata: new M.BookmarkMetadata.Model(
      new KVSCache(kvs.bookmark_metadata),
    ),
  });
  (<any>globalThis).model = model;
  return model;
}

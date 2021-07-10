// An instantiation of the model for use in the UI (as opposed to the background
// context)

// istanbul ignore file
import {resolveNamed} from './util';
import KVSClient from './datastore/kvs/client';
import {KVSCache} from './datastore/kvs';

import * as M from './model';

export default async function(): Promise<M.Model> {
    const sources = await resolveNamed({
        browser_settings: M.BrowserSettings.Model.live(),
        options: M.Options.Model.live(),
        tabs: M.Tabs.Model.from_browser(), // TODO load from cache
        bookmarks: M.Bookmarks.Model.from_browser(), // TODO load from cache
        deleted_items: new M.DeletedItems.Model(
            new KVSClient<string, M.DeletedItems.SourceValue>('deleted_items')),
    });

    const model = new M.Model({
        ...sources,
        favicons: new M.Favicons.Model(
            sources.tabs, new KVSCache(new KVSClient('favicons'))),
        bookmark_metadata: new M.BookmarkMetadata.Model(
            new KVSCache(new KVSClient('bookmark-metadata'))),
    });
    (<any>globalThis).model = model;
    return model;
}

// An instantiation of the model for use in the UI (as opposed to the background
// context)

// istanbul ignore file
import {resolveNamed} from './util';
import KVSClient from './datastore/kvs/client';

import {Model, BrowserSettings, Options, Tabs, Bookmarks, DeletedItems} from './model';

export default async function(): Promise<Model> {
    const sources = await resolveNamed({
        browser_settings: BrowserSettings.Model.live(),
        options: Options.Model.live(),
        tabs: Tabs.Model.from_browser(), // TODO load from cache
        bookmarks: Bookmarks.Model.from_browser(), // TODO load from cache
        deleted_items: new DeletedItems.Model(
            new KVSClient<string, DeletedItems.SourceValue>('deleted_items')),
    });

    const model = new Model(sources);
    (<any>globalThis).model = model;
    return model;
}

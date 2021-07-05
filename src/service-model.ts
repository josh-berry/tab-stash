//
// The model--a centralized place for all Tab Stash data.
//

// istanbul ignore file
import {resolveNamed} from './util';
import {listen} from './util/nanoservice';
import KVSService from './datastore/kvs/service';

import {Model, BrowserSettings, Options, Tabs, Bookmarks, DeletedItems} from './model';

export default async function(): Promise<Model> {
    const deleted_items_kvs_p = KVSService.open<string, DeletedItems.SourceValue>(
        'deleted_items', 'deleted_items');

    const sources = await resolveNamed({
        browser_settings: BrowserSettings.Model.live(),
        options: Options.Model.live(),
        tabs: Tabs.Model.from_browser(),
        bookmarks: Bookmarks.Model.from_browser(),
        deleted_items: deleted_items_kvs_p.then(kvs => new DeletedItems.Model(kvs)),
    });

    listen('deleted_items', await deleted_items_kvs_p);

    const model = new Model(sources);
    (<any>globalThis).model = model;
    return model;
};

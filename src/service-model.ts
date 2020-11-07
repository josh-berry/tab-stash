//
// The model--a centralized place for all Tab Stash data.
//

import {resolveNamed} from './util';
import {listen} from './util/nanoservice';
import KVSService from './datastore/kvs/service';

import {Model} from './model';
import {SourceValue} from './model/deleted-items';

export default async function(): Promise<Model> {
    const sources = await resolveNamed({
        deleted_items: KVSService.open<string, SourceValue>(
            'deleted_items', 'deleted_items'),
    });

    listen('deleted_items', sources.deleted_items);

    const model = new Model(sources);
    (<any>globalThis).model = model;
    return model;
};

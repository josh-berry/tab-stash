//
// The model--a centralized place for all Tab Stash data.
//

// istanbul ignore file
import {resolveNamed} from './util';
import {listen} from './util/nanoservice';
import KVSService from './datastore/kvs/service';

import {Model} from './model';
import * as Options from './model/options';
import * as DI from './model/deleted-items';

export default async function(): Promise<Model> {
    const sources = await resolveNamed({
        options: Options.Model.live(),
        deleted_items: KVSService.open<string, DI.SourceValue>(
            'deleted_items', 'deleted_items'),
    });

    listen('deleted_items', sources.deleted_items);

    const model = new Model({
        options: sources.options,
        deleted_items: new DI.Model(sources.deleted_items),
    });
    (<any>globalThis).model = model;
    return model;
};

// An instantiation of the model for use in the UI (as opposed to the background
// context)

// istanbul ignore file
import {resolveNamed} from './util';
import KVSClient from './datastore/kvs/client';

import {Model} from './model';
import * as Options from './model/options';
import * as DI from './model/deleted-items';

export default async function(): Promise<Model> {
    const sources = await resolveNamed({
        options: Options.Model.live(),
        deleted_items: new KVSClient<string, DI.SourceValue>('deleted_items'),
    });

    const model = new Model({
        options: sources.options,
        deleted_items: new DI.Model(sources.deleted_items),
    });
    (<any>globalThis).model = model;
    return model;
}

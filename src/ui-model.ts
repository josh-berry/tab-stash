// An instantiation of the model for use in the UI (as opposed to the background
// context)

import {resolveNamed} from './util';
import KVSClient from './datastore/kvs/client';

import {Model} from './model';
import * as Options from './model/options';
import * as DI from './model/deleted-items';

export default async function(): Promise<Model> {
    const sources = await resolveNamed({
        options: Options.live_source(),
        deleted_items: new KVSClient<string, DI.SourceValue>('deleted_items'),
    });

    const model = new Model(sources);
    (<any>globalThis).model = model;
    return model;
}

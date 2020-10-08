// An instantiation of the model for use in the UI (as opposed to the background
// context)

import {resolveNamed} from './util';
import KVSClient from './util/kvs/client';

import {Model} from './model';
import {SourceValue} from './model/deleted-items';

export default async function(): Promise<Model> {
    const sources = await resolveNamed({
        deleted_items: new KVSClient<string, SourceValue>('deleted_items'),
    });

    const model = new Model(sources);
    (<any>globalThis).model = model;
    return model;
}

// All Tab Stash data models live in here somewhere.
//
// This generally follows Vuex/the Flux design pattern, but I don't use Vuex
// because:
//
// <aside>
// I find Vuex to be proscriptive in ways that aren't
// helpful/actually hinder rapid development.  For example, with KVS-based
// models, I commonly want to keep a non-reactive Map which is a cache of
// records I've seen, so I can quickly tell what's part of the state already and
// what's new.  But this isn't possible with Vuex since it places strong limits
// on how the state is accessed during mutations.
//
// Also, a lot of these Vuex limitations seem to be driven by the need to keep
// the state read-only unless it's being accessed thru a mutation.  IMO this is
// done more reliably and with less runtime overhead at compile time.  So this
// is the approach I will take once I get the TypeScript typings worked out.
// </aside>
//
// That said, models generally export three things:
//
// - Source :: A type indicating the data source for the model (e.g. a KVS or
//   StoredObject).  A Source is usually necessary to construct a model, but
//   there may be several different implementations available (e.g. one for the
//   background process, one for the UI, and another for testing).
//
// - State :: A read-only, JSON-ifiable data structure which can be used to read
//   data out of the model.  The state is expected to be reactive so that Vue
//   can observe it.
//
// - Model :: The model itself--typically a class or other "smart" data
//   structure that uses the Source to produce the State, and provides methods
//   for mutating the State in various ways that a user might want to perform.
//   All the business logic resides here.
//
// By convention, a model's state is always available via the `.state` read-only
// property, and child models are available through child properties of their
// own.

import * as Options from './options';
import * as DeletedItems from './deleted-items';

export type Source = {
    readonly options: Options.Model,
    readonly deleted_items: DeletedItems.Model,
};

export class Model {
    readonly options: Options.Model;
    readonly deleted_items: DeletedItems.Model;
    // TODO For now just deleted_items is here; other stuff to come later

    constructor(sources: Source) {
        this.options = sources.options;
        this.deleted_items = sources.deleted_items;
    }
};

// All Tab Stash data models live in here somewhere.
//
// This generally follows Vuex/the Flux design pattern, but I find Vuex to be
// proscriptive in ways that aren't helpful/actually hinder rapid development.
// For example, with KVS-based models, I commonly want to keep a non-reactive
// Map which is a cache of records I've seen, so I can quickly tell what's part
// of the state already and what's new.  But this isn't possible with Vuex since
// it places strong limits on how the state is accessed during mutations.
//
// Also, a lot of these Vuex limitations seem to be driven by the need to keep
// the state read-only unless it's being accessed thru a mutation.  IMO this is
// done more reliably and with less runtime overhead at compile time.  So this
// is the approach I will take once I get the TypeScript typings worked out.

import Vue from 'vue';

import * as DeletedItems from './deleted-items';

export type Source = {
    readonly deleted_items: DeletedItems.Source,
};

export type State = {
    readonly deleted_items: DeletedItems.State,
};

export class Model {
    readonly state: State;

    readonly deleted_items: DeletedItems.Model;
    // TODO For now just deleted_items is here; other stuff to come later

    constructor(sources: Source) {
        this.deleted_items = new DeletedItems.Model(sources.deleted_items);

        this.state = Vue.observable({
            deleted_items: this.deleted_items.state,
        });
    }
};

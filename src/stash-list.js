"use strict";

import Vue from 'vue/dist/vue.runtime.esm';

import {asyncEvent, namedPromises} from './util';
import {rootFolder} from './stash';

import StashList from './stash-list.vue';

import {StashState} from './model';
import Options from './options-model';



window.addEventListener('load', asyncEvent(async function() {
    const p = await namedPromises({
        state: StashState.make(),
        root: rootFolder(),
        win: browser.windows.getCurrent(),
        curtab: browser.tabs.getCurrent(),
        extinfo: browser.management.getSelf(),
        localopts: Options.local(),
        syncopts: Options.sync(),
    });

    if (p.curtab) {
        document.body.classList.add('tab-view');
    }

    const vue = new (Vue.extend(StashList))({
        data: {
            unstashed_tabs: p.state.wins_by_id.get(p.win.id),
            stashed_tabs: p.state.bms_by_id.get(p.root.id),
            root_id: p.root.id,
            my_version: p.extinfo.version,
            local_options: p.localopts,
            sync_options: p.syncopts,
        },
    });

    vue.$mount('#app');

    // For debugging purposes only...
    window.stash_state = p.state;
    window.stash_root = p.state.bms_by_id.get(p.root.id);
    window.stash_win = p.state.wins_by_id.get(p.win.id);
    window.vue = vue;
}));

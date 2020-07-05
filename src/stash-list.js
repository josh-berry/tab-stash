"use strict";

import Vue from 'vue/dist/vue.runtime.esm';

import {asyncEvent, resolveNamed} from './util';
import {rootFolder, rootFolderWarning} from './stash';

import StashList from './stash-list.vue';

import {StashState} from './model';
import Options from './options-model';
import {Cache} from './cache-client';



window.addEventListener('load', asyncEvent(async function() {
    const p = await resolveNamed({
        state: StashState.make(),
        root: rootFolder(),
        win: browser.windows.getCurrent(),
        curtab: browser.tabs.getCurrent(),
        extinfo: browser.management.getSelf(),
        localopts: Options.local(),
        syncopts: Options.sync(),
        warning: rootFolderWarning(),
    });

    if (p.curtab) {
        document.documentElement.classList.add('tab-view');
    }

    const vue = new (Vue.extend(StashList))({
        data: {
            unstashed_tabs: p.state.wins_by_id.get(p.win.id),
            stashed_tabs: p.state.bms_by_id.get(p.root.id),
            root_id: p.root.id,
            my_version: p.extinfo.version,
            local_options: p.localopts,
            sync_options: p.syncopts,
            metadata_cache: Cache.open('bookmarks'),
            root_folder_warning: p.warning,
        },
    });

    vue.$mount('#app');

    // For debugging purposes only...
    window.metadata_cache = Cache.open('bookmarks');
    window.favicon_cache = Cache.open('favicons');
    window.stash_state = p.state;
    window.stash_root = p.state.bms_by_id.get(p.root.id);
    window.stash_win = p.state.wins_by_id.get(p.win.id);
    window.vue = vue;
    window.sync_options = p.syncopts;
    window.local_options = p.localopts;
}));

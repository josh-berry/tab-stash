"use strict";

import Vue from 'vue/dist/vue.runtime.esm';

import {nonReentrant, asyncEvent} from './util';
import {rootFolder, isTabStashable} from './stash';

import StashList from './stash-list.vue';

import {StashState} from './model';



window.addEventListener('load', asyncEvent(async function() {
    let state_p = StashState.make();
    let root_p = rootFolder();
    let win_p = browser.windows.getCurrent();
    let [state, root, win] = [await state_p, await root_p, await win_p];

    const vue = new (Vue.extend(StashList))({data: {
        unstashed_tabs: state.wins_by_id.get(win.id).children,
        stashed_tabs: state.bms_by_id.get(root.id).children,
        root_id: root.id,
    }});

    vue.$mount('#app');
}));

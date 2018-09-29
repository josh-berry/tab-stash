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
    let curtab_p = browser.tabs.getCurrent();
    let [state, root, win, curtab] = [
        await state_p, await root_p, await win_p, await curtab_p];

    const vue = new (Vue.extend(StashList))({data: {
        unstashed_tabs: state.wins_by_id.get(win.id),
        stashed_tabs: state.bms_by_id.get(root.id),
        root_id: root.id,
        is_open_in_tab: !!curtab,
    }});

    window.stash_state = state;
    window.stash_root = state.bms_by_id.get(root.id);
    window.stash_win = state.wins_by_id.get(win.id);

    vue.$mount('#app');
}));

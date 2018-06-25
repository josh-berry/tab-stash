"use strict";

import Vue from 'vue/dist/vue.runtime.esm';

import {nonReentrant, asyncEvent} from './util';
import {rootFolder, isTabStashable} from './stash';

import StashList from './stash-list.vue';

import {StashState} from './model';



window.addEventListener('load', asyncEvent(async function() {
    let state = await StashState.make();
    let root = await rootFolder();
    let win = await browser.windows.getCurrent();

    const vue = new (Vue.extend(StashList))({data: {
        unstashed_tabs: state.wins_by_id.get(win.id).children,
        stashed_tabs: state.bms_by_id.get(root.id).children,
    }});

    vue.$mount('#app');
}));

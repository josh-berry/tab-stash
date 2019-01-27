"use strict";

import Vue from 'vue/dist/vue.runtime.esm';

import {asyncEvent} from './util';
import OptionsView from './options.vue';
import Options from './options-model';

window.addEventListener('load', asyncEvent(async function() {
    let sync = await Options.get('sync');
    let local = await Options.get('local');
    const vue = new (Vue.extend(OptionsView))({data: {sync, local}});

    vue.$mount('#vue');
}));

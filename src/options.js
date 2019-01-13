"use strict";

import Vue from 'vue/dist/vue.runtime.esm';

import {asyncEvent} from './util';
import OptionsView from './options.vue';
import {Options} from './options-model';

window.addEventListener('load', asyncEvent(async function() {
    let state = await Options.make('sync');
    const vue = new (Vue.extend(OptionsView))({data: state});

    window.state = state;

    vue.$mount('#vue');
}));

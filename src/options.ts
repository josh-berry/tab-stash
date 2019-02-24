import Vue from 'vue';

import {asyncEvent} from './util';
import OptionsView from './options.vue';
import Options from './options-model';

window.addEventListener('load', asyncEvent(async function() {
    let sync = await Options.sync();
    let local = await Options.local();
    const vue = new (Vue.extend(OptionsView))({data: {sync, local}});

    vue.$mount('#vue');
}));

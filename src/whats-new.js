"use strict";

import Vue from 'vue/dist/vue.runtime.esm';

import WhatsNew from "./whats-new.vue";

(async function() {
    if (await browser.tabs.getCurrent()) {
        document.body.classList.add('tab-view');
    }

    const vue = new (Vue.extend(WhatsNew))();
    vue.$mount('#app');
})();

"use strict";

import Vue from 'vue/dist/vue.runtime.esm';

import WhatsNew from "./whats-new.vue";
import Options from "./options-model";

(async function() {
    if (await browser.tabs.getCurrent()) {
        document.body.classList.add('tab-view');
    }

    let extinfo = await browser.management.getSelf();
    let localopts = await Options.local();

    window.the_last_notified_version = localopts.last_notified_version;

    if (localopts.last_notified_version == extinfo.version) {
        // Show everything
        window.the_last_notified_version = undefined;
    } else {
        window.the_last_notified_version = localopts.last_notified_version;
        localopts.set({last_notified_version: extinfo.version});
    }

    const vue = new (Vue.extend(WhatsNew))();
    vue.$mount('#app');
})();

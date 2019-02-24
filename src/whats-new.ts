"use strict";

import Vue from 'vue';

import WhatsNew from "./whats-new.vue";
import Options from "./options-model";

(async function() {
    if (await browser.tabs.getCurrent()) {
        document.body.classList.add('tab-view');
    }

    let extinfo = await browser.management.getSelf();
    let localopts = await Options.local();

    let lnv: string | undefined;

    if (localopts.last_notified_version == extinfo.version) {
        // Show everything
        lnv = undefined;
    } else {
        lnv = localopts.last_notified_version;
        localopts.set({last_notified_version: extinfo.version});
    }

    const vue = new (Vue.extend(WhatsNew))({
        provide: () => ({
            the_last_notified_version: lnv,
        }),
    });
    vue.$mount('#app');
})();

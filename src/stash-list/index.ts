// istanbul ignore file -- launcher shim for the live UI

import browser from 'webextension-polyfill';

import {resolveNamed} from '../util';
import ui_model from '../ui-model';
import launch from '../launch-vue';

launch(require('./index.vue').default, async() => {
    const p = await resolveNamed({
        model: ui_model(),
        win: browser.windows.getCurrent(),
        cur_tab: browser.tabs.getCurrent(),
        ext_info: browser.management.getSelf(),
    });

    return {
        propsData: {
            window_id: p.win.id!,
            my_version: p.ext_info.version,
        },
        provide: {
            $model: p.model,
        },
        methods: {
            model() { return p.model; },
        },
    };
});

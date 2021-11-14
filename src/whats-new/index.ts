import browser from 'webextension-polyfill';

import {resolveNamed} from '../util';
import launch from '../launch-vue';

import * as Options from "../model/options";

launch(require('./index.vue').default, async() => {
    const r = await resolveNamed({
        options: Options.Model.live(),
        extn: browser.management.getSelf(),
    });
    (<any>globalThis).options = r.options;

    // If we are caught up to the current version, just show everything.
    const version = r.options.local.state.last_notified_version == r.extn.version
        ? undefined : r.options.local.state.last_notified_version;

    r.options.local.set({last_notified_version: r.extn.version});

    return {
        provide: {
            last_notified_version: version,
        },
        propsData: {},
    };
});

// An easy way to launch a Vue application, which also applies some CSS classes
// common to every UI in Tab Stash.

// istanbul ignore file

import browser from 'webextension-polyfill';
import {createApp, MethodOptions, ExtractPropTypes} from 'vue';

import {asyncEvent, resolveNamed} from './util';

import * as Options from './model/options';

export default function launch<
    C extends {props?: object, provide?: object, methods?: MethodOptions},
>(
    component: C,
    options: () => Promise<{
        propsData: Readonly<ExtractPropTypes<C["props"]>>,
        provide?: {[k: string]: any}
        methods?: MethodOptions & Partial<C["methods"]>,
    }>,
): void {
    const loader = async function() {
        switch (new URL(document.location.href).searchParams.get('view')) {
            case 'sidebar':
                document.documentElement.classList.add('view-sidebar');
                break;
            case 'popup':
                document.documentElement.classList.add('view-popup');
                break;
            default:
                document.documentElement.classList.add('view-tab');
                break;
        }

        const plat = await resolveNamed({
            browser: browser.runtime.getBrowserInfo ?
                browser.runtime.getBrowserInfo() : {name: 'chrome'},
            platform: browser.runtime.getPlatformInfo ?
                browser.runtime.getPlatformInfo() : {os: 'unknown'},
            options: Options.Model.live(),
        });

        document.documentElement.classList.add(`browser-${plat.browser.name.toLowerCase()}`);
        document.documentElement.classList.add(`os-${plat.platform.os}`);

        function updateStyle(opts: Options.SyncModel) {
            const classes = document.documentElement.classList;
            for (const c of Array.from(classes)) {
                if (c.startsWith('metrics-') || c.startsWith('theme-')) {
                    classes.remove(c);
                }
            }
            classes.add(`metrics-${opts.state.ui_metrics}`);
            classes.add(`theme-${opts.state.ui_theme}`);
        }
        updateStyle(plat.options.sync);
        plat.options.sync.onChanged.addListener(updateStyle);

        const opts = await options();
        const app = createApp({
            ...component,
            provide: {
                ...(component.provide ?? {}),
                ...(opts.provide ?? {}),
            },
            methods: {
                ...(component.methods ?? {}),
                ...(opts.methods ?? {}),
            },
        }, opts.propsData);
        Object.assign(<any>globalThis, {app, app_options: opts});
        app.mount('body');
    };
    window.addEventListener('load', asyncEvent(loader));
}

// Small helper function to pass our search parameters along to another sibling
// page in this extension, so the sibling page knows what environment it's in.
export function pageref(path: string): string {
    return `${path}${window.location.search}`
}

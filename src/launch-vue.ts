// An easy way to launch a Vue application, which also applies some CSS classes
// common to every UI in Tab Stash.

// istanbul ignore file

import {VueConstructor, ComponentOptions} from 'vue';

import {asyncEvent} from './util';

export default function launch<
    V extends Vue,
    C extends VueConstructor<V>,
    O extends ComponentOptions<V, any, any, any, any>
>(
    component: C, options: () => Promise<O>,
): void {
    const loader = async function() {
        switch (new URL(document.location.href).searchParams.get('view')) {
            case 'sidebar':
                break;
            default:
                document.documentElement.classList.add('tab-view');
                break;
        }

        const opts = await options();
        const vue = new component(opts);
        Object.assign(<any>globalThis, {vue, vue_options: opts});
        vue.$mount('main');
    };
    window.addEventListener('load', asyncEvent(loader));
}

// Small helper function to pass our search parameters along to another sibling
// page in this extension, so the sibling page knows what environment it's in.
export function pageref(path: string): string {
    return `${path}${window.location.search}`
}

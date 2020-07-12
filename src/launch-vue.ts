import {VueConstructor} from 'vue';

import {asyncEvent, resolveNamed, Promised} from './util';

type Data = {[k: string]: any};
type NoPromises<D extends Data> = {[k in keyof D]: Promised<D[k]>};

export default function<V extends VueConstructor, D>(
    component: V, promises: D | (() => Promise<D>),
): Promise<NoPromises<D>> {
    return new Promise((resolve, reject) => {
        window.addEventListener('load', asyncEvent(async function() {
            if (await browser.tabs.getCurrent()) {
                document.documentElement.classList.add('tab-view');
            }

            const data = await resolveNamed(
                promises instanceof Function ? await promises() : promises);
            const vue = new component({propsData: data});
            vue.$mount('main');

            Object.assign(<any>globalThis, {vue, data});

            resolve(data);
        }));
    });
}

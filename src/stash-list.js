"use strict";

import Vue from 'vue/dist/vue.runtime.esm';

import {IdleWorker} from './util';
import {tabStashTree} from './stash';

import StashList from './stash-list.vue';

// GUI stuff.  Depends on both Vue and index.js already being loaded.

window.addEventListener('load', () => {
    renderStashedTabs().then((tabs) => {
        let vue = new (Vue.extend(StashList))({data: {folders: tabs}});
        vue.$mount('#app');

        const w = new IdleWorker(async function() {
            let tabs = await renderStashedTabs();
            vue.folders = tabs;
        });

        const update = () => w.trigger();

        browser.bookmarks.onChanged.addListener(update);
        //browser.bookmarks.onChildrenReordered.addListener(update);
        browser.bookmarks.onCreated.addListener(update);
        //browser.bookmarks.onImportEnded.addListener(update);
        browser.bookmarks.onMoved.addListener(update);
        browser.bookmarks.onRemoved.addListener(update);
    });
});

async function renderStashedTabs() {
    let tree = await tabStashTree();

    return tree.children
        .filter((c) => c.type === 'folder')
        .map((c) => ({
            id: c.id,
            title: c.title,
            dateAdded: c.dateAdded,
            children: c.children
                .filter((l) => l.type !== 'folder')
                .map((l) => ({
                    id: l.id,
                    title: l.title,
                    dateAdded: l.dateAdded,
                    url: l.url,
                })),
        }));
}

"use strict";

import Vue from 'vue/dist/vue.runtime.esm';

import {
    STASH_FOLDER,
} from 'stash';

import StashList from 'stash-list.vue';
import 'folder-list.vue';
import 'folder.vue';
import 'saved-tab.vue';
import 'editable-label.vue';

// GUI stuff.  Depends on both Vue and index.js already being loaded.

window.addEventListener('load', () => {
    renderStashedTabs().then((tabs) => {
        let vue = new (Vue.extend(StashList))({data: {folders: tabs}});
        vue.$mount('#app');

        let update = () => {
            // XXX Probably very inefficient to regenerate the whole tree on
            // every update, but this is OK for now...
            renderStashedTabs().then((tabs) => {
                vue.folders = tabs;
            });
        };

        browser.bookmarks.onChanged.addListener(update);
        //browser.bookmarks.onChildrenReordered.addListener(update);
        browser.bookmarks.onCreated.addListener(update);
        //browser.bookmarks.onImportEnded.addListener(update);
        browser.bookmarks.onMoved.addListener(update);
        browser.bookmarks.onRemoved.addListener(update);
    });
});

async function renderStashedTabs() {
    let root = (await browser.bookmarks.search({title: STASH_FOLDER}))[0];
    if (! root) return [];

    let [tree] = await browser.bookmarks.getSubTree(root.id);

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

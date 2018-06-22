"use strict";

import Vue from 'vue/dist/vue.runtime.esm';

import {whenIdle, asyncEvent} from './util';
import {tabStashTree} from './stash';

import StashList from './stash-list.vue';

async function loadOpenTabs() {
}

async function renderStashedTabs() {
    let tree_p = tabStashTree();
    let windows_p = browser.windows.getAll(
        {populate: true, windowTypes: ['normal']});
    let [tree, windows] = [await tree_p, await windows_p];

    let tabs_by_url = new Map();
    let free_tabs_by_url = new Set();
    for (let w of windows) {
        for (let t of w.tabs) {
            tabs_by_url.set(t.url, t);
            free_tabs_by_url.add(t.url);
        }
    }

    let seen_urls = new Set();
    let stashed_tabs = tree.children
        .filter((c) => c.type === 'folder')
        .map((c) => ({
            id: c.id,
            title: c.title,
            dateAdded: c.dateAdded,
            children: c.children
                .filter((l) => l.type !== 'folder')
                .map(l => {
                    free_tabs_by_url.delete(l.url);
                    return {
                        id: l.id,
                        title: l.title,
                        dateAdded: l.dateAdded,
                        url: l.url,
                        tab: tabs_by_url.get(l.url),
                    };
                }),
        }));

    let free_tabs = (await browser.windows.getCurrent({populate: true}))
        .tabs.filter(t => free_tabs_by_url.has(t.url));

    return [stashed_tabs, free_tabs];
}

window.addEventListener('load', asyncEvent(async function() {
    // V(ue|iew)
    let vue = new (Vue.extend(StashList))({data: {
        stashed_tabs: [],
        free_tabs: [],
    }});
    vue.$mount('#app');

    // Controller
    const update = whenIdle(async function() {
        [vue.stashed_tabs, vue.free_tabs] = await renderStashedTabs();
    });

    // XXX this is all horribly inefficient since we regenerate EVERYTHING.  But
    // we are batching updates so it's probably fine...?
    browser.bookmarks.onChanged.addListener(update);
    browser.bookmarks.onCreated.addListener(update);
    browser.bookmarks.onMoved.addListener(update);
    browser.bookmarks.onRemoved.addListener(update);

    browser.tabs.onAttached.addListener(update);
    browser.tabs.onCreated.addListener(update);
    browser.tabs.onDetached.addListener(update);
    browser.tabs.onMoved.addListener(update);
    browser.tabs.onRemoved.addListener(update);
    browser.tabs.onReplaced.addListener(update);
    browser.tabs.onUpdated.addListener(update);

    update();
}));

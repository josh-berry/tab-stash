"use strict";

import Vue from 'vue/dist/vue.runtime.esm';

import {whenIdle, asyncEvent} from './util';
import {tabStashTree, isTabStashable} from './stash';

import StashList from './stash-list.vue';

async function loadOpenTabs() {
}

async function renderStashedTabs() {
    let tree_p = tabStashTree();
    let windows_p = browser.windows.getAll(
        {populate: true, windowTypes: ['normal']});
    let [tree, windows] = [await tree_p, await windows_p];

    let tabs_by_url = new Map();
    for (let w of windows) {
        for (let t of w.tabs) {
            tabs_by_url.set(t.url, t);
        }
    }

    let stashed_tabs = tree.children
        .filter((c) => c.type === 'folder')
        .map((c) => ({
            id: c.id,
            title: c.title,
            dateAdded: c.dateAdded,
            children: c.children
                .filter((l) => l.type !== 'folder')
                .map(l => {
                    let t = tabs_by_url.get(l.url);
                    tabs_by_url.delete(l.url);
                    return {
                        id: l.id,
                        bm: l,
                        tab: t,
                    };
                }),
        }));

    let win = (await browser.windows.getCurrent({populate: true}));

    let unstashed_tabs = win.tabs
        .filter(t => tabs_by_url.has(t.url) && isTabStashable(t))
        .map(t => ({id: t.id, tab: t}));
    return [stashed_tabs, unstashed_tabs];
}

window.addEventListener('load', asyncEvent(async function() {
    // V(ue|iew)
    let vue = new (Vue.extend(StashList))({data: {
        unstashed_tabs: [],
        stashed_tabs: [],
    }});
    vue.$mount('#app');

    // Controller
    const update = whenIdle(async function() {
        let [stashed, unstashed] = await renderStashedTabs();
        vue.stashed_tabs = stashed;
        vue.unstashed_tabs = unstashed;
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

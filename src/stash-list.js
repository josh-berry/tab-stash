"use strict";

import Vue from 'vue/dist/vue.runtime.esm';

import {whenIdle, asyncEvent} from './util';
import {tabStashTree, isTabStashable} from './stash';

import StashList from './stash-list.vue';

async function renderStashedTabs(known_tab_ids) {
    let tree_p = tabStashTree();

    // NOTE: We make fresh new deep-copied objects for Vue because it likes to
    // modify objects in-place, and then browser APIs start returning those
    // modified Vue objects sometimes, which makes me really nervous...
    const clone_tab = t => ({
        id: t.id,
        title: t.title,
        url: t.url,
        favIconUrl: t.favIconUrl,
        hidden: t.hidden,
        active: t.active,
    });

    // Look at what tabs are open in the current window, and index them by URL
    // so we can match bookmarks to tabs later.  We only care about the current
    // window, since restoreTabs() also only looks at the current window.
    let win = await browser.windows.getCurrent({populate: true});
    let tabs_by_url = new Map();
    for (let t of win.tabs) {
        if (! known_tab_ids.has(t.id)) continue;
        tabs_by_url.set(t.url, clone_tab(t));
    }

    let stashed_tabs = (await tree_p).children
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
                        bm: {
                            id: l.id,
                            title: l.title,
                            url: l.url,
                        },
                        tab: t,
                    };
                }),
        }));

    let unstashed_tabs = win.tabs
        .filter(t => known_tab_ids.has(t.id) && tabs_by_url.has(t.url)
                  && isTabStashable(t))
        .map(t => ({id: t.id, tab: clone_tab(t)}));
    return [stashed_tabs, unstashed_tabs];
}

window.addEventListener('load', asyncEvent(async function() {
    const vue = new (Vue.extend(StashList))({data: {
        unstashed_tabs: [],
        stashed_tabs: [],
    }});
    vue.$mount('#app');

    // XXX HACK This known_tab_ids nonsense is because Firefox will sometimes
    // include tabs that have already been closed in the list of tabs for the
    // current window.  If we see a removed event, we remember the ID so we can
    // explicitly exclude these dangling tabs from what we show the user.  We
    // basically don't ever seem to be able to clean this list up, because
    // things seem to reappear...?
    const known_tab_ids = new Set(
        (await browser.windows.getCurrent({populate: true}))
            .tabs.map(t => t.id));

    const update = whenIdle(async function() {
        let [stashed, unstashed] = await renderStashedTabs(known_tab_ids);
        vue.stashed_tabs = stashed;
        vue.unstashed_tabs = unstashed;
    });

    const tabAdd = id => {
        known_tab_ids.add(id);
        update();
    };

    const tabRemove = id => {
        known_tab_ids.delete(id);
        update();
    };

    const tabReplace = (new_id, old_id) => {
        known_tab_ids.delete(old_id);
        known_tab_ids.add(new_id);
        update();
    };

    // XXX this is all horribly inefficient since we regenerate EVERYTHING.  But
    // we are batching updates so it's probably fine...?
    browser.bookmarks.onChanged.addListener(update);
    browser.bookmarks.onCreated.addListener(update);
    browser.bookmarks.onMoved.addListener(update);
    browser.bookmarks.onRemoved.addListener(update);

    browser.tabs.onAttached.addListener(tabAdd);
    browser.tabs.onCreated.addListener(tabAdd);
    browser.tabs.onDetached.addListener(tabRemove);
    browser.tabs.onMoved.addListener(tabAdd);
    browser.tabs.onRemoved.addListener(tabRemove);
    browser.tabs.onReplaced.addListener(tabReplace);
    browser.tabs.onUpdated.addListener(tabAdd);

    update();
}));

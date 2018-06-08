"use strict";

import {stashAllTabs, restoreTabs} from 'stash';

browser.menus.create({
    contexts: ['browser_action', 'tab', 'tools_menu'],
    title: 'Stashed Tabs (Sidebar)',
    id: 'show-stashed-tabs-sidebar'
});

browser.menus.create({
    contexts: ['browser_action', 'tab', 'tools_menu'],
    title: 'Stashed Tabs (New Tab)',
    id: 'show-stashed-tabs-tab'
});

browser.menus.onClicked.addListener((info, tab) => {
    if (info.menuItemId == 'show-stashed-tabs-sidebar') {
        browser.sidebarAction.open().then(() => {});
    } else if (info.menuItemId == 'show-stashed-tabs-tab') {
        restoreTabs([browser.extension.getURL('stash-list.html')])
            .then(() => {});
    }
});

browser.browserAction.onClicked.addListener(() => {
    stashAllTabs(undefined).then(() => {});
});

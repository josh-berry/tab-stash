"use strict";

import {stashOpenTabs, stashFrontTab, restoreTabs} from 'stash';

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
        browser.sidebarAction.open().catch(console.log);
    } else if (info.menuItemId == 'show-stashed-tabs-tab') {
        restoreTabs([browser.extension.getURL('stash-list.html')])
            .catch(console.log);
    }
});

browser.browserAction.onClicked.addListener(() => {
    stashOpenTabs(undefined).catch(console.log);
});

browser.pageAction.onClicked.addListener(() => {
    stashFrontTab(undefined).catch(console.log);
});

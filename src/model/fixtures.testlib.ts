import browser from 'webextension-polyfill';

import * as events from '../mock/events';

import type {Bookmark} from './bookmarks';
import type {Tab} from './tabs';

export type TabSetup = {
    windows: {[k: string]: {id: number, tabs: Tab[]}},
    tabs: {[k: string]: Tab},
};

export async function make_bookmarks(): Promise<{[k: string]: Bookmark}> {
    const forest: Bookmark[] = [
        {id: 'tools', title: 'Toolbar', children: [
            {id: 'likes', title: 'Likes', children: [
                {id: 'foo', title: 'Foo', url: '/foo'},
                {id: 'bar', title: 'Bar', url: '/bar'},
            ]},
            {id: 'ok', title: 'Okay', url: '/ok'},
        ]},
        {id: 'menu', title: 'Menu', children: [
            {id: 'foo2', title: 'Foo', url: '/foo'},
            {id: 'empty', title: 'Empty Folder', children: []},
            {id: 'sep', title: '', type: 'separator'}, // For Firefox
            {id: 'a', title: 'a', url: '/a'},
            {id: 'subfolder', title: 'Subfolder', children: [
                {id: 'b', title: 'b', url: '/b'},
                {id: 'c', title: 'c', url: '/c'},
                {id: 'd', title: 'd', url: '/d'},
            ]},
        ]},
    ];

    const res: {[k: string]: Bookmark} = {};

    async function gen(bm: Bookmark, parentId: string | undefined): Promise<Bookmark> {
        // istanbul ignore if
        if (bm.id in res) throw new Error(`Duplicate bookmark ID ${bm.id}`);
        res[bm.id] = await browser.bookmarks.create({...bm, parentId});
        if (! bm.children) return res[bm.id];

        let i = 0;
        const new_kids: Bookmark[] = [];
        res[bm.id].children = new_kids;
        for (const c of bm.children) {
            c.parentId = res[bm.id].id;
            c.index = i;
            new_kids.push(await gen(c, res[bm.id].id));
            ++i;
        }

        return res[bm.id];
    }

    for (const root of forest) await gen(root, undefined);
    await events.watch(browser.bookmarks.onCreated).untilNextTick();
    return res;
}

export async function make_tabs(): Promise<TabSetup> {
    const wins = {
        one: [
            {id: 'foo', url: 'foo', active: true},
            {id: 'bar', url: 'bar'},
            {id: 'fred', url: 'fred'},
        ],
        two: [
            {id: 'robert1', url: 'robert', active: true},
            {id: 'robert2', url: 'robert'},
            {id: 'foo2', url: 'foo'},
        ]
    };

    const windows: TabSetup['windows'] = {};
    const tabs: TabSetup['tabs'] = {};
    for (const w in wins) {
        const win = await browser.windows.create();
        await events.next(browser.windows.onCreated);
        await events.next(browser.tabs.onCreated);
        await events.next(browser.windows.onFocusChanged);
        await events.next(browser.tabs.onActivated);

        const win_tabs = [];
        let i = 0;
        for (const t of wins[w as keyof typeof wins]) {
            const tab = await browser.tabs.create({
                windowId: win.id, url: t.url,
                active: !!t.active
            });
            await events.next(browser.tabs.onCreated);
            if (t.active) await events.next(browser.tabs.onActivated);

            tab.windowId = win.id;
            tab.index = i;
            tabs[t.id] = tab as Tab;
            win_tabs.push(tab as Tab);
            ++i;
        }
        await browser.tabs.remove(win.tabs![0].id!);
        await events.next(browser.tabs.onRemoved);
        windows[w] = {id: win.id!, tabs: win_tabs};
    }

    return {windows, tabs};
}

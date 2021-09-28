import browser from 'webextension-polyfill';

import * as events from '../mock/events';

import type {Bookmark} from './bookmarks';
import type {Tab} from './tabs';

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
            {id: 'empty', title: 'Empty Folder'},
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

    async function gen(bm: Bookmark, parentId: string | undefined) {
        // istanbul ignore if
        if (bm.id in res) throw new Error(`Duplicate bookmark ID ${bm.id}`);
        res[bm.id] = await browser.bookmarks.create({...bm, parentId});
        if (! bm.children) return;

        let i = 0;
        for (const c of bm.children) {
            c.parentId = res[bm.id].id;
            c.index = i;
            await gen(c, res[bm.id].id);
            ++i;
        }
    }

    for (const root of forest) await gen(root, undefined);
    await events.watch(browser.bookmarks.onCreated).untilNextTick();
    return res;
}

export function tabs(): Tab[] {
    const windows: Partial<Tab>[][] = [
        [
            {url: 'foo'},
            {url: 'bar'},
            {url: 'fred'},
        ],
        [
            {url: 'robert'},
            {url: 'robert'},
            {url: 'foo'},
        ]
    ];

    const tabs: Tab[] = [];
    let windowId = 0;
    let id = 0;
    for (const w of windows) {
        let index = 0;
        for (const t of w) {
            tabs.push(make_tab({...t, id, windowId, index}))
            ++id;
            ++index;
        }
        ++windowId;
    }

    return tabs;
}

export function make_tab(
    t: Partial<Tab> & {id: number, windowId: number, index: number}
): Tab {
    return {
        incognito: false,
        hidden: false,
        pinned: false,
        active: false,
        highlighted: false,
        ...t
    };
}

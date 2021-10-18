/**
 * Fake data/setup for tests of Tab Stash models.  The data here is intended to
 * be used both in unit/mock tests and in tests run against a real browser.
 */

import {expect} from 'chai';
import browser, {Bookmarks, Windows, Tabs} from 'webextension-polyfill';

import * as events from '../mock/events';

import type {NodeID} from './bookmarks';
import type {Tab} from './tabs';

export const B = 'about:blank';

export const TEST_TAG = `Tab Stash Automated Test`;
export const TEST_ROOT_NAME = `${TEST_TAG} - OK to delete`;
export const STASH_ROOT_NAME = `${TEST_TAG} - Stash Root`;

/** Test browser windows.  We should try to keep the number of windows to a
 * minimum since in real-world tests, all of these windows will be created for
 * each test (where windows are used). */
const WINDOWS = {
    left: [
        {id: 'left_alice', url: `${B}#alice`, active: true},
        {id: 'left_betty', url: `${B}#betty`},
        {id: 'left_charlotte', url: `${B}#charlotte`},
    ],
    right: [
        {id: 'right_blank', url: `${B}`, active: true},
        {id: 'right_adam', url: `${B}#adam`},
        {id: 'right_doug', url: `${B}#doug`},
    ],
    real: [
        {id: 'real_patricia', url: `${B}#patricia`, pinned: true},
        {id: 'real_paul', url: `${B}#paul`, pinned: true},
        {id: 'real_blank', url: `${B}`, active: true},
        {id: 'real_bob', url: `${B}#bob`},
        {id: 'real_doug', url: `${B}#doug`},
        {id: 'real_doug_2', url: `${B}#doug`, hidden: true},
        {id: 'real_estelle', url: `${B}#estelle`},
        {id: 'real_francis', url: `${B}#francis`},
        {id: 'real_harry', url: `${B}#harry`, hidden: true},
        {id: 'real_helen', url: `${B}#helen`, hidden: true},
    ],
} as const;

export type TabFixture = {
    windows: {[k in WindowName]: Windows.Window & {id: string}},
    tabs: {[k in TabName]: Tabs.Tab & {id: string}},
};
type WindowName = keyof typeof WINDOWS;
type TabName = (typeof WINDOWS)[WindowName][any]['id'];



const BOOKMARKS = {
    id: 'root', title: TEST_ROOT_NAME, children: [
        {id: 'doug_1', title: 'Doug Duplicate', url: `${B}#doug`},
        {id: 'francis', title: 'Francis Favorite', url: `${B}#francis`},
        {id: 'outside', title: 'Outside - A/B Names', children: [
            {id: 'alice', title: 'Alice', url: `${B}#alice`},
            {id: 'separator', title: '', type: 'separator'},
            {id: 'bob', title: 'Bob', url: `${B}#bob`},
            {id: 'empty', title: 'Empty Folder', children: []},
        ]},
        {id: 'stash_root', title: STASH_ROOT_NAME, children: [
            {id: 'names', title: 'Names', children: [
                {id: 'doug_2', title: 'Doug Duplicate', url: `${B}#doug`},
                {id: 'helen', title: 'Helen Hidden', url: `${B}#helen`},
                {id: 'patricia', title: 'Patricia Pinned', url: `${B}#patricia`},
                {id: 'nate', title: 'Nate NotOpen', url: `${B}#nate`},
            ]},
            {id: 'unnamed', title: 'saved-1970-01-01T00:00:00.000Z', children: [
                {id: 'undyne', title: 'Undyne Unnamed', url: `${B}#undyne`},
            ]},
        ]},
    ],
} as const;

export type BookmarkFixture = {
    [k in BookmarkName]: Bookmarks.BookmarkTreeNode & {id: NodeID, parentId: NodeID}
};
type BookmarkName = BookmarkNamesHere<typeof BOOKMARKS>;
type BookmarkNamesHere<B extends NamedBookmark> = B['id']
    | (B extends NamedBookmarkFolder ? BookmarkNamesHere<B['children'][any]> : never);

interface NamedBookmark {
    readonly id: string,
    readonly children?: readonly NamedBookmark[],
}
interface NamedBookmarkFolder {
    readonly id: string,
    readonly children: readonly NamedBookmark[],
}



export async function make_bookmarks(): Promise<BookmarkFixture> {
    // TODO: Cleanup from any prior failed runs (if we're in a real browser)
    const res: Partial<BookmarkFixture> = {};

    async function gen(id: BookmarkName, bm: any, parentId: string | undefined): Promise<Bookmarks.BookmarkTreeNode> {
        // istanbul ignore if
        if (id in res) throw new Error(`Duplicate bookmark ID ${bm.id}`);
        res[id] = await browser.bookmarks.create({...bm, parentId}) as any;
        await events.next(browser.bookmarks.onCreated);
        if (! bm.children) return res[id]!;

        let i = 0;
        const new_kids: Bookmarks.BookmarkTreeNode[] = [];
        res[id]!.children = new_kids;
        for (const c of bm.children) {
            c.parentId = res[id]!.id;
            c.index = i;
            new_kids.push(await gen(c.id as BookmarkName, c, res[id]!.id));
            ++i;
        }

        return res[id]!;
    }

    await gen(BOOKMARKS.id, BOOKMARKS, undefined);
    expect(events.pendingCount()).to.equal(0);
    return res as BookmarkFixture;
}



export async function make_tabs(): Promise<TabFixture> {
    // TODO: Cleanup from any prior failed runs (if we're in a real browser)
    const windows: Partial<TabFixture['windows']> = {};
    const tabs: Partial<TabFixture['tabs']> = {};
    for (const w in WINDOWS) {
        const win = await browser.windows.create();
        await events.next(browser.windows.onCreated);
        await events.next(browser.tabs.onCreated);
        await events.next(browser.windows.onFocusChanged);
        await events.next(browser.tabs.onActivated);

        // istanbul ignore if -- browser compatibility and type safety
        if (! win.tabs) win.tabs = [];
        let i = 0;
        for (const tab_def of WINDOWS[w as keyof typeof WINDOWS]) {
            const t = tab_def as unknown as Tab;
            const tab = await browser.tabs.create({
                windowId: win.id, url: t.url,
                active: !!t.active
            });
            await events.next(browser.tabs.onCreated);
            if (t.active) await events.next(browser.tabs.onActivated);

            tab.windowId = win.id;
            tab.index = i;
            tabs[tab_def.id] = tab as Tab & {id: string};
            win.tabs.push(tab);
            ++i;
        }

        // Remove the "default" tab opened with the new window
        await browser.tabs.remove(win.tabs![0].id!);
        win.tabs!.shift();
        await events.next(browser.tabs.onRemoved);

        windows[w as keyof typeof WINDOWS] = win as Windows.Window & {id: string};
    }

    expect(events.pendingCount()).to.equal(0);
    return {
        windows: windows as TabFixture['windows'],
        tabs: tabs as TabFixture['tabs'],
    };
}

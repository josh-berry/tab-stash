/**
 * Fake data/setup for tests of Tab Stash models.  The data here is intended to
 * be used both in unit/mock tests and in tests run against a real browser.
 */

import {expect} from "chai";
import browser, {
  type Bookmarks,
  type Tabs,
  type Windows,
} from "webextension-polyfill";

import * as events from "../mock/events";

import {Options} from ".";
import type {KeyValueStore} from "../datastore/kvs";
import type * as BookmarkMetadata from "./bookmark-metadata";
import type {NodeID} from "./bookmarks";
import type * as DeletedItems from "./deleted-items";
import type * as Favicons from "./favicons";
import type {Tab, TabID, WindowID} from "./tabs";

//
// The test data.
//
// This is at the very top just below imports so it's easy to refer to.
//

export const B = "about:blank";

export const TEST_TAG = `Tab Stash Automated Test`;
export const TEST_ROOT_NAME = `${TEST_TAG} - OK to delete`;
export const STASH_ROOT_NAME = `${TEST_TAG} - Stash Root`;

/** Test browser windows.  We should try to keep the number of windows to a
 * minimum since in real-world tests, all of these windows will be created for
 * each test (where windows are used). */
const WINDOWS = {
  left: [
    {id: "left_alice", url: `${B}#alice`, active: true},
    {id: "left_betty", url: `${B}#betty`},
    {id: "left_charlotte", url: `${B}#charlotte`},
  ],
  right: [
    {id: "right_blank", url: `${B}`, active: true},
    {id: "right_adam", url: `${B}#adam`},
    {id: "right_doug", url: `${B}#doug`},
  ],
  real: [
    {id: "real_patricia", url: `${B}#patricia`, pinned: true},
    {id: "real_paul", url: `${B}#paul`, pinned: true},
    {id: "real_blank", url: `${B}`, active: true},
    {id: "real_bob", url: `${B}#bob`},
    {id: "real_doug", url: `${B}#doug`},
    {id: "real_doug_2", url: `${B}#doug`, hidden: true},
    {id: "real_estelle", url: `${B}#estelle`},
    {id: "real_francis", url: `${B}#francis`},
    {id: "real_harry", url: `${B}#harry`, hidden: true},
    {id: "real_unstashed", url: `${B}#unstashed`},
    {id: "real_helen", url: `${B}#helen`, hidden: true},
  ],
} as const;

const BOOKMARKS = {
  id: "root",
  title: TEST_ROOT_NAME,
  children: [
    {id: "doug_1", title: "Doug Duplicate", url: `${B}#doug`},
    {id: "francis", title: "Francis Favorite", url: `${B}#francis`},
    {
      id: "outside",
      title: "Outside - A/B Names",
      children: [
        {id: "alice", title: "Alice", url: `${B}#alice`},
        {id: "separator", title: "", type: "separator"},
        {id: "bob", title: "Bob", url: `${B}#bob`},
        {id: "empty", title: "Empty Folder", children: []},
      ],
    },
    {
      id: "stash_root",
      title: STASH_ROOT_NAME,
      children: [
        {
          id: "names",
          title: "Names",
          children: [
            {id: "doug_2", title: "Doug Duplicate", url: `${B}#doug`},
            {id: "helen", title: "Helen Hidden", url: `${B}#helen`},
            {id: "patricia", title: "Patricia Pinned", url: `${B}#patricia`},
            {id: "nate", title: "Nate NotOpen", url: `${B}#nate`},
          ],
        },
        {
          id: "unnamed",
          title: "saved-1970-01-01T00:00:00.000Z",
          children: [
            {id: "undyne", title: "Undyne Unnamed", url: `${B}#undyne`},
          ],
        },
        {
          id: "big_stash",
          title: "Big Stash",
          children: [
            {id: "one", title: "One", url: `${B}#1`},
            {id: "two", title: "Two", url: `${B}#2`},
            {id: "three", title: "Three", url: `${B}#3`},
            {id: "four", title: "Four", url: `${B}#4`},
            {id: "five", title: "Five", url: `${B}#5`},
            {id: "six", title: "Six", url: `${B}#6`},
            {id: "seven", title: "Seven", url: `${B}#7`},
            {id: "eight", title: "Eight", url: `${B}#8`},
          ],
        },
        {
          id: "nested",
          title: "Stash with Nested Folder",
          children: [
            {id: "nested_1", title: "Nested 1", url: `${B}#nested_1`},
            {
              id: "nested_child",
              title: "Nested Child",
              children: [
                {id: "nested_child_1", title: "1", url: `${B}#nested_child_1`},
              ],
            },
            {id: "nested_2", title: "Nested 2", url: `${B}#nested_2`},
            {
              id: "nested_3",
              title: "Extra",
              children: [{id: "two_two", title: "Two", url: `${B}#2`}],
            },
          ],
        },
      ],
    },
  ],
} as const;

const BOOKMARK_METADATA: BookmarkMetadataFixture = {
  unnamed: {collapsed: true},
  nonexistent: {collapsed: true},
};

/** List of URLs with favicons in the cache.  The favIconUrls themselves are
 * generated from the page URLs. */
const FAVICONS: string[] = [
  `${B}#doug`,
  `${B}#nate`,
  `${B}#alice`,
  `${B}#betty`,
  `${B}#undyne`,
  `${B}#sir-not-appearing-in-this-film`,
];

/** List of deleted items.  The deletion time is calculated automatically since
 * it must be relative to Date.now() for various things like GC to work
 * correctly--that is, we can't hard-code the timestamps.
 *
 * Newest items should be listed first (just like the UI and model). */
const DELETED_ITEMS: Omit<DeletedItems.SourceValue, "deleted_at">[] = [
  {
    item: {
      title: "Deleted Bookmark from Folder with Matching ID",
      url: `${B}#deleted`,
      favIconUrl: `${B}#deleted.ico`,
    },
    deleted_from: {folder_id: "names", title: "Names"},
  },
  {
    item: {
      title: "Deleted Bookmark from Folder with Matching Title",
      url: `${B}#gone`,
      favIconUrl: `${B}#gone.ico`,
    },
    deleted_from: {folder_id: "invalid-folder-id", title: "Names"},
  },
  {
    item: {
      title: "Deleted Folder",
      children: [
        {title: "Child 1", url: `${B}#deleted-child-1`},
        {title: "Child 2", url: `${B}#deleted-child-2`},
        {title: "Child 3", url: `${B}#deleted-child-3`},
      ],
    },
  },
  {
    item: {
      title: "Deleted Bookmark from Deleted Folder",
      url: `${B}#deleted2`,
      favIconUrl: `${B}#deleted2.ico`,
    },
    deleted_from: {folder_id: "y-a-invalid-bm-id", title: "Deleted Folder"},
  },
  {
    item: {title: "Older Deleted Bookmark", url: `${B}#older-deleted`},
  },
];

//
// Types for the test data.
//

export type TabFixture = {
  windows: {[k in WindowName]: Windows.Window & {id: WindowID}};
  tabs: {[k in TabName]: Tabs.Tab & {id: TabID}};
};
type WindowName = keyof typeof WINDOWS;
type TabName = (typeof WINDOWS)[WindowName][any]["id"];

export type BookmarkFixture = {
  [k in BookmarkName]: Bookmarks.BookmarkTreeNode & {
    id: NodeID;
    parentId: NodeID;
  };
};
type BookmarkName = BookmarkNamesHere<typeof BOOKMARKS>;
type BookmarkNamesHere<B extends NamedBookmark> =
  | B["id"]
  | (B extends NamedBookmarkFolder
      ? BookmarkNamesHere<B["children"][any]>
      : never);
interface NamedBookmark {
  readonly id: string;
  readonly children?: readonly NamedBookmark[];
}
interface NamedBookmarkFolder {
  readonly id: string;
  readonly children: readonly NamedBookmark[];
}

type BookmarkMetadataFixture = Partial<{
  [k: string]: BookmarkMetadata.BookmarkMetadata;
}>;

//
// How to load the test data into the test.
//
// For bookmarks/tabs, this is typically done directly against browser.*, which
// may be a live or a mock implementation.  For things that go into a KVS, the
// KVS can be passed as a parameter.
//

export async function make_bookmarks(): Promise<BookmarkFixture> {
  // TODO: Cleanup from any prior failed runs (if we're in a real browser)
  const res: Partial<BookmarkFixture> = {};

  async function gen(
    id: BookmarkName,
    bm: any,
    parentId: string | undefined,
  ): Promise<Bookmarks.BookmarkTreeNode> {
    // istanbul ignore if
    if (id in res) throw new Error(`Duplicate bookmark ID ${bm.id}`);
    res[id] = (await browser.bookmarks.create({...bm, parentId})) as any;
    await events.next(browser.bookmarks.onCreated);
    if (!bm.children) return res[id]!;

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
  const windows: Partial<TabFixture["windows"]> = {};
  const tabs: Partial<TabFixture["tabs"]> = {};
  for (const w in WINDOWS) {
    const win = await browser.windows.create();
    await events.next(browser.windows.onCreated);
    await events.next(browser.tabs.onCreated);
    await events.next(browser.windows.onFocusChanged);
    await events.next(browser.tabs.onActivated);
    await events.next(browser.tabs.onHighlighted);
    await events.next(browser.tabs.onUpdated);

    // istanbul ignore if -- browser compatibility and type safety
    if (!win.tabs) win.tabs = [];
    let i = 0;
    for (const tab_def of WINDOWS[w as keyof typeof WINDOWS]) {
      const t = tab_def as unknown as Tab;
      const tab = await browser.tabs.create({
        windowId: win.id,
        url: t.url,
        active: !!t.active,
        pinned: !!t.pinned,
      });
      await events.next(browser.tabs.onCreated);
      await events.next(browser.tabs.onUpdated);
      if (t.active) {
        await events.next(browser.tabs.onActivated);
        await events.next(browser.tabs.onHighlighted);
      }

      if (t.hidden) {
        await browser.tabs.hide([tab.id!]);
        await events.next(browser.tabs.onUpdated);
        tab.hidden = true;
      }

      tab.windowId = win.id;
      tab.index = i;
      tabs[tab_def.id] = tab as Tabs.Tab & {id: TabID};
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
    windows: windows as TabFixture["windows"],
    tabs: tabs as TabFixture["tabs"],
  };
}

export async function make_bookmark_metadata(
  kvs: KeyValueStore<string, BookmarkMetadata.BookmarkMetadata>,
  bms: BookmarkFixture,
): Promise<void> {
  await kvs.set(
    Object.keys(BOOKMARK_METADATA).map(k => ({
      key: bms[k as BookmarkName]?.id ?? k,
      value: BOOKMARK_METADATA[k]!,
    })),
  );
  await events.next(kvs.onSet);
}

export async function make_favicons(
  kvs: KeyValueStore<string, Favicons.Favicon>,
): Promise<void> {
  await kvs.set(
    FAVICONS.map(url => ({
      key: url,
      value: {favIconUrl: `${url}.favicon`},
    })),
  );
  await events.next(kvs.onSet);
}

export async function make_deleted_items(
  kvs: KeyValueStore<string, DeletedItems.SourceValue>,
): Promise<void> {
  const increment_ms =
    (Options.SYNC_DEF.deleted_items_expiration_days.default *
      24 *
      60 *
      60 *
      1000) /
    (DELETED_ITEMS.length - 1);

  let deleted_at = Date.now();
  await kvs.set(
    DELETED_ITEMS.map(item => {
      deleted_at -= increment_ms;
      return {
        key: `${new Date(deleted_at).toISOString()}-rand`,
        value: {
          deleted_at: new Date(deleted_at).toISOString(),
          ...item,
        },
      };
    }),
  );
  await events.next(kvs.onSet);
}

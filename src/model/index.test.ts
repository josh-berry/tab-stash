// Functional tests for Tab Stash, intended to mirror real-world user
// activities.

import {expect} from 'chai';
import browser from 'webextension-polyfill';

import * as events from '../mock/events';
import storage_mock from '../mock/browser/storage';
import {
    BookmarkFixture, TabFixture, B, STASH_ROOT_NAME,
    make_tabs, make_bookmarks, make_bookmark_metadata, make_deleted_items,
    make_favicons,
} from './fixtures.testlib';

import * as M from '.';
import {KeyValueStore, KVSCache} from '../datastore/kvs';
import MemoryKVS from '../datastore/kvs/memory';
import {_StoredObjectFactory} from '../datastore/stored-object';
import {LOCAL_DEF, SYNC_DEF} from './options';
import {TabID} from './tabs';

describe('model', () => {
    let tabs: TabFixture["tabs"];
    let windows: TabFixture["windows"];
    let bookmarks: BookmarkFixture;

    let bookmark_metadata: KeyValueStore<string, M.BookmarkMetadata.BookmarkMetadata>;
    let favicons: KeyValueStore<string, M.Favicons.Favicon>;
    let deleted_items: KeyValueStore<string, M.DeletedItems.SourceValue>;

    let model: M.Model;

    beforeEach(async () => {
        storage_mock.reset();
        const stored_object_factory = new _StoredObjectFactory();

        const tw = await make_tabs();
        tabs = tw.tabs;
        windows = tw.windows;
        bookmarks = await make_bookmarks();

        bookmark_metadata = new MemoryKVS("bookmark_metadata");
        await make_bookmark_metadata(bookmark_metadata, bookmarks);

        favicons = new MemoryKVS("favicons");
        await make_favicons(favicons);

        deleted_items = new MemoryKVS("deleted_items");
        await make_deleted_items(deleted_items);

        const tab_model = await M.Tabs.Model.from_browser();
        const bm_model = await M.Bookmarks.Model.from_browser(STASH_ROOT_NAME);
        model = new M.Model({
            browser_settings: await M.BrowserSettings.Model.live(),
            options: new M.Options.Model({
                sync: await stored_object_factory.get('sync', 'test_options', SYNC_DEF),
                local: await stored_object_factory.get('local', 'test_options', LOCAL_DEF),
            }),
            tabs: tab_model,
            bookmarks: bm_model,
            deleted_items: new M.DeletedItems.Model(deleted_items),
            favicons: new M.Favicons.Model(new KVSCache(favicons)),
            bookmark_metadata: new M.BookmarkMetadata.Model(new KVSCache(bookmark_metadata)),
        });

        // We need the indexes in the models to be populated
        await events.watch(['EventfulMap.onInsert', 'EventfulMap.onUpdate']).untilNextTick();
        expect(tab_model.window(windows.left.id).tabs.length).to.equal(3);
        expect(tab_model.window(windows.right.id).tabs.length).to.equal(3);
        expect(tab_model.window(windows.real.id).tabs.length).to.equal(10);
        expect(bm_model.stash_root.value?.id).to.equal(bookmarks.stash_root.id);
    });

    describe('garbage collection', () => {
        const deleted_item_cutoff = Date.now()
            - M.Options.SYNC_DEF.deleted_items_expiration_days.default
              * 24 * 60 * 60 * 1000;

        beforeEach(() => {
            events.ignore(undefined);
        });

        it('deletes bookmark metadata for deleted bookmarks', async () => {
            expect(await bookmark_metadata.get(['nonexistent']))
                .to.deep.equal([{key: 'nonexistent', value: {collapsed: true}}]);

            await model.gc();

            expect(await bookmark_metadata.get(['nonexistent'])).to.deep.equal([]);
        });

        it('deletes cached favicons that are not in bookmarks or open tabs', async() => {
            expect(await favicons.get([`${B}#sir-not-appearing-in-this-film`]))
                .to.deep.equal([{
                    key: `${B}#sir-not-appearing-in-this-film`,
                    value: {favIconUrl: `${B}#sir-not-appearing-in-this-film.favicon`},
                }]);

            await model.gc();

            expect(await favicons.get([`${B}#sir-not-appearing-in-this-film`]))
                .to.deep.equal([]);
        });

        it('deletes expired deleted items', async () => {
            expect(model.options.sync.state.deleted_items_expiration_days)
                .to.equal(M.Options.SYNC_DEF.deleted_items_expiration_days.default);

            const old_deleted_item = (await deleted_items.getStartingFrom(undefined, 1))[0];
            expect(old_deleted_item!.value.item).to.deep.include({
                title: 'Older Deleted Bookmark',
                url: `${B}#older-deleted`
            });
            expect(new Date(old_deleted_item!.value.deleted_at).valueOf())
                .to.be.lessThan(deleted_item_cutoff);

            await model.gc();

            expect(await deleted_items.get([old_deleted_item.key])).to.deep.equal([]);
        });

        it('keeps bookmark metadata for active bookmarks', async () => {
            await model.gc();

            expect(await bookmark_metadata.get([bookmarks.unnamed.id]))
                .to.deep.equal([{key: bookmarks.unnamed.id, value: {collapsed: true}}]);
        });

        it('keeps cached favicons that are in open tabs', async () => {
            await model.gc();

            expect(await favicons.get([`${B}#doug`, `${B}#alice`]))
                .to.deep.equal([
                    {key: `${B}#doug`, value: {favIconUrl: `${B}#doug.favicon`}},
                    {key: `${B}#alice`, value: {favIconUrl: `${B}#alice.favicon`}},
                ]);
        });

        it('keeps cached favicons for bookmarks', async () => {
            await model.gc();

            expect(await favicons.get([`${B}#nate`, `${B}#undyne`]))
                .to.deep.equal([
                    {key: `${B}#nate`, value: {favIconUrl: `${B}#nate.favicon`}},
                    {key: `${B}#undyne`, value: {favIconUrl: `${B}#undyne.favicon`}},
                ]);
        });

        it('keeps recently deleted items', async () => {
            expect(model.options.sync.state.deleted_items_expiration_days)
                .to.equal(M.Options.SYNC_DEF.deleted_items_expiration_days.default);

            const newest_deleted = (await deleted_items.getEndingAt(undefined, 1))[0];
            expect(Date.parse(newest_deleted.value.deleted_at))
                .to.be.greaterThan(deleted_item_cutoff);

            await model.gc();

            const items = await deleted_items.getEndingAt(undefined, 1000);
            expect(items.length).to.be.greaterThan(0);
            for (const item of items) {
                expect(Date.parse(item.value.deleted_at))
                    .to.be.greaterThan(deleted_item_cutoff);
            }
        });
    });

    describe('hides or closes stashed tabs', () => {
        describe('according to user settings', () => {
            it('hides tabs but keeps them loaded', async () => {
                await model.options.local.set({after_stashing_tab: 'hide'});
                await events.next(browser.storage.onChanged);
                await events.next(model.options.local.onChanged);
                expect(model.options.local.state.after_stashing_tab)
                    .to.equal('hide');

                await model.hideOrCloseStashedTabs([tabs.right_doug.id]);
                await events.next(browser.tabs.onUpdated); // hidden

                const t = await browser.tabs.get(tabs.right_doug.id);
                expect(t).to.deep.include({
                    url: tabs.right_doug.url,
                    hidden: true,
                });
                expect(model.tabs.tab(tabs.right_doug.id)).to.deep.include({
                    url: tabs.right_doug.url,
                    hidden: true,
                });
                expect(model.tabs.tab(tabs.right_doug.id).discarded).not.to.be.ok;
            });

            it('hides and unloads tabs', async () => {
                await model.options.local.set({after_stashing_tab: 'hide_discard'});
                await events.next(browser.storage.onChanged);
                await events.next(model.options.local.onChanged);
                expect(model.options.local.state.after_stashing_tab)
                    .to.equal('hide_discard');

                await model.hideOrCloseStashedTabs([tabs.right_doug.id]);
                await events.next(browser.tabs.onUpdated); // hidden
                await events.next(browser.tabs.onUpdated); // discarded

                expect(await browser.tabs.get(tabs.right_doug.id)).to.deep.include({
                    url: tabs.right_doug.url,
                    hidden: true,
                    discarded: true,
                });
                expect(model.tabs.tab(tabs.right_doug.id)).to.deep.include({
                    url: tabs.right_doug.url,
                    hidden: true,
                    discarded: true,
                });
            });

            it('closes tabs', async () => {
                await model.options.local.set({after_stashing_tab: 'close'});
                await events.next(browser.storage.onChanged);
                await events.next(model.options.local.onChanged);
                expect(model.options.local.state.after_stashing_tab)
                    .to.equal('close');

                await model.hideOrCloseStashedTabs([tabs.right_doug.id]);
                await events.next(browser.tabs.onRemoved);

                await browser.tabs.get(tabs.right_doug.id).then(
                    () => expect.fail('browser.tabs.get did not throw'),
                    () => {},
                );
                expect(() => model.tabs.tab(tabs.right_doug.id)).to.throw(Error);
            });
        });

        it('opens a new empty tab if needed to keep the window open', async () => {
            await model.options.local.set({after_stashing_tab: 'hide'});
            await events.next(browser.storage.onChanged);
            await events.next(model.options.local.onChanged);
            expect(model.options.local.state.after_stashing_tab)
                .to.equal('hide');

            await model.hideOrCloseStashedTabs([
                tabs.left_alice.id,
                tabs.left_betty.id,
                tabs.left_charlotte.id,
            ]);
            await events.next(browser.tabs.onCreated);
            await events.next(browser.tabs.onActivated);
            await events.next(browser.tabs.onHighlighted);
            await events.nextN(browser.tabs.onUpdated, 3);

            const win = await browser.tabs.query({windowId: windows.left.id});
            expect(win.map(({id, url, active, hidden}) => ({id, url, active, hidden})))
                .to.deep.equal([
                    {id: tabs.left_alice.id, url: `${B}#alice`,
                        active: false, hidden: true},
                    {id: tabs.left_betty.id, url: `${B}#betty`,
                        active: false, hidden: true},
                    {id: tabs.left_charlotte.id, url: `${B}#charlotte`,
                        active: false, hidden: true},
                    {id: win[3].id, url: B, active: true, hidden: undefined},
                ]);

            expect(model.tabs.window(windows.left.id).tabs).to.deep.equal([
                tabs.left_alice.id,
                tabs.left_betty.id,
                tabs.left_charlotte.id,
                win[3].id!,
            ]);
            expect(model.tabs.tab(tabs.left_alice.id).hidden).to.be.true;
            expect(model.tabs.tab(tabs.left_betty.id).hidden).to.be.true;
            expect(model.tabs.tab(tabs.left_charlotte.id).hidden).to.be.true;
            expect(model.tabs.tab(win[3].id as TabID)).to.deep.include({
                active: true,
            });
        });

        it('refocuses away from an active tab that is to be closed', async () => {
            await model.hideOrCloseStashedTabs([
                tabs.left_alice.id,
            ]);
            await events.next(browser.tabs.onActivated);
            await events.next(browser.tabs.onHighlighted);
            await events.next(browser.tabs.onUpdated); // hidden

            const win = await browser.tabs.query({windowId: windows.left.id});
            expect(win.map(({id, url, active, hidden}) => ({id, url, active, hidden})))
                .to.deep.equal([
                    {id: tabs.left_alice.id, url: `${B}#alice`,
                        active: false, hidden: true},
                    {id: tabs.left_betty.id, url: `${B}#betty`,
                        active: true, hidden: undefined},
                    {id: tabs.left_charlotte.id, url: `${B}#charlotte`,
                        active: false, hidden: undefined},
                ]);
        });
    });

    describe('puts items in bookmark folders', () => {
        it('moves bookmarks in the same folder to a new position');
        it('moves bookmarks from different folders into the target folder');
        it('moves a combination of bookmarks from the same/different folders');
        it('copies external items into the folder');
        it('moves tabs into the folder');
        it('moves tabs and bookmarks into the folder');
    });

    describe('puts items in windows', () => {
        it('moves tabs in the same window to a new position');
        it('moves tabs from different windows into the target window');
        it('moves a combination of tabs from the same/different windows');
        it('copies external items into the window');
        it('moves tabs into the window');
        it('moves tabs and bookmarks into the window');
    });

    describe('stashes tabs to bookmarks', () => {
        it('adds stashed tabs to a new unnamed bookmark folder');
        it('adds stashed tabs to a recently-created unnamed bookmark folder');
        it('adds stashed tabs to a named bookmark folder');
        it('ignores pinned tabs in a window');
    });

    describe('restores tabs', () => {
        it('restores a single hidden tab');
        it('restores a single already-open tab by switching to it');
        it('restores multiple tabs');
        it('skips duplicate URLs when restoring tabs');
        it('activates the last tab when restoring in the foreground');
    });

    describe('deletes and un-deletes bookmarks', () => {
        it('deletes folders and remembers them as deleted items');
        it('deletes bookmarks and remembers them as deleted items');
        it('un-deletes folders');
        it('un-deletes bookmarks into their old folder');
        it('un-deletes bookmarks into a new folder if the old one is gone');
        it('un-deletes individual bookmarks in a deleted folder');
    });
});

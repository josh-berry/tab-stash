import {expect} from 'chai';
import browser from 'webextension-polyfill';

import * as events from '../mock/events';

import * as M from './tabs';
import {B, make_tabs, TabFixture} from './fixtures.testlib';

describe('model/tabs', () => {
    let windows: TabFixture['windows'];
    let tabs: TabFixture['tabs'];
    let model: M.Model;

    beforeEach(async () => {
        const setup = await make_tabs();
        windows = setup.windows;
        tabs = setup.tabs;

        model = await M.Model.from_browser();
        await events.watch([model.by_id.onInsert, model.by_id.onUpdate]).untilNextTick();
        expect(events.pendingCount()).to.equal(0);
    });

    it("loads tabs correctly", async () => {
        for (const t in tabs) {
            const tab = tabs[t as keyof typeof tabs];
            expect(model.by_id.get(tab.id)).to.deep.equal(tab);
        }
    });

    it("tracks tabs by window", async () => {
        for (const w in windows) {
            const win = windows[w as keyof typeof windows];
            expect(model.by_window.get(win.id)).to.deep.equal(win.tabs);
        }
    });

    it("inserts new tabs into the correct window", async () => {
        const t = await browser.tabs.create({
            windowId: windows.left.id, index: 3, url: 'a', active: false,
        });
        await events.next(browser.tabs.onCreated);
        await events.next(model.by_id.onInsert);

        expect(model.by_id.get(t.id!)).to.deep.include({
            id: t.id,
            windowId: windows.left.id,
            index: 3,
            url: 'a',
            active: false,
            pinned: false,
            highlighted: false,
            incognito: false,
        });

        expect(model.by_window.get(windows.left.id)).to.deep.equal([
            tabs.left_alice,
            tabs.left_betty,
            tabs.left_charlotte,
            model.by_id.get(t.id!),
        ]);
        expect(model.by_window.get(windows.right.id)).to.deep.equal([
            tabs.right_blank,
            tabs.right_adam,
            tabs.right_doug,
        ]);
    });

    it("tracks tabs by URL", () => {
        expect(model.by_url.get(`${B}#doug`)).to.deep.equal([
            model.by_id.get(tabs.right_doug.id),
            model.by_id.get(tabs.real_doug.id),
            model.by_id.get(tabs.real_doug_2.id),
        ]);
        expect(model.by_url.get(`${B}`)).to.deep.equal([
            model.by_id.get(tabs.right_blank.id),
            model.by_id.get(tabs.real_blank.id),
        ]);
        expect(model.by_url.get(`${B}#paul`)).to.deep.equal([
            model.by_id.get(tabs.real_paul.id),
        ]);
    });

    it("tracks tabs as their URLs change", async () => {
        // Initial state validated by the earlier tabs-by-url test
        await browser.tabs.update(tabs.right_blank.id, {url: `${B}#paul`});
        await events.next(browser.tabs.onUpdated);
        await events.next(model.by_id.onUpdate);

        expect(model.by_url.get(`${B}`)).to.deep.equal([
            model.by_id.get(tabs.real_blank.id),
        ]);
        expect(model.by_url.get(`${B}#paul`)).to.deep.equal([
            model.by_id.get(tabs.real_paul.id),
            model.by_id.get(tabs.right_blank.id),
        ]);
    });

    it("opens and closes windows", async () => {
        const win = await browser.windows.create({url: `${B}#hi`});
        await events.next(browser.windows.onCreated);
        await events.next(browser.tabs.onCreated);
        await events.next(browser.windows.onFocusChanged);
        await events.next(browser.tabs.onActivated);
        await events.next(model.by_id.onInsert);
        await events.next(model.by_id.onUpdate);

        const tab = win.tabs![0];

        expect(model.by_id.get(tab.id!))
            .to.deep.include({id: tab.id!, windowId: win.id!, index: 0, url: `${B}#hi`});
        expect(model.by_url.get(`${B}#hi`)).to.deep.equal([
            model.by_id.get(tab.id!),
        ]);
        expect(model.by_window.get(win.id!)).to.deep.equal([
            model.by_id.get(tab.id!),
        ]);

        // Cleanup for running this test in a live environment - close the
        // window we just created
        await browser.windows.remove(win.id!);
        await events.next(browser.windows.onRemoved);
        await events.next(browser.windows.onFocusChanged);
        await events.next(model.by_id.onDelete);

        expect(model.by_id.get(tab.id!)).to.be.undefined;
        expect(model.by_window.get(win.id!)).to.deep.equal([]);
    });

    it("opens tabs in new windows", async () => {
        // In this test, we are simulating the scenario where we miss some
        // browser events (e.g. window creation); we should fill in the blanks
        // correctly (so to speak).
        const tab = {
            id: 16384, windowId: 16590, index: 0, url: 'hi',
            highlighted: false, active: false, pinned: false, incognito: false,
        };
        events.send(browser.tabs.onCreated, tab);
        await events.next(browser.tabs.onCreated);
        await events.next(model.by_id.onInsert);

        expect(model.by_id.get(16384)).to.deep.equal(tab);
        expect(model.by_url.get("hi")).to.deep.equal([tab]);
        expect(model.by_window.get(16590)).to.deep.equal([tab]);
    });

    it("handles duplicate tab-creation events gracefully", async () => {
        const win = await browser.windows.create({url: `${B}#hi`});
        const tab = win.tabs![0];
        await events.next(browser.windows.onCreated);
        await events.next(browser.tabs.onCreated);
        await events.next(browser.windows.onFocusChanged);
        await events.next(browser.tabs.onActivated);
        await events.next(model.by_id.onInsert);
        await events.next(model.by_id.onUpdate);

        events.send(browser.tabs.onCreated, {
            id: tab.id!,
            windowId: win.id!,
            index: 0,
            url: 'cats',
            active: tab.active,
            pinned: tab.pinned,
            highlighted: tab.highlighted,
            incognito: tab.incognito,
        });
        await events.next(browser.tabs.onCreated);
        await events.next(model.by_id.onUpdate);
        tab.url = 'cats';

        expect(model.by_id.get(tab.id!)).to.deep.equal(tab);
        expect(model.by_url.get("cats")).to.deep.equal([
            model.by_id.get(tab.id!),
        ]);
        expect(model.by_window.get(win.id!)).to.deep.equal([
            model.by_id.get(tab.id!),
        ]);

        // Cleanup when running in a live environment - close the window we just
        // created
        await browser.windows.remove(win.id!);
        await events.next(browser.windows.onRemoved);
        await events.next(browser.windows.onFocusChanged);
        await events.next(model.by_id.onDelete);

        expect(model.by_id.get(tab.id!)).to.be.undefined;
        expect(model.by_window.get(win.id!)).to.deep.equal([]);
    });

    it("closes tabs", async () => {
        // Initial state validated by the earlier tabs-by-window test
        await browser.tabs.remove(tabs.right_adam.id);
        await events.next(browser.tabs.onRemoved);
        await events.next(model.by_id.onDelete);
        await events.next(model.by_id.onUpdate); // shuffling siblings

        expect(model.by_id.get(tabs.right_adam.id)).to.be.undefined;
        expect(model.by_window.get(windows.right.id)).to.deep.equal([
            model.by_id.get(tabs.right_blank.id),
            model.by_id.get(tabs.right_doug.id),
        ]);
    });

    it("handles duplicate tab-close events gracefully", async () => {
        // Initial state validated by the earlier tabs-by-window test
        await browser.tabs.remove(tabs.right_adam.id);
        const ev = await events.next(browser.tabs.onRemoved);
        events.send(browser.tabs.onRemoved, ...ev);
        await events.next(browser.tabs.onRemoved);
        await events.next(model.by_id.onDelete);
        await events.next(model.by_id.onUpdate); // shuffling siblings

        expect(model.by_id.get(tabs.right_adam.id)).to.be.undefined;
        expect(model.by_window.get(windows.right.id)).to.deep.equal([
            model.by_id.get(tabs.right_blank.id),
            model.by_id.get(tabs.right_doug.id),
        ]);
    });

    it("drops tabs in a window when the window is closed", async () => {
        // Initial state validated by the earlier tabs-by-window test
        await browser.windows.remove(windows.right.id);
        await events.next(browser.windows.onRemoved);
        await events.nextN(model.by_id.onDelete, 3);

        expect(model.by_window.get(windows.right.id)).to.deep.equal([]);
        expect(model.by_id.get(tabs.left_alice.id)).to.not.be.undefined;
        expect(model.by_id.get(tabs.left_betty.id)).to.not.be.undefined;
        expect(model.by_id.get(tabs.left_charlotte.id)).to.not.be.undefined;
        expect(model.by_id.get(tabs.right_blank.id)).to.be.undefined;
        expect(model.by_id.get(tabs.right_adam.id)).to.be.undefined;
        expect(model.by_id.get(tabs.right_doug.id)).to.be.undefined;
    });

    it("moves tabs within a window (forwards)", async () => {
        await browser.tabs.move(tabs.left_alice.id,
                {windowId: windows.left.id, index: 2});
        await events.next(browser.tabs.onMoved);
        await events.nextN(model.by_id.onUpdate, 3);

        expect(model.by_window.get(windows.left.id)).to.deep.equal([
            model.by_id.get(tabs.left_betty.id),
            model.by_id.get(tabs.left_charlotte.id),
            model.by_id.get(tabs.left_alice.id),
        ]);
        expect(model.by_id.get(tabs.left_betty.id)).to.deep.include({
            windowId: windows.left.id, index: 0});
        expect(model.by_id.get(tabs.left_charlotte.id)).to.deep.include({
            windowId: windows.left.id, index: 1});
        expect(model.by_id.get(tabs.left_alice.id)).to.deep.include({
            windowId: windows.left.id, index: 2});

        expect(model.by_window.get(windows.right.id)).to.deep.equal([
            model.by_id.get(tabs.right_blank.id),
            model.by_id.get(tabs.right_adam.id),
            model.by_id.get(tabs.right_doug.id),
        ]);
        expect(model.by_id.get(tabs.right_blank.id)).to.deep.include({
            windowId: windows.right.id, index: 0});
        expect(model.by_id.get(tabs.right_adam.id)).to.deep.include({
            windowId: windows.right.id, index: 1});
        expect(model.by_id.get(tabs.right_doug.id)).to.deep.include({
            windowId: windows.right.id, index: 2});
    });

    it("moves tabs within a window (backwards)", async () => {
        await browser.tabs.move(tabs.left_charlotte.id,
            {windowId: windows.left.id, index: 0});
        await events.next(browser.tabs.onMoved);
        await events.nextN(model.by_id.onUpdate, 3);

        expect(model.by_window.get(windows.left.id)).to.deep.equal([
            model.by_id.get(tabs.left_charlotte.id),
            model.by_id.get(tabs.left_alice.id),
            model.by_id.get(tabs.left_betty.id),
        ]);
        expect(model.by_id.get(tabs.left_charlotte.id)).to.deep.include({
            windowId: windows.left.id, index: 0});
        expect(model.by_id.get(tabs.left_alice.id)).to.deep.include({
            windowId: windows.left.id, index: 1});
        expect(model.by_id.get(tabs.left_betty.id)).to.deep.include({
            windowId: windows.left.id, index: 2});

        expect(model.by_window.get(windows.right.id)).to.deep.equal([
            model.by_id.get(tabs.right_blank.id),
            model.by_id.get(tabs.right_adam.id),
            model.by_id.get(tabs.right_doug.id),
        ]);
        expect(model.by_id.get(tabs.right_blank.id)).to.deep.include({
            windowId: windows.right.id, index: 0});
        expect(model.by_id.get(tabs.right_adam.id)).to.deep.include({
            windowId: windows.right.id, index: 1});
        expect(model.by_id.get(tabs.right_doug.id)).to.deep.include({
            windowId: windows.right.id, index: 2});
    });

    it("moves tabs between windows", async () => {
        await browser.tabs.move(tabs.left_betty.id,
            {windowId: windows.right.id, index: 1});
        await events.next(browser.tabs.onAttached);
        await events.nextN(model.by_id.onUpdate, 4); // shuffling siblings

        expect(model.by_window.get(windows.left.id)).to.deep.equal([
            model.by_id.get(tabs.left_alice.id),
            model.by_id.get(tabs.left_charlotte.id),
        ]);
        expect(model.by_id.get(tabs.left_alice.id)).to.deep.include({
            windowId: windows.left.id, index: 0});
        expect(model.by_id.get(tabs.left_charlotte.id)).to.deep.include({
            windowId: windows.left.id, index: 1});

        expect(model.by_window.get(windows.right.id)).to.deep.equal([
            model.by_id.get(tabs.right_blank.id),
            model.by_id.get(tabs.left_betty.id),
            model.by_id.get(tabs.right_adam.id),
            model.by_id.get(tabs.right_doug.id),
        ]);
        expect(model.by_id.get(tabs.right_blank.id)).to.deep.include({
            windowId: windows.right.id, index: 0});
        expect(model.by_id.get(tabs.left_betty.id)).to.deep.include({
            windowId: windows.right.id, index: 1});
        expect(model.by_id.get(tabs.right_adam.id)).to.deep.include({
            windowId: windows.right.id, index: 2});
        expect(model.by_id.get(tabs.right_doug.id)).to.deep.include({
            windowId: windows.right.id, index: 3});
    });

    it("replaces tabs", async () => {
        const tab = model.by_id.get(tabs.left_charlotte.id);
        expect(tab).to.not.be.undefined;

        events.send(browser.tabs.onReplaced, 16384, tabs.left_charlotte.id);
        await events.next(browser.tabs.onReplaced);
        await events.nextN(model.by_id.onUpdate, 1);
        await events.nextN(model.by_id.onMove, 1);

        expect(model.by_id.get(tabs.left_charlotte.id)).to.be.undefined;
        expect(model.by_id.get(16384)).to.equal(tab);

        expect(model.by_window.get(windows.left.id)).to.deep.equal([
            model.by_id.get(tabs.left_alice.id),
            model.by_id.get(tabs.left_betty.id),
            model.by_id.get(16384),
        ]);
        expect(model.by_window.get(windows.right.id)).to.deep.equal([
            model.by_id.get(tabs.right_blank.id),
            model.by_id.get(tabs.right_adam.id),
            model.by_id.get(tabs.right_doug.id),
        ]);
    });

    it("handles incomplete tabs gracefully", async () => {
        const t = {
            id: 16384, windowId: 16590, index: 0, /* no url */
            active: false, pinned: false, highlighted: false, incognito: false,
        } as M.Tab;
        events.send(browser.tabs.onCreated, JSON.parse(JSON.stringify(t)));
        await events.next(browser.tabs.onCreated);
        await events.next(model.by_id.onInsert);

        expect(model.by_id.get(16384))
            .to.deep.include({id: 16384, windowId: 16590, index: 0});

        t.url = 'hi';
        events.send(browser.tabs.onUpdated, 16384, {url: 'hi'},
            JSON.parse(JSON.stringify(t)));
        await events.next(browser.tabs.onUpdated);
        await events.next(model.by_id.onUpdate);

        expect(model.by_id.get(16384)).to.deep.include({id: 16384, url: 'hi'});
        expect(model.by_url.get('hi')).to.deep.equal([
            model.by_id.get(16384),
        ]);
    });

    it("activates tabs", async () => {
        expect(model.by_id.get(tabs.left_alice.id)!.active).to.equal(true);

        await browser.tabs.update(tabs.left_charlotte.id, {active: true});
        await events.next(browser.tabs.onActivated);
        await events.nextN(model.by_id.onUpdate, 2);

        expect(model.by_id.get(tabs.left_alice.id)!.active).to.equal(false);
        expect(model.by_id.get(tabs.left_charlotte.id)!.active).to.equal(true);
    });
});

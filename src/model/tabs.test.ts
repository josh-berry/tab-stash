import {expect} from 'chai';
import browser from 'webextension-polyfill';

import * as events from '../mock/events';

import * as M from './tabs';
import {make_tabs, TabSetup} from './fixtures.testlib';

describe('model/tabs', () => {
    let windows: TabSetup['windows'];
    let tabs: TabSetup['tabs'];
    let model: M.Model;

    beforeEach(async () => {
        const setup = await make_tabs();
        windows = setup.windows;
        tabs = setup.tabs;

        model = await M.Model.from_browser();
        await events.watch([model.by_id.onInsert, model.by_id.onUpdate]).untilNextTick();
    });

    it("loads tabs correctly", async () => {
        for (const t in tabs) {
            expect(model.by_id.get(tabs[t].id)!).to.deep.equal(tabs[t]);
        }
    });

    it("tracks tabs by window", async () => {
        expect(model.by_window.get(windows.one.id)).to.deep.equal([
            model.by_id.get(tabs.foo.id),
            model.by_id.get(tabs.bar.id),
            model.by_id.get(tabs.fred.id),
        ]);
        expect(model.by_window.get(windows.two.id)).to.deep.equal([
            model.by_id.get(tabs.robert1.id),
            model.by_id.get(tabs.robert2.id),
            model.by_id.get(tabs.foo2.id),
        ]);
    });

    it("inserts new tabs into the correct window", async () => {
        const t = await browser.tabs.create({
            windowId: windows.one.id, index: 3, url: 'a', active: false,
        });
        await events.next(browser.tabs.onCreated);
        await events.next(model.by_id.onInsert);

        expect(model.by_id.get(t.id!)).to.deep.include({
            id: t.id,
            windowId: windows.one.id,
            index: 3,
            url: 'a',
            active: false,
            pinned: false,
            highlighted: false,
            incognito: false,
        });

        expect(model.by_window.get(windows.one.id)).to.deep.equal([
            tabs.foo,
            tabs.bar,
            tabs.fred,
            model.by_id.get(t.id!),
        ]);
        expect(model.by_window.get(windows.two.id)).to.deep.equal([
            tabs.robert1,
            tabs.robert2,
            tabs.foo2,
        ]);
    });

    it("tracks tabs by URL", () => {
        expect(model.by_url.get("fred")).to.deep.equal([
            model.by_id.get(tabs.fred.id),
        ]);

        expect(model.by_url.get("robert")).to.deep.equal([
            model.by_id.get(tabs.robert1.id),
            model.by_id.get(tabs.robert2.id),
        ]);
    });

    it("tracks tabs as their URLs change", async () => {
        // Initial state validated by the earlier tabs-by-url test
        await browser.tabs.update(tabs.robert1.id, {url: "fred"});
        await events.next(browser.tabs.onUpdated);
        await events.next(model.by_id.onUpdate);

        expect(model.by_url.get("fred")).to.deep.equal([
            model.by_id.get(tabs.fred.id),
            model.by_id.get(tabs.robert1.id),
        ]);
        expect(model.by_url.get("robert")).to.deep.equal([
            model.by_id.get(tabs.robert2.id),
        ]);
    });

    it("opens windows", async () => {
        const win = await browser.windows.create({url: 'hi'});
        await events.next(browser.windows.onCreated);
        await events.next(browser.tabs.onCreated);
        await events.next(browser.windows.onFocusChanged);
        await events.next(browser.tabs.onActivated);
        await events.next(model.by_id.onInsert);
        await events.next(model.by_id.onUpdate);

        const tab = win.tabs![0];

        expect(model.by_id.get(tab.id!))
            .to.deep.include({id: tab.id!, windowId: win.id!, index: 0, url: "hi"});
        expect(model.by_url.get("hi")).to.deep.equal([
            model.by_id.get(tab.id!),
        ]);
        expect(model.by_window.get(win.id!)).to.deep.equal([
            model.by_id.get(tab.id!),
        ]);
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
        const win = await browser.windows.create({url: 'hi'});
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
    });

    it("closes tabs", async () => {
        // Initial state validated by the earlier tabs-by-window test
        await browser.tabs.remove(tabs.robert2.id);
        await events.next(browser.tabs.onRemoved);
        await events.next(model.by_id.onDelete); // 5 was closed
        await events.next(model.by_id.onUpdate); // 6's index changed

        expect(model.by_window.get(1)).to.deep.equal([
            model.by_id.get(tabs.robert1.id),
            model.by_id.get(tabs.foo2.id),
        ]);
    });

    it("handles duplicate tab-close events gracefully", async () => {
        // Initial state validated by the earlier tabs-by-window test
        await browser.tabs.remove(tabs.robert2.id);
        const ev = await events.next(browser.tabs.onRemoved);
        events.send(browser.tabs.onRemoved, ...ev);
        await events.next(browser.tabs.onRemoved);
        await events.next(model.by_id.onDelete); // 5 was closed
        await events.next(model.by_id.onUpdate); // 6's index changed

        expect(model.by_window.get(1)).to.deep.equal([
            model.by_id.get(tabs.robert1.id),
            model.by_id.get(tabs.foo2.id),
        ]);
    });

    it("drops tabs in a window when the window is closed", async () => {
        // Initial state validated by the earlier tabs-by-window test
        await browser.windows.remove(windows.two.id);
        await events.next(browser.windows.onRemoved);
        await events.next(browser.windows.onFocusChanged);
        await events.nextN(model.by_id.onDelete, 3);

        expect(model.by_window.get(windows.two.id)).to.deep.equal([]);
        expect(model.by_id.get(tabs.foo.id)).to.not.be.undefined;
        expect(model.by_id.get(tabs.bar.id)).to.not.be.undefined;
        expect(model.by_id.get(tabs.fred.id)).to.not.be.undefined;
        expect(model.by_id.get(tabs.robert1.id)).to.be.undefined;
        expect(model.by_id.get(tabs.robert2.id)).to.be.undefined;
        expect(model.by_id.get(tabs.foo2.id)).to.be.undefined;
    });

    it("moves tabs within a window (forwards)", async () => {
        await browser.tabs.move(tabs.foo.id, {windowId: windows.one.id, index: 2});
        await events.next(browser.tabs.onMoved);
        await events.nextN(model.by_id.onUpdate, 3);

        expect(model.by_window.get(windows.one.id)).to.deep.equal([
            model.by_id.get(tabs.bar.id),
            model.by_id.get(tabs.fred.id),
            model.by_id.get(tabs.foo.id),
        ]);
        expect(model.by_window.get(windows.two.id)).to.deep.equal([
            model.by_id.get(tabs.robert1.id),
            model.by_id.get(tabs.robert2.id),
            model.by_id.get(tabs.foo2.id),
        ]);

        expect(model.by_id.get(tabs.bar.id)).to.deep.include({
            windowId: windows.one.id, index: 0});
        expect(model.by_id.get(tabs.fred.id)).to.deep.include({
            windowId: windows.one.id, index: 1});
        expect(model.by_id.get(tabs.foo.id)).to.deep.include({
            windowId: windows.one.id, index: 2});
        expect(model.by_id.get(tabs.robert1.id)).to.deep.include({
            windowId: windows.two.id, index: 0});
        expect(model.by_id.get(tabs.robert2.id)).to.deep.include({
            windowId: windows.two.id, index: 1});
        expect(model.by_id.get(tabs.foo2.id)).to.deep.include({
            windowId: windows.two.id, index: 2});
    });

    it("moves tabs within a window (backwards)", async () => {
        await browser.tabs.move(tabs.fred.id, {windowId: windows.one.id, index: 0});
        await events.next(browser.tabs.onMoved);
        await events.nextN(model.by_id.onUpdate, 3);

        expect(model.by_window.get(windows.one.id)).to.deep.equal([
            model.by_id.get(tabs.fred.id),
            model.by_id.get(tabs.foo.id),
            model.by_id.get(tabs.bar.id),
        ]);
        expect(model.by_window.get(windows.two.id)).to.deep.equal([
            model.by_id.get(tabs.robert1.id),
            model.by_id.get(tabs.robert2.id),
            model.by_id.get(tabs.foo2.id),
        ]);

        expect(model.by_id.get(tabs.fred.id)).to.deep.include({
            windowId: windows.one.id, index: 0});
        expect(model.by_id.get(tabs.foo.id)).to.deep.include({
            windowId: windows.one.id, index: 1});
        expect(model.by_id.get(tabs.bar.id)).to.deep.include({
            windowId: windows.one.id, index: 2});
        expect(model.by_id.get(tabs.robert1.id)).to.deep.include({
            windowId: windows.two.id, index: 0});
        expect(model.by_id.get(tabs.robert2.id)).to.deep.include({
            windowId: windows.two.id, index: 1});
        expect(model.by_id.get(tabs.foo2.id)).to.deep.include({
            windowId: windows.two.id, index: 2});
    });

    it("moves tabs between windows", async () => {
        await browser.tabs.move(tabs.fred.id, {windowId: windows.two.id, index: 1});
        await events.next(browser.tabs.onAttached);
        await events.nextN(model.by_id.onUpdate, 3);

        expect(model.by_window.get(windows.one.id)).to.deep.equal([
            model.by_id.get(tabs.foo.id),
            model.by_id.get(tabs.bar.id),
        ]);
        expect(model.by_window.get(windows.two.id)).to.deep.equal([
            model.by_id.get(tabs.robert1.id),
            model.by_id.get(tabs.fred.id),
            model.by_id.get(tabs.robert2.id),
            model.by_id.get(tabs.foo2.id),
        ]);

        expect(model.by_id.get(tabs.foo.id)).to.deep.include({
            windowId: windows.one.id, index: 0});
        expect(model.by_id.get(tabs.bar.id)).to.deep.include({
            windowId: windows.one.id, index: 1});
        expect(model.by_id.get(tabs.robert1.id)).to.deep.include({
            windowId: windows.two.id, index: 0});
        expect(model.by_id.get(tabs.fred.id)).to.deep.include({
            windowId: windows.two.id, index: 1});
        expect(model.by_id.get(tabs.robert2.id)).to.deep.include({
            windowId: windows.two.id, index: 2});
        expect(model.by_id.get(tabs.foo2.id)).to.deep.include({
            windowId: windows.two.id, index: 3});
    });

    it("replaces tabs", async () => {
        const tab = model.by_id.get(tabs.fred.id);
        expect(tab).to.not.be.undefined;

        events.send(browser.tabs.onReplaced, 16384, tabs.fred.id);
        await events.next(browser.tabs.onReplaced);
        await events.nextN(model.by_id.onUpdate, 1);
        await events.nextN(model.by_id.onMove, 1);

        expect(model.by_id.get(tabs.fred.id)).to.be.undefined;
        expect(model.by_id.get(16384)).to.equal(tab);

        expect(model.by_window.get(windows.one.id)).to.deep.equal([
            model.by_id.get(tabs.foo.id),
            model.by_id.get(tabs.bar.id),
            model.by_id.get(16384),
        ]);
        expect(model.by_window.get(windows.two.id)).to.deep.equal([
            model.by_id.get(tabs.robert1.id),
            model.by_id.get(tabs.robert2.id),
            model.by_id.get(tabs.foo2.id),
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
        expect(model.by_id.get(tabs.foo.id)!.active).to.equal(true);

        await browser.tabs.update(tabs.fred.id, {active: true});
        await events.next(browser.tabs.onActivated);
        await events.nextN(model.by_id.onUpdate, 2);

        expect(model.by_id.get(tabs.foo.id)!.active).to.equal(false);
        expect(model.by_id.get(tabs.fred.id)!.active).to.equal(true);
    });
});

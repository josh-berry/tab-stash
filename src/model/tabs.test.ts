import {expect} from 'chai';

import '../mock/browser';
import * as events from '../mock/events';

import * as M from './tabs';
import {tabs, make_tab} from './fixtures.testlib';

describe('model/tabs', () => {
    let model: M.Model;

    beforeEach(async () => {
        model = M.Model.for_test(tabs());
        await events.nextN(model.by_id.onInsert, 6);
    });

    it("tracks tabs by window", async () => {
        expect(model.by_window.get(0)).to.deep.equal([
            make_tab({id: 0, url: "foo", windowId: 0, index: 0}),
            make_tab({id: 1, url: "bar", windowId: 0, index: 1}),
            make_tab({id: 2, url: "fred", windowId: 0, index: 2}),
        ]);
        expect(model.by_window.get(1)).to.deep.equal([
            make_tab({id: 3, url: "robert", windowId: 1, index: 0}),
            make_tab({id: 4, url: "robert", windowId: 1, index: 1}),
            make_tab({id: 5, url: "foo", windowId: 1, index: 2}),
        ]);
    });

    it("inserts new tabs into the correct window", async () => {
        model.whenTabCreated(make_tab({id: 6, url: "a", windowId: 0, index: 3}));
        await events.next(model.by_id.onInsert);

        expect(model.by_window.get(0)).to.deep.equal([
            make_tab({id: 0, url: "foo", windowId: 0, index: 0}),
            make_tab({id: 1, url: "bar", windowId: 0, index: 1}),
            make_tab({id: 2, url: "fred", windowId: 0, index: 2}),
            make_tab({id: 6, url: "a", windowId: 0, index: 3}),
        ]);
        expect(model.by_window.get(1)).to.deep.equal([
            make_tab({id: 3, url: "robert", windowId: 1, index: 0}),
            make_tab({id: 4, url: "robert", windowId: 1, index: 1}),
            make_tab({id: 5, url: "foo", windowId: 1, index: 2}),
        ]);
    });

    it("tracks tabs by URL", () => {
        expect(model.by_url.get("fred")).to.deep.equal([
            make_tab({id: 2, url: "fred", windowId: 0, index: 2}),
        ]);

        expect(model.by_url.get("robert")).to.deep.equal([
            make_tab({id: 3, url: "robert", windowId: 1, index: 0}),
            make_tab({id: 4, url: "robert", windowId: 1, index: 1}),
        ]);
    });

    it("tracks tabs as their URLs change", async () => {
        // Initial state validated by the earlier tabs-by-url test
        model.whenTabUpdated(3, {url: "fred"});
        await events.next(model.by_id.onUpdate);

        expect(model.by_url.get("fred")).to.deep.equal([
            make_tab({id: 2, url: "fred", windowId: 0, index: 2}),
            make_tab({id: 3, url: "fred", windowId: 1, index: 0}),
        ]);
        expect(model.by_url.get("robert")).to.deep.equal([
            make_tab({id: 4, url: "robert", windowId: 1, index: 1}),
        ]);
    });

    it("opens windows", async () => {
        model.whenWindowCreated({
            id: 17,
            focused: true,
            incognito: false,
            alwaysOnTop: false,
            tabs: [make_tab({id: 42, windowId: 17, index: 0, url: "hurf"})],
        });
        await events.next(model.by_id.onInsert);

        expect(model.by_id.get(42))
            .to.deep.equal(make_tab({id: 42, windowId: 17, index: 0, url: "hurf"}));
        expect(model.by_url.get("hurf")).to.deep.equal([
            make_tab({id: 42, windowId: 17, index: 0, url: "hurf"}),
        ]);
        expect(model.by_window.get(17)).to.deep.equal([
            make_tab({id: 42, windowId: 17, index: 0, url: "hurf"})
        ]);
    });

    it("opens tabs in new windows", async () => {
        model.whenTabCreated(make_tab({id: 42, windowId: 17, index: 0, url: "hurf"}));
        await events.next(model.by_id.onInsert);

        expect(model.by_id.get(42))
            .to.deep.equal(make_tab({id: 42, windowId: 17, index: 0, url: "hurf"}));
        expect(model.by_url.get("hurf")).to.deep.equal([
            make_tab({id: 42, windowId: 17, index: 0, url: "hurf"}),
        ]);
        expect(model.by_window.get(17)).to.deep.equal([
            make_tab({id: 42, windowId: 17, index: 0, url: "hurf"})
        ]);
    });

    it("handles duplicate tab-creation events gracefully", async () => {
        model.whenTabCreated(make_tab({id: 42, windowId: 17, index: 0, url: "hurf"}));
        model.whenTabCreated(make_tab({id: 42, windowId: 17, index: 0, url: "cats"}));
        await events.nextN(model.by_id.onInsert, 1);
        await events.nextN(model.by_id.onUpdate, 1);

        expect(model.by_id.get(42))
            .to.deep.equal(make_tab({id: 42, windowId: 17, index: 0, url: "cats"}));
        expect(model.by_url.get("cats")).to.deep.equal([
            make_tab({id: 42, windowId: 17, index: 0, url: "cats"}),
        ]);
        expect(model.by_window.get(17)).to.deep.equal([
            make_tab({id: 42, windowId: 17, index: 0, url: "cats"})
        ]);
    });

    it("closes tabs", async () => {
        // Initial state validated by the earlier tabs-by-window test
        model.whenTabRemoved(4);
        await events.next(model.by_id.onDelete); // 5 was closed
        await events.next(model.by_id.onUpdate); // 6's index changed

        expect(model.by_window.get(1)).to.deep.equal([
            make_tab({id: 3, url: "robert", windowId: 1, index: 0}),
            make_tab({id: 5, url: "foo", windowId: 1, index: 1}),
        ]);
    });

    it("handles duplicate tab-close events gracefully", async () => {
        // Initial state validated by the earlier tabs-by-window test
        model.whenTabRemoved(4);
        model.whenTabRemoved(4);
        await events.next(model.by_id.onDelete); // 5 was closed
        await events.next(model.by_id.onUpdate); // 6's index changed

        expect(model.by_window.get(1)).to.deep.equal([
            make_tab({id: 3, url: "robert", windowId: 1, index: 0}),
            make_tab({id: 5, url: "foo", windowId: 1, index: 1}),
        ]);
    });

    it("drops tabs in a window when the window is closed", async () => {
        // Initial state validated by the earlier tabs-by-window test
        model.whenWindowRemoved(1);
        await events.nextN(model.by_id.onDelete, 3);

        expect(model.by_window.get(0)).to.not.be.undefined;
        expect(model.by_window.get(1)).to.deep.equal([]);
        expect(model.by_id.get(0)).to.not.be.undefined;
        expect(model.by_id.get(1)).to.not.be.undefined;
        expect(model.by_id.get(2)).to.not.be.undefined;
        expect(model.by_id.get(3)).to.be.undefined;
        expect(model.by_id.get(4)).to.be.undefined;
        expect(model.by_id.get(5)).to.be.undefined;
    });

    it("moves tabs within a window (forwards)", async () => {
        model.whenTabMoved(0, {windowId: 0, toIndex: 2});
        await events.nextN(model.by_id.onUpdate, 3);
        expect(model.by_window.get(0)).to.deep.equal([
            make_tab({id: 1, url: "bar", windowId: 0, index: 0}),
            make_tab({id: 2, url: "fred", windowId: 0, index: 1}),
            make_tab({id: 0, url: "foo", windowId: 0, index: 2}),
        ]);
        expect(model.by_window.get(1)).to.deep.equal([
            make_tab({id: 3, url: "robert", windowId: 1, index: 0}),
            make_tab({id: 4, url: "robert", windowId: 1, index: 1}),
            make_tab({id: 5, url: "foo", windowId: 1, index: 2}),
        ]);
    });

    it("moves tabs within a window (backwards)", async () => {
        model.whenTabMoved(2, {windowId: 0, toIndex: 0});
        await events.nextN(model.by_id.onUpdate, 3);
        expect(model.by_window.get(0)).to.deep.equal([
            make_tab({id: 2, url: "fred", windowId: 0, index: 0}),
            make_tab({id: 0, url: "foo", windowId: 0, index: 1}),
            make_tab({id: 1, url: "bar", windowId: 0, index: 2}),
        ]);
        expect(model.by_window.get(1)).to.deep.equal([
            make_tab({id: 3, url: "robert", windowId: 1, index: 0}),
            make_tab({id: 4, url: "robert", windowId: 1, index: 1}),
            make_tab({id: 5, url: "foo", windowId: 1, index: 2}),
        ]);
    });

    it("moves tabs between windows", async () => {
        model.whenTabAttached(1, {newWindowId: 1, newPosition: 1})
        await events.nextN(model.by_id.onUpdate, 4);
        expect(model.by_window.get(0)).to.deep.equal([
            make_tab({id: 0, url: "foo", windowId: 0, index: 0}),
            make_tab({id: 2, url: "fred", windowId: 0, index: 1}),
        ]);
        expect(model.by_window.get(1)).to.deep.equal([
            make_tab({id: 3, url: "robert", windowId: 1, index: 0}),
            make_tab({id: 1, url: "bar", windowId: 1, index: 1}),
            make_tab({id: 4, url: "robert", windowId: 1, index: 2}),
            make_tab({id: 5, url: "foo", windowId: 1, index: 3}),
        ]);
    });

    it("replaces tabs", async () => {
        const tab = model.by_id.get(2);
        expect(tab).to.not.be.undefined;

        model.whenTabReplaced(42, 2);
        await events.nextN(model.by_id.onUpdate, 1);
        await events.nextN(model.by_id.onMove, 1);

        expect(model.by_id.get(2)).to.be.undefined;
        expect(model.by_id.get(42)).to.equal(tab);

        expect(model.by_window.get(0)).to.deep.equal([
            make_tab({id: 0, url: "foo", windowId: 0, index: 0}),
            make_tab({id: 1, url: "bar", windowId: 0, index: 1}),
            make_tab({id: 42, url: "fred", windowId: 0, index: 2}),
        ]);
        expect(model.by_window.get(1)).to.deep.equal([
            make_tab({id: 3, url: "robert", windowId: 1, index: 0}),
            make_tab({id: 4, url: "robert", windowId: 1, index: 1}),
            make_tab({id: 5, url: "foo", windowId: 1, index: 2}),
        ]);
    });

    it("handles incomplete tabs gracefully", async () => {
        model.whenTabCreated(make_tab({id: 42, windowId: 17, index: 0, /* no url */}));
        await events.nextN(model.by_id.onInsert, 1);

        expect(model.by_id.get(42))
            .to.deep.equal(make_tab({id: 42, windowId: 17, index: 0}));

        model.whenTabUpdated(42, {url: 'hi'});
        model.whenTabMoved(42, {windowId: 1, toIndex: 1});
        await events.nextN(model.by_id.onUpdate, 3);

        expect(model.by_id.get(42))
            .to.deep.equal(make_tab({id: 42, windowId: 1, index: 1, url: 'hi'}));
        expect(model.by_url.get('hi')).to.deep.equal([
            make_tab({id: 42, windowId: 1, index: 1, url: 'hi'})
        ]);
        expect(model.by_window.get(17)).to.deep.equal([]);
        expect(model.by_window.get(1)).to.deep.equal([
            make_tab({id: 3, url: "robert", windowId: 1, index: 0}),
            make_tab({id: 42, url: 'hi', windowId: 1, index: 1}),
            make_tab({id: 4, url: "robert", windowId: 1, index: 2}),
            make_tab({id: 5, url: "foo", windowId: 1, index: 3}),
        ]);
    });

    it("activates tabs", async () => {
        model.whenTabActivated({tabId: 0, windowId: 0});
        await events.nextN(model.by_id.onUpdate, 1);
        expect(model.by_id.get(0)!.active).to.equal(true);

        model.whenTabActivated({tabId: 1, windowId: 0});
        await events.nextN(model.by_id.onUpdate, 2); // deactivate then activate
        expect(model.by_id.get(0)!.active).to.equal(false);
        expect(model.by_id.get(1)!.active).to.equal(true);
    });
});

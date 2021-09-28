import {expect} from 'chai';

import '../mock/browser';
import * as events from '../mock/events';

import * as M from './tabs';

describe('model/tabs', () => {
    let model: M.Model;

    function mktab(
        t: Partial<M.Tab> & {id: number, windowId: number, index: number}
    ): M.Tab {
        return Object.assign({
            incognito: false,
            hidden: false,
            pinned: false,
            active: false,
            highlighted: false,
        }, t);
    }

    beforeEach(async () => {
        model = M.Model.for_test([
            mktab({id: 1, url: "foo", windowId: 1, index: 0}),
            mktab({id: 2, url: "bar", windowId: 1, index: 1}),
            mktab({id: 3, url: "fred", windowId: 1, index: 2}),
            mktab({id: 4, url: "robert", windowId: 2, index: 0}),
            mktab({id: 5, url: "robert", windowId: 2, index: 1}),
            mktab({id: 6, url: "foo", windowId: 2, index: 2}),
        ]);
        await events.nextN(model.by_id.onInsert, 6);
    });

    it("tracks tabs by window", async () => {
        expect(model.by_window.get(1)).to.deep.equal([
            mktab({id: 1, url: "foo", windowId: 1, index: 0}),
            mktab({id: 2, url: "bar", windowId: 1, index: 1}),
            mktab({id: 3, url: "fred", windowId: 1, index: 2}),
        ]);
        expect(model.by_window.get(2)).to.deep.equal([
            mktab({id: 4, url: "robert", windowId: 2, index: 0}),
            mktab({id: 5, url: "robert", windowId: 2, index: 1}),
            mktab({id: 6, url: "foo", windowId: 2, index: 2}),
        ]);
    });

    it("inserts new tabs into the correct window", async () => {
        model.whenTabCreated(mktab({id: 7, url: "a", windowId: 1, index: 3}));
        await events.next(model.by_id.onInsert);

        expect(model.by_window.get(1)).to.deep.equal([
            mktab({id: 1, url: "foo", windowId: 1, index: 0}),
            mktab({id: 2, url: "bar", windowId: 1, index: 1}),
            mktab({id: 3, url: "fred", windowId: 1, index: 2}),
            mktab({id: 7, url: "a", windowId: 1, index: 3}),
        ]);
        expect(model.by_window.get(2)).to.deep.equal([
            mktab({id: 4, url: "robert", windowId: 2, index: 0}),
            mktab({id: 5, url: "robert", windowId: 2, index: 1}),
            mktab({id: 6, url: "foo", windowId: 2, index: 2}),
        ]);
    });

    it("tracks tabs by URL", () => {
        expect(model.by_url.get("fred")).to.deep.equal([
            mktab({id: 3, url: "fred", windowId: 1, index: 2}),
        ]);

        expect(model.by_url.get("robert")).to.deep.equal([
            mktab({id: 4, url: "robert", windowId: 2, index: 0}),
            mktab({id: 5, url: "robert", windowId: 2, index: 1}),
        ]);
    });

    it("tracks tabs as their URLs change", async () => {
        // Initial state validated by the earlier tabs-by-url test
        model.whenTabUpdated(4, {url: "fred"});
        await events.next(model.by_id.onUpdate);

        expect(model.by_url.get("fred")).to.deep.equal([
            mktab({id: 3, url: "fred", windowId: 1, index: 2}),
            mktab({id: 4, url: "fred", windowId: 2, index: 0}),
        ]);
        expect(model.by_url.get("robert")).to.deep.equal([
            mktab({id: 5, url: "robert", windowId: 2, index: 1}),
        ]);
    });

    it("opens windows", async () => {
        model.whenWindowCreated({
            id: 17,
            focused: true,
            incognito: false,
            alwaysOnTop: false,
            tabs: [mktab({id: 42, windowId: 17, index: 0, url: "hurf"})],
        });
        await events.next(model.by_id.onInsert);

        expect(model.by_id.get(42))
            .to.deep.equal(mktab({id: 42, windowId: 17, index: 0, url: "hurf"}));
        expect(model.by_url.get("hurf")).to.deep.equal([
            mktab({id: 42, windowId: 17, index: 0, url: "hurf"}),
        ]);
        expect(model.by_window.get(17)).to.deep.equal([
            mktab({id: 42, windowId: 17, index: 0, url: "hurf"})
        ]);
    });

    it("opens tabs in new windows", async () => {
        model.whenTabCreated(mktab({id: 42, windowId: 17, index: 0, url: "hurf"}));
        await events.next(model.by_id.onInsert);

        expect(model.by_id.get(42))
            .to.deep.equal(mktab({id: 42, windowId: 17, index: 0, url: "hurf"}));
        expect(model.by_url.get("hurf")).to.deep.equal([
            mktab({id: 42, windowId: 17, index: 0, url: "hurf"}),
        ]);
        expect(model.by_window.get(17)).to.deep.equal([
            mktab({id: 42, windowId: 17, index: 0, url: "hurf"})
        ]);
    });

    it("handles duplicate tab-creation events gracefully", async () => {
        model.whenTabCreated(mktab({id: 42, windowId: 17, index: 0, url: "hurf"}));
        model.whenTabCreated(mktab({id: 42, windowId: 17, index: 0, url: "cats"}));
        await events.nextN(model.by_id.onInsert, 1);
        await events.nextN(model.by_id.onUpdate, 1);

        expect(model.by_id.get(42))
            .to.deep.equal(mktab({id: 42, windowId: 17, index: 0, url: "cats"}));
        expect(model.by_url.get("cats")).to.deep.equal([
            mktab({id: 42, windowId: 17, index: 0, url: "cats"}),
        ]);
        expect(model.by_window.get(17)).to.deep.equal([
            mktab({id: 42, windowId: 17, index: 0, url: "cats"})
        ]);
    });

    it("closes tabs", async () => {
        // Initial state validated by the earlier tabs-by-window test
        model.whenTabRemoved(5);
        await events.next(model.by_id.onDelete); // 5 was closed
        await events.next(model.by_id.onUpdate); // 6's index changed

        expect(model.by_window.get(2)).to.deep.equal([
            mktab({id: 4, url: "robert", windowId: 2, index: 0}),
            mktab({id: 6, url: "foo", windowId: 2, index: 1}),
        ]);
    });

    it("handles duplicate tab-close events gracefully", async () => {
        // Initial state validated by the earlier tabs-by-window test
        model.whenTabRemoved(5);
        model.whenTabRemoved(5);
        await events.next(model.by_id.onDelete); // 5 was closed
        await events.next(model.by_id.onUpdate); // 6's index changed

        expect(model.by_window.get(2)).to.deep.equal([
            mktab({id: 4, url: "robert", windowId: 2, index: 0}),
            mktab({id: 6, url: "foo", windowId: 2, index: 1}),
        ]);
    });

    it("drops tabs in a window when the window is closed", async () => {
        // Initial state validated by the earlier tabs-by-window test
        model.whenWindowRemoved(2);
        await events.nextN(model.by_id.onDelete, 3);

        expect(model.by_window.get(1)).to.not.be.undefined;
        expect(model.by_window.get(2)).to.deep.equal([]);
        expect(model.by_id.get(1)).to.not.be.undefined;
        expect(model.by_id.get(2)).to.not.be.undefined;
        expect(model.by_id.get(3)).to.not.be.undefined;
        expect(model.by_id.get(4)).to.be.undefined;
        expect(model.by_id.get(5)).to.be.undefined;
        expect(model.by_id.get(6)).to.be.undefined;
    });

    it("moves tabs within a window (forwards)", async () => {
        model.whenTabMoved(1, {windowId: 1, toIndex: 2});
        await events.nextN(model.by_id.onUpdate, 3);
        expect(model.by_window.get(1)).to.deep.equal([
            mktab({id: 2, url: "bar", windowId: 1, index: 0}),
            mktab({id: 3, url: "fred", windowId: 1, index: 1}),
            mktab({id: 1, url: "foo", windowId: 1, index: 2}),
        ]);
        expect(model.by_window.get(2)).to.deep.equal([
            mktab({id: 4, url: "robert", windowId: 2, index: 0}),
            mktab({id: 5, url: "robert", windowId: 2, index: 1}),
            mktab({id: 6, url: "foo", windowId: 2, index: 2}),
        ]);
    });

    it("moves tabs within a window (backwards)", async () => {
        model.whenTabMoved(3, {windowId: 1, toIndex: 0});
        await events.nextN(model.by_id.onUpdate, 3);
        expect(model.by_window.get(1)).to.deep.equal([
            mktab({id: 3, url: "fred", windowId: 1, index: 0}),
            mktab({id: 1, url: "foo", windowId: 1, index: 1}),
            mktab({id: 2, url: "bar", windowId: 1, index: 2}),
        ]);
        expect(model.by_window.get(2)).to.deep.equal([
            mktab({id: 4, url: "robert", windowId: 2, index: 0}),
            mktab({id: 5, url: "robert", windowId: 2, index: 1}),
            mktab({id: 6, url: "foo", windowId: 2, index: 2}),
        ]);
    });

    it("moves tabs between windows", async () => {
        model.whenTabAttached(2, {newWindowId: 2, newPosition: 1})
        await events.nextN(model.by_id.onUpdate, 4);
        expect(model.by_window.get(1)).to.deep.equal([
            mktab({id: 1, url: "foo", windowId: 1, index: 0}),
            mktab({id: 3, url: "fred", windowId: 1, index: 1}),
        ]);
        expect(model.by_window.get(2)).to.deep.equal([
            mktab({id: 4, url: "robert", windowId: 2, index: 0}),
            mktab({id: 2, url: "bar", windowId: 2, index: 1}),
            mktab({id: 5, url: "robert", windowId: 2, index: 2}),
            mktab({id: 6, url: "foo", windowId: 2, index: 3}),
        ]);
    });

    it("replaces tabs", async () => {
        const tab = model.by_id.get(3);
        expect(tab).to.not.be.undefined;

        model.whenTabReplaced(42, 3);
        await events.nextN(model.by_id.onUpdate, 1);
        await events.nextN(model.by_id.onMove, 1);

        expect(model.by_id.get(3)).to.be.undefined;
        expect(model.by_id.get(42)).to.equal(tab);

        expect(model.by_window.get(1)).to.deep.equal([
            mktab({id: 1, url: "foo", windowId: 1, index: 0}),
            mktab({id: 2, url: "bar", windowId: 1, index: 1}),
            mktab({id: 42, url: "fred", windowId: 1, index: 2}),
        ]);
        expect(model.by_window.get(2)).to.deep.equal([
            mktab({id: 4, url: "robert", windowId: 2, index: 0}),
            mktab({id: 5, url: "robert", windowId: 2, index: 1}),
            mktab({id: 6, url: "foo", windowId: 2, index: 2}),
        ]);
    });

    it("handles incomplete tabs gracefully", async () => {
        model.whenTabCreated(mktab({id: 42, windowId: 17, index: 0, /* no url */}));
        await events.nextN(model.by_id.onInsert, 1);

        expect(model.by_id.get(42))
            .to.deep.equal(mktab({id: 42, windowId: 17, index: 0}));

        model.whenTabUpdated(42, {url: 'hi'});
        model.whenTabMoved(42, {windowId: 2, toIndex: 1});
        await events.nextN(model.by_id.onUpdate, 3);

        expect(model.by_id.get(42))
            .to.deep.equal(mktab({id: 42, windowId: 2, index: 1, url: 'hi'}));
        expect(model.by_url.get('hi')).to.deep.equal([
            mktab({id: 42, windowId: 2, index: 1, url: 'hi'})
        ]);
        expect(model.by_window.get(17)).to.deep.equal([]);
        expect(model.by_window.get(2)).to.deep.equal([
            mktab({id: 4, url: "robert", windowId: 2, index: 0}),
            mktab({id: 42, url: 'hi', windowId: 2, index: 1}),
            mktab({id: 5, url: "robert", windowId: 2, index: 2}),
            mktab({id: 6, url: "foo", windowId: 2, index: 3}),
        ]);
    });

    it("activates tabs", async () => {
        model.whenTabActivated({tabId: 1, windowId: 1});
        await events.nextN(model.by_id.onUpdate, 1);
        expect(model.by_id.get(1)!.active).to.equal(true);

        model.whenTabActivated({tabId: 2, windowId: 1});
        await events.nextN(model.by_id.onUpdate, 2); // deactivate then activate
        expect(model.by_id.get(1)!.active).to.equal(false);
        expect(model.by_id.get(2)!.active).to.equal(true);
    });
});

import {expect} from "chai";
import browser from "webextension-polyfill";

import * as events from "../mock/events";

import {B, make_tabs, type TabFixture} from "./fixtures.testlib";
import * as M from "./tabs";

describe("model/tabs", () => {
  let windows: TabFixture["windows"];
  let tabs: TabFixture["tabs"];
  let model: M.Model;

  beforeEach(async () => {
    const setup = await make_tabs();
    windows = setup.windows;
    tabs = setup.tabs;

    model = await M.Model.from_browser();
    expect(events.pendingCount()).to.equal(0);
  });

  it("loads tabs correctly", async () => {
    for (const t in tabs) {
      const tab = tabs[t as keyof typeof tabs];
      // istanbul ignore next -- the ?? operators always short-circuit
      expect(model.tab(tab.id)).to.deep.include({
        id: tab.id,
        position: {
          parent: model.window(tab.windowId!),
          index: tab.index,
        },
        status: "complete",
        title: tab.title ?? "",
        url: tab.url ?? "",
        favIconUrl: tab.favIconUrl ?? "",
        pinned: !!tab.pinned,
        hidden: !!tab.hidden,
        active: !!tab.active,
        highlighted: !!tab.highlighted,
        discarded: !!tab.discarded,
        cookieStoreId: tab.cookieStoreId,
      });
    }
  });

  it("tracks tabs by window", async () => {
    for (const w in windows) {
      const win = windows[w as keyof typeof windows];
      expect(model.window(win.id)!.children.map(t => t.id)).to.deep.equal(
        win.tabs!.map(t => t.id),
      );
    }
  });

  it("inserts new tabs into the correct window", async () => {
    const t = await browser.tabs.create({
      windowId: windows.left.id,
      index: 3,
      url: "a",
      active: false,
    });
    await events.next(browser.tabs.onCreated);

    expect(model.tab(t.id! as M.TabID)).to.deep.include({
      id: t.id,
      status: "loading",
      title: "",
      url: "a",
      favIconUrl: "",
      hidden: false,
      active: false,
      pinned: false,
      highlighted: false,
      discarded: false,
      cookieStoreId: undefined,
    });
    expect(model.tab(t.id! as M.TabID)!.position).to.deep.equal({
      parent: model.window(windows.left.id),
      index: 3,
    });

    await events.next(browser.tabs.onUpdated);
    expect(model.tab(t.id! as M.TabID)).to.deep.include({
      id: t.id,
      status: "complete",
      title: "",
      url: "a",
    });
    expect(model.tab(t.id! as M.TabID)!.position).to.deep.equal({
      parent: model.window(windows.left.id),
      index: 3,
    });

    expect(
      model.window(windows.left.id)!.children.map(t => t.id),
    ).to.deep.equal([
      tabs.left_alice.id,
      tabs.left_betty.id,
      tabs.left_charlotte.id,
      t.id!,
    ]);
    expect(
      model.window(windows.right.id)!.children.map(t => t.id),
    ).to.deep.equal([
      tabs.right_blank.id,
      tabs.right_adam.id,
      tabs.right_doug.id,
    ]);
  });

  it("tracks tabs by URL", () => {
    expect(model.tabsWithURL(`${B}#doug`)).to.deep.equal(
      new Set([
        model.tab(tabs.right_doug.id),
        model.tab(tabs.real_doug.id),
        model.tab(tabs.real_doug_2.id),
      ]),
    );
    expect(model.tabsWithURL(`${B}`)).to.deep.equal(
      new Set([model.tab(tabs.right_blank.id), model.tab(tabs.real_blank.id)]),
    );
    expect(model.tabsWithURL(`${B}#paul`)).to.deep.equal(
      new Set([model.tab(tabs.real_paul.id)]),
    );
  });

  it("tracks tabs as their URLs change", async () => {
    // Initial state validated by the earlier tabs-by-url test
    await browser.tabs.update(tabs.right_blank.id, {url: `${B}#paul`});
    await events.nextN(browser.tabs.onUpdated, 2);

    expect(model.tabsWithURL(`${B}`)).to.deep.equal(
      new Set([model.tab(tabs.real_blank.id)]),
    );
    expect(model.tabsWithURL(`${B}#paul`)).to.deep.equal(
      new Set([model.tab(tabs.real_paul.id), model.tab(tabs.right_blank.id)]),
    );
  });

  it("opens and closes windows", async () => {
    const win = await browser.windows.create({url: `${B}#hi`});
    await events.next(browser.windows.onCreated);
    await events.next(browser.tabs.onCreated);
    await events.next(browser.windows.onFocusChanged);
    await events.next(browser.tabs.onActivated);
    await events.next(browser.tabs.onHighlighted);
    await events.next(browser.tabs.onUpdated);

    const tid = win.tabs![0].id as M.TabID;

    expect(model.tab(tid)).to.deep.include({
      id: tid,
      position: {parent: model.window(win.id!)!, index: 0},
      url: `${B}#hi`,
    });
    expect(model.tabsWithURL(`${B}#hi`)).to.deep.equal(
      new Set([model.tab(tid)]),
    );
    expect(
      model.window(win.id as M.WindowID)!.children.map(t => t.id),
    ).to.deep.equal([tid]);

    // Cleanup for running this test in a live environment - close the
    // window we just created
    await browser.windows.remove(win.id!);
    await events.next(browser.windows.onRemoved);
    await events.next(browser.windows.onFocusChanged);

    expect(model.tab(tid)).to.be.undefined;
    expect(model.window(win.id as M.WindowID)).to.be.undefined;
  });

  it("opens tabs in new windows", async () => {
    // In this test, we are simulating the scenario where we miss some
    // browser events (e.g. window creation); we should fill in the blanks
    // correctly (so to speak).
    const tab = {
      id: 16384,
      windowId: 16590,
      index: 0,
      url: "hi",
      highlighted: false,
      active: false,
      pinned: false,
      incognito: false,
      cookieStoreId: undefined,
    };
    events.send(browser.tabs.onCreated, tab);
    await events.next(browser.tabs.onCreated);

    expect(model.tab(16384 as M.TabID)).to.deep.equal({
      id: tab.id,
      position: {
        parent: model.window(16590 as M.WindowID)!,
        index: 0,
      },
      status: "loading",
      title: "",
      url: "hi",
      favIconUrl: "",
      pinned: false,
      hidden: false,
      active: false,
      highlighted: false,
      discarded: false,
      cookieStoreId: tab.cookieStoreId,
    });
    expect(Array.from(model.tabsWithURL("hi"))).to.deep.equal([
      model.tab(16384 as M.TabID),
    ]);
    expect(
      model.window(16590 as M.WindowID)!.children.map(t => t.id),
    ).to.deep.equal([tab.id]);
  });

  it("handles duplicate tab-creation events gracefully", async () => {
    const win = await browser.windows.create({url: `${B}#hi`});
    const tab = win.tabs![0];
    const tid = tab.id as M.TabID;
    await events.next(browser.windows.onCreated);
    await events.next(browser.tabs.onCreated);
    await events.next(browser.windows.onFocusChanged);
    await events.next(browser.tabs.onActivated);
    await events.next(browser.tabs.onHighlighted);
    await events.next(browser.tabs.onUpdated);

    events.send(browser.tabs.onCreated, {
      id: tab.id!,
      windowId: win.id!,
      index: 0,
      url: "cats",
      active: tab.active,
      pinned: tab.pinned,
      highlighted: tab.highlighted,
      incognito: tab.incognito,
    });
    await events.next(browser.tabs.onCreated);
    tab.url = "cats";

    // istanbul ignore next -- the ?? operators always short-circuit
    expect(model.tab(tid)).to.deep.include({
      id: tid,
      status: tab.status ?? "loading",
      title: tab.title ?? "",
      url: tab.url ?? "",
      favIconUrl: tab.favIconUrl ?? "",
      pinned: !!tab.pinned,
      hidden: !!tab.hidden,
      active: !!tab.active,
      highlighted: !!tab.highlighted,
      discarded: !!tab.discarded,
      cookieStoreId: tab.cookieStoreId,
    });
    expect(model.tab(tid)).to.deep.include({
      position: {parent: model.window(win.id!)!, index: 0},
    });
    expect(model.tabsWithURL("cats")).to.deep.equal(new Set([model.tab(tid)]));
    expect(
      model.window(win.id! as M.WindowID)!.children.map(t => t.id),
    ).to.deep.equal([tid]);

    // Cleanup when running in a live environment - close the window we just
    // created
    await browser.windows.remove(win.id!);
    await events.next(browser.windows.onRemoved);
    await events.next(browser.windows.onFocusChanged);

    expect(model.tab(tid)).to.be.undefined;
    expect(model.window(win.id! as M.WindowID)).to.be.undefined;
  });

  it("closes tabs", async () => {
    // Initial state validated by the earlier tabs-by-window test
    await browser.tabs.remove(tabs.right_adam.id);
    await events.next(browser.tabs.onRemoved);

    expect(model.tab(tabs.right_adam.id)).to.be.undefined;
    expect(
      model.window(windows.right.id)!.children.map(t => t.id),
    ).to.deep.equal([tabs.right_blank.id, tabs.right_doug.id]);
  });

  it("closes windows", async () => {
    const p = model.removeWindows([model.window(windows.left.id)!]);
    await events.next(browser.windows.onRemoved);
    await p;

    expect(model.tab(tabs.left_alice.id)).to.be.undefined;
    expect(model.tab(tabs.left_betty.id)).to.be.undefined;
    expect(model.tab(tabs.left_charlotte.id)).to.be.undefined;
    expect(model.window(windows.left.id)).to.be.undefined;
  });

  it("handles duplicate tab-close events gracefully", async () => {
    // Initial state validated by the earlier tabs-by-window test
    await browser.tabs.remove(tabs.right_adam.id);
    const ev = await events.next(browser.tabs.onRemoved);
    events.send(browser.tabs.onRemoved, ...ev);
    await events.next(browser.tabs.onRemoved);

    expect(model.tab(tabs.right_adam.id)).to.be.undefined;
    expect(
      model.window(windows.right.id)!.children.map(t => t.id),
    ).to.deep.equal([tabs.right_blank.id, tabs.right_doug.id]);
  });

  it("drops tabs in a window when the window is closed", async () => {
    // Initial state validated by the earlier tabs-by-window test
    await browser.windows.remove(windows.right.id);
    await events.next(browser.windows.onRemoved);

    expect(model.window(windows.right.id)).to.be.undefined;
    expect(model.tab(tabs.left_alice.id)).to.not.be.undefined;
    expect(model.tab(tabs.left_betty.id)).to.not.be.undefined;
    expect(model.tab(tabs.left_charlotte.id)).to.not.be.undefined;
    expect(model.tab(tabs.right_blank.id)).to.be.undefined;
    expect(model.tab(tabs.right_adam.id)).to.be.undefined;
    expect(model.tab(tabs.right_doug.id)).to.be.undefined;
  });

  it("moves tabs within a window (forwards)", async () => {
    await browser.tabs.move(tabs.left_alice.id, {
      windowId: windows.left.id,
      index: 2,
    });
    await events.next(browser.tabs.onMoved);

    const left = model.window(windows.left.id)!;
    expect(left.children.map(t => t.id)).to.deep.equal([
      tabs.left_betty.id,
      tabs.left_charlotte.id,
      tabs.left_alice.id,
    ]);
    expect(model.tab(tabs.left_betty.id)).to.deep.include({
      position: {parent: left, index: 0},
    });
    expect(model.tab(tabs.left_charlotte.id)).to.deep.include({
      position: {parent: left, index: 1},
    });
    expect(model.tab(tabs.left_alice.id)).to.deep.include({
      position: {parent: left, index: 2},
    });

    const right = model.window(windows.right.id)!;
    expect(right.children.map(t => t.id)).to.deep.equal([
      tabs.right_blank.id,
      tabs.right_adam.id,
      tabs.right_doug.id,
    ]);
    expect(model.tab(tabs.right_blank.id)).to.deep.include({
      position: {parent: right, index: 0},
    });
    expect(model.tab(tabs.right_adam.id)).to.deep.include({
      position: {parent: right, index: 1},
    });
    expect(model.tab(tabs.right_doug.id)).to.deep.include({
      position: {parent: right, index: 2},
    });
  });

  it("moves tabs within a window (backwards)", async () => {
    await browser.tabs.move(tabs.left_charlotte.id, {
      windowId: windows.left.id,
      index: 0,
    });
    await events.next(browser.tabs.onMoved);

    const left = model.window(windows.left.id)!;
    expect(left.children.map(t => t.id)).to.deep.equal([
      tabs.left_charlotte.id,
      tabs.left_alice.id,
      tabs.left_betty.id,
    ]);
    expect(model.tab(tabs.left_charlotte.id)).to.deep.include({
      position: {parent: left, index: 0},
    });
    expect(model.tab(tabs.left_alice.id)).to.deep.include({
      position: {parent: left, index: 1},
    });
    expect(model.tab(tabs.left_betty.id)).to.deep.include({
      position: {parent: left, index: 2},
    });

    const right = model.window(windows.right.id)!;
    expect(right.children.map(t => t.id)).to.deep.equal([
      tabs.right_blank.id,
      tabs.right_adam.id,
      tabs.right_doug.id,
    ]);
    expect(model.tab(tabs.right_blank.id)).to.deep.include({
      position: {parent: right, index: 0},
    });
    expect(model.tab(tabs.right_adam.id)).to.deep.include({
      position: {parent: right, index: 1},
    });
    expect(model.tab(tabs.right_doug.id)).to.deep.include({
      position: {parent: right, index: 2},
    });
  });

  it("moves tabs between windows", async () => {
    await browser.tabs.move(tabs.left_betty.id, {
      windowId: windows.right.id,
      index: 1,
    });
    await events.next(browser.tabs.onAttached);

    const left = model.window(windows.left.id)!;
    expect(left.children.map(t => t.id)).to.deep.equal([
      tabs.left_alice.id,
      tabs.left_charlotte.id,
    ]);
    expect(model.tab(tabs.left_alice.id)).to.deep.include({
      position: {parent: left, index: 0},
    });
    expect(model.tab(tabs.left_charlotte.id)).to.deep.include({
      position: {parent: left, index: 1},
    });

    const right = model.window(windows.right.id)!;
    expect(right.children.map(t => t.id)).to.deep.equal([
      tabs.right_blank.id,
      tabs.left_betty.id,
      tabs.right_adam.id,
      tabs.right_doug.id,
    ]);
    expect(model.tab(tabs.right_blank.id)).to.deep.include({
      position: {parent: right, index: 0},
    });
    expect(model.tab(tabs.left_betty.id)).to.deep.include({
      position: {parent: right, index: 1},
    });
    expect(model.tab(tabs.right_adam.id)).to.deep.include({
      position: {parent: right, index: 2},
    });
    expect(model.tab(tabs.right_doug.id)).to.deep.include({
      position: {parent: right, index: 3},
    });
  });

  it("replaces tabs", async () => {
    const tab = model.tab(tabs.left_charlotte.id);

    events.send(browser.tabs.onReplaced, 16384, tabs.left_charlotte.id);
    await events.next(browser.tabs.onReplaced);

    expect(model.tab(tabs.left_charlotte.id)).to.be.undefined;
    expect(model.tab(16384 as M.TabID)).to.equal(tab);

    expect(
      model.window(windows.left.id)!.children.map(t => t.id),
    ).to.deep.equal([tabs.left_alice.id, tabs.left_betty.id, 16384 as M.TabID]);
    expect(
      model.window(windows.right.id)!.children.map(t => t.id),
    ).to.deep.equal([
      tabs.right_blank.id,
      tabs.right_adam.id,
      tabs.right_doug.id,
    ]);
  });

  it("handles incomplete tabs gracefully", async () => {
    const t = {
      id: 16384,
      windowId: 16590,
      index: 0,
      title: "",
      url: "",
      active: false,
      pinned: false,
      highlighted: false,
      hidden: false,
      discarded: false,
    };
    events.send(browser.tabs.onCreated, JSON.parse(JSON.stringify(t)));
    await events.next(browser.tabs.onCreated);

    expect(model.tab(16384 as M.TabID)).to.deep.include({
      id: 16384,
      position: {
        parent: model.window(16590 as M.WindowID),
        index: 0,
      },
    });

    t.url = "hi";
    events.send(
      browser.tabs.onUpdated,
      16384,
      {url: "hi"},
      JSON.parse(JSON.stringify(t)),
    );
    await events.next(browser.tabs.onUpdated);

    expect(model.tab(16384 as M.TabID)).to.deep.include({id: 16384, url: "hi"});
    expect(model.tabsWithURL("hi")).to.deep.equal(
      new Set([model.tab(16384 as M.TabID)]),
    );
  });

  it("activates tabs", async () => {
    expect(model.tab(tabs.left_alice.id)!.active).to.equal(true);

    await browser.tabs.update(tabs.left_charlotte.id, {active: true});
    await events.next(browser.tabs.onActivated);
    await events.next(browser.tabs.onHighlighted);

    expect(model.tab(tabs.left_alice.id)!.active).to.equal(false);
    expect(model.tab(tabs.left_charlotte.id)!.active).to.equal(true);
  });
});

import {expect} from "chai";
import browser from "webextension-polyfill";

import * as events from "../mock/events.js";

import {B, make_tabs, type TabFixture} from "./fixtures.testlib.js";
import * as M from "./tabs.js";

describe("model/tabs", () => {
  let windows: TabFixture["windows"];
  let groups: TabFixture["groups"];
  let tabs: TabFixture["tabs"];
  let model: M.Model;

  beforeEach(async () => {
    const setup = await make_tabs();
    windows = setup.windows;
    groups = setup.groups;
    tabs = setup.tabs;

    model = await M.Model.from_browser();
    expect(events.pendingCount()).to.equal(0);
  });

  it("loads tabs correctly", async () => {
    for (const t in tabs) {
      const tab = tabs[t as keyof typeof tabs];
      /* c8 ignore next -- the ?? operators always short-circuit */
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
        groupId: tab.groupId,
      });
    }
  });

  it("loads tab groups correctly", async () => {
    for (const g in groups) {
      const group = groups[g as keyof typeof groups];
      expect(model.group(group.id)).to.deep.include({
        id: group.id,
        title: group.title,
        color: group.color,
        collapsed: group.collapsed,
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
      url: "about:blank#insert-new-tab",
      active: false,
    });
    await events.next(browser.tabs.onCreated);

    expect(model.tab(t.id! as M.TabID)).to.deep.include({
      id: t.id,
      status: "loading",
      title: "",
      url: "about:blank#insert-new-tab",
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
      url: "about:blank#insert-new-tab",
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
    await events.next(browser.tabs.onRemoved);
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
      groupId: undefined,
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

    /* c8 ignore next -- the ?? operators always short-circuit */
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
    await events.next(browser.tabs.onRemoved);
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
    await events.nextN(browser.tabs.onRemoved, 3);
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
    await events.nextN(browser.tabs.onRemoved, 3);
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

  describe("refocusAwayFromTabs()", () => {
    function test(options: {
      window: keyof TabFixture["windows"];
      activeTab: keyof TabFixture["tabs"];
      closingTab: keyof TabFixture["tabs"];
      newActiveTab?: keyof TabFixture["tabs"];
    }) {
      it(JSON.stringify(options), async () => {
        if (!tabs[options.activeTab].active) {
          await browser.tabs.update(tabs[options.activeTab].id, {active: true});
          await events.next(browser.tabs.onActivated);
          await events.next(browser.tabs.onHighlighted);
        }

        const closingTab = model.tab(tabs[options.closingTab].id)!;
        const activeTab = model.tab(tabs[options.activeTab].id)!;
        let newActiveTab = options.newActiveTab
          ? model.tab(tabs[options.newActiveTab].id)!
          : undefined;

        expect(closingTab, "closingTab").to.not.be.undefined;
        expect(activeTab, "activeTab").to.not.be.undefined;
        if (options.newActiveTab) {
          expect(newActiveTab, "newActiveTab").to.not.be.undefined;
        }

        await model.refocusAwayFromTabs([closingTab]);

        if (activeTab !== newActiveTab) {
          if (!options.newActiveTab) {
            const ev = await events.next(browser.tabs.onCreated);
            newActiveTab = model.tab(ev[0].id!);
            expect(newActiveTab, "newActiveTab [opened]").to.not.be.undefined;
            await events.next(browser.tabs.onUpdated);
          }

          await events.next(browser.tabs.onActivated);
          await events.next(browser.tabs.onHighlighted);
          expect(activeTab.active, "activeTab is not active").to.be.false;
        }

        expect(newActiveTab!.active, "newActiveTab is active").to.be.true;
      });
    }

    test({
      window: "real",
      activeTab: "real_blank",
      closingTab: "real_blank",
      newActiveTab: "real_bob",
    });
    test({
      window: "real",
      activeTab: "real_blank",
      closingTab: "real_bob",
      newActiveTab: "real_blank",
    });
    test({
      window: "real",
      activeTab: "real_blank",
      closingTab: "real_estelle",
      newActiveTab: "real_blank",
    });
    test({
      window: "real",
      activeTab: "real_estelle",
      closingTab: "real_estelle",
      newActiveTab: "real_francis",
    });
    test({
      window: "real",
      activeTab: "real_unstashed",
      closingTab: "real_unstashed",
      newActiveTab: "real_francis",
    });
    test({
      window: "small",
      activeTab: "small_active",
      closingTab: "small_active",
      newActiveTab: undefined,
    });
  });

  describe("tab groups", () => {
    it("creates groups from multiple existing tabs at once", async () => {
      const gid = await browser.tabs.group({
        tabIds: [tabs.left_alice.id, tabs.left_betty.id],
      });
      expect(gid).to.not.equal(groups.ef.id);
      await events.next(browser.tabGroups.onCreated);
      await events.nextN(browser.tabs.onUpdated, 2);

      expect(
        model
          .window(windows.left.id)!
          .children.map(t => [t.url, t.id, t.groupId]),
      ).to.deep.equal([
        [tabs.left_alice.url, tabs.left_alice.id, gid],
        [tabs.left_betty.url, tabs.left_betty.id, gid],
        [tabs.left_charlotte.url, tabs.left_charlotte.id, -1],
      ]);

      expect(model.group(gid as M.TabGroupID)).to.deep.include({
        id: gid,
        title: "",
        color: "grey",
        collapsed: false,
      });
      expect(model.tab(tabs.left_alice.id)).to.deep.include({
        groupId: gid,
      });
      expect(model.tab(tabs.left_betty.id)).to.deep.include({
        groupId: gid,
      });
    });

    describe("new tab is created inside a group", () => {
      // This is untestable; there is no groupId parameter, so it's impossible
      // to create a tab directly inside the group. The best we can do is akin
      // to "tab stays in position and moves into group".
      // it("...at the beginning of the group");

      it("...in the middle of the group", async () => {
        const tab = await browser.tabs.create({
          windowId: windows.real.id,
          index: tabs.real_francis.index,
          url: `${B}#new-next-to-francis`,
        });
        await events.next(browser.tabs.onCreated);
        await events.next(browser.tabs.onUpdated);
        await events.next(browser.tabs.onActivated);
        await events.next(browser.tabs.onHighlighted);

        expect(
          model
            .window(windows.real.id)!
            .children.map(t => [t.url, t.id, t.groupId]),
        ).to.deep.equal([
          [tabs.real_patricia.url, tabs.real_patricia.id, -1],
          [tabs.real_paul.url, tabs.real_paul.id, -1],
          [tabs.real_blank.url, tabs.real_blank.id, -1],
          [tabs.real_bob.url, tabs.real_bob.id, -1],
          [tabs.real_doug.url, tabs.real_doug.id, -1],
          [tabs.real_doug_2.url, tabs.real_doug_2.id, -1],
          [tabs.real_estelle.url, tabs.real_estelle.id, groups.ef.id],
          [`${B}#new-next-to-francis`, tab.id, groups.ef.id],
          [tabs.real_francis.url, tabs.real_francis.id, groups.ef.id],
          [tabs.real_harry.url, tabs.real_harry.id, -1],
          [tabs.real_unstashed.url, tabs.real_unstashed.id, -1],
          [tabs.real_helen.url, tabs.real_helen.id, -1],
        ]);

        expect(model.tab(tab.id! as M.TabID)).to.deep.include({
          id: tab.id,
          url: tab.url,
          groupId: groups.ef.id,
        });
      });

      // it("...at the end of the group"); // same problem as "beginning"
    });

    it("tab changes position and moves into group", async () => {
      await browser.tabs.move(tabs.real_blank.id, {
        windowId: windows.real.id,
        index: tabs.real_estelle.index,
      });
      await events.next(browser.tabs.onMoved);
      await events.next(browser.tabs.onUpdated);

      expect(
        model
          .window(windows.real.id)!
          .children.map(t => [t.url, t.id, t.groupId]),
      ).to.deep.equal([
        [tabs.real_patricia.url, tabs.real_patricia.id, -1],
        [tabs.real_paul.url, tabs.real_paul.id, -1],
        [tabs.real_bob.url, tabs.real_bob.id, -1],
        [tabs.real_doug.url, tabs.real_doug.id, -1],
        [tabs.real_doug_2.url, tabs.real_doug_2.id, -1],
        [tabs.real_estelle.url, tabs.real_estelle.id, groups.ef.id],
        [tabs.real_blank.url, tabs.real_blank.id, groups.ef.id],
        [tabs.real_francis.url, tabs.real_francis.id, groups.ef.id],
        [tabs.real_harry.url, tabs.real_harry.id, -1],
        [tabs.real_unstashed.url, tabs.real_unstashed.id, -1],
        [tabs.real_helen.url, tabs.real_helen.id, -1],
      ]);

      expect(model.tab(tabs.real_blank.id)).to.deep.include({
        groupId: groups.ef.id,
      });
      expect(model.tab(tabs.real_blank.id)!.position).to.deep.include({
        index: tabs.real_estelle.index,
      });
    });

    describe("tab stays in position and...", () => {
      describe("...is not in a group and is added to an adjacent group", () => {
        it("...at the beginning", async () => {
          await browser.tabs.show(tabs.real_doug_2.id);
          await events.next(browser.tabs.onUpdated);

          await browser.tabs.group({
            groupId: groups.ef.id,
            tabIds: [tabs.real_doug_2.id],
          });
          await events.next(browser.tabs.onUpdated);
          // It moves to the end of the group. Sadly there's no way to simulate
          // in the API what the user can actually do--drag a tab into the
          // beginning of the group.
          await events.next(browser.tabs.onMoved);

          expect(
            model
              .window(windows.real.id)!
              .children.map(t => [t.url, t.id, t.groupId]),
          ).to.deep.equal([
            [tabs.real_patricia.url, tabs.real_patricia.id, -1],
            [tabs.real_paul.url, tabs.real_paul.id, -1],
            [tabs.real_blank.url, tabs.real_blank.id, -1],
            [tabs.real_bob.url, tabs.real_bob.id, -1],
            [tabs.real_doug.url, tabs.real_doug.id, -1],
            [tabs.real_estelle.url, tabs.real_estelle.id, groups.ef.id],
            [tabs.real_francis.url, tabs.real_francis.id, groups.ef.id],
            [tabs.real_doug_2.url, tabs.real_doug_2.id, groups.ef.id],
            [tabs.real_harry.url, tabs.real_harry.id, -1],
            [tabs.real_unstashed.url, tabs.real_unstashed.id, -1],
            [tabs.real_helen.url, tabs.real_helen.id, -1],
          ]);

          expect(model.tab(tabs.real_doug_2.id)).to.deep.include({
            groupId: groups.ef.id,
          });
        });

        it("...at the end", async () => {
          await browser.tabs.show(tabs.real_harry.id);
          await events.next(browser.tabs.onUpdated);

          await browser.tabs.group({
            groupId: groups.ef.id,
            tabIds: [tabs.real_harry.id],
          });
          await events.next(browser.tabs.onUpdated);

          expect(
            model
              .window(windows.real.id)!
              .children.map(t => [t.url, t.id, t.groupId]),
          ).to.deep.equal([
            [tabs.real_patricia.url, tabs.real_patricia.id, -1],
            [tabs.real_paul.url, tabs.real_paul.id, -1],
            [tabs.real_blank.url, tabs.real_blank.id, -1],
            [tabs.real_bob.url, tabs.real_bob.id, -1],
            [tabs.real_doug.url, tabs.real_doug.id, -1],
            [tabs.real_doug_2.url, tabs.real_doug_2.id, -1],
            [tabs.real_estelle.url, tabs.real_estelle.id, groups.ef.id],
            [tabs.real_francis.url, tabs.real_francis.id, groups.ef.id],
            [tabs.real_harry.url, tabs.real_harry.id, groups.ef.id],
            [tabs.real_unstashed.url, tabs.real_unstashed.id, -1],
            [tabs.real_helen.url, tabs.real_helen.id, -1],
          ]);

          expect(model.tab(tabs.real_harry.id)).to.deep.include({
            groupId: groups.ef.id,
          });
        });
      });

      describe("...switches from one group to an adjacent group", () => {
        let groupId: number = -1;
        beforeEach(async () => {
          await browser.tabs.show(tabs.real_doug_2.id);
          await events.next(browser.tabs.onUpdated);
          expect(model.tab(tabs.real_doug_2.id)).to.deep.include({
            groupId: -1,
            hidden: false,
          });

          groupId = await browser.tabs.group({
            tabIds: [tabs.real_doug.id, tabs.real_doug_2.id],
          });
          expect(groupId).to.not.equal(groups.ef.id);
          await events.next(browser.tabGroups.onCreated);
          await events.next(browser.tabs.onUpdated);
          await events.next(browser.tabs.onUpdated);

          expect(
            model
              .window(windows.real.id)!
              .children.map(t => [t.url, t.id, t.groupId]),
          ).to.deep.equal([
            [tabs.real_patricia.url, tabs.real_patricia.id, -1],
            [tabs.real_paul.url, tabs.real_paul.id, -1],
            [tabs.real_blank.url, tabs.real_blank.id, -1],
            [tabs.real_bob.url, tabs.real_bob.id, -1],
            [tabs.real_doug.url, tabs.real_doug.id, groupId],
            [tabs.real_doug_2.url, tabs.real_doug_2.id, groupId],
            [tabs.real_estelle.url, tabs.real_estelle.id, groups.ef.id],
            [tabs.real_francis.url, tabs.real_francis.id, groups.ef.id],
            [tabs.real_harry.url, tabs.real_harry.id, -1],
            [tabs.real_unstashed.url, tabs.real_unstashed.id, -1],
            [tabs.real_helen.url, tabs.real_helen.id, -1],
          ]);

          expect(model.tab(tabs.real_doug.id)).to.deep.include({groupId});
          expect(model.tab(tabs.real_doug_2.id)).to.deep.include({groupId});
        });

        it("...from the beginning of the old group to the end of the new group", async () => {
          await browser.tabs.group({groupId, tabIds: [tabs.real_estelle.id]});
          await events.next(browser.tabs.onUpdated);

          expect(
            model
              .window(windows.real.id)!
              .children.map(t => [t.url, t.id, t.groupId]),
          ).to.deep.equal([
            [tabs.real_patricia.url, tabs.real_patricia.id, -1],
            [tabs.real_paul.url, tabs.real_paul.id, -1],
            [tabs.real_blank.url, tabs.real_blank.id, -1],
            [tabs.real_bob.url, tabs.real_bob.id, -1],
            [tabs.real_doug.url, tabs.real_doug.id, groupId],
            [tabs.real_doug_2.url, tabs.real_doug_2.id, groupId],
            [tabs.real_estelle.url, tabs.real_estelle.id, groupId],
            [tabs.real_francis.url, tabs.real_francis.id, groups.ef.id],
            [tabs.real_harry.url, tabs.real_harry.id, -1],
            [tabs.real_unstashed.url, tabs.real_unstashed.id, -1],
            [tabs.real_helen.url, tabs.real_helen.id, -1],
          ]);

          expect(model.tab(tabs.real_estelle.id)).to.deep.include({groupId});
        });

        it("...from the end of the old group to the [end] of the new group", async () => {
          // Sadly there is no way to simulate moving to the beginning of the
          // new group, which is what the user can do by dragging the tab to the
          // beginning of the new group.
          await browser.tabs.group({
            groupId: groups.ef.id,
            tabIds: [tabs.real_doug_2.id],
          });
          await events.next(browser.tabs.onUpdated);
          await events.next(browser.tabs.onMoved);

          expect(
            model
              .window(windows.real.id)!
              .children.map(t => [t.url, t.id, t.groupId]),
          ).to.deep.equal([
            [tabs.real_patricia.url, tabs.real_patricia.id, -1],
            [tabs.real_paul.url, tabs.real_paul.id, -1],
            [tabs.real_blank.url, tabs.real_blank.id, -1],
            [tabs.real_bob.url, tabs.real_bob.id, -1],
            [tabs.real_doug.url, tabs.real_doug.id, groupId],
            [tabs.real_estelle.url, tabs.real_estelle.id, groups.ef.id],
            [tabs.real_francis.url, tabs.real_francis.id, groups.ef.id],
            [tabs.real_doug_2.url, tabs.real_doug_2.id, groups.ef.id],
            [tabs.real_harry.url, tabs.real_harry.id, -1],
            [tabs.real_unstashed.url, tabs.real_unstashed.id, -1],
            [tabs.real_helen.url, tabs.real_helen.id, -1],
          ]);

          expect(model.tab(tabs.real_doug_2.id)).to.deep.include({
            groupId: groups.ef.id,
          });
        });
      });

      it("...is added to a completely new group", async () => {
        // Tested directly in beforeEach
      });

      it("...is removed from its group", async () => {
        await browser.tabs.ungroup(tabs.real_estelle.id);
        await events.next(browser.tabs.onUpdated);

        expect(
          model
            .window(windows.real.id)!
            .children.map(t => [t.url, t.id, t.groupId]),
        ).to.deep.equal([
          [tabs.real_patricia.url, tabs.real_patricia.id, -1],
          [tabs.real_paul.url, tabs.real_paul.id, -1],
          [tabs.real_blank.url, tabs.real_blank.id, -1],
          [tabs.real_bob.url, tabs.real_bob.id, -1],
          [tabs.real_doug.url, tabs.real_doug.id, -1],
          [tabs.real_doug_2.url, tabs.real_doug_2.id, -1],
          [tabs.real_estelle.url, tabs.real_estelle.id, -1],
          [tabs.real_francis.url, tabs.real_francis.id, groups.ef.id],
          [tabs.real_harry.url, tabs.real_harry.id, -1],
          [tabs.real_unstashed.url, tabs.real_unstashed.id, -1],
          [tabs.real_helen.url, tabs.real_helen.id, -1],
        ]);

        expect(model.tab(tabs.real_doug.id)).to.deep.include({
          groupId: -1,
        });
      });

      it("...is removed from its group and the group is destroyed", async () => {
        await browser.tabs.ungroup([
          tabs.real_estelle.id,
          tabs.real_francis.id,
        ]);
        await events.nextN(browser.tabs.onUpdated, 2);
        await events.next(browser.tabGroups.onRemoved);

        expect(
          model
            .window(windows.real.id)!
            .children.map(t => [t.url, t.id, t.groupId]),
        ).to.deep.equal([
          [tabs.real_patricia.url, tabs.real_patricia.id, -1],
          [tabs.real_paul.url, tabs.real_paul.id, -1],
          [tabs.real_blank.url, tabs.real_blank.id, -1],
          [tabs.real_bob.url, tabs.real_bob.id, -1],
          [tabs.real_doug.url, tabs.real_doug.id, -1],
          [tabs.real_doug_2.url, tabs.real_doug_2.id, -1],
          [tabs.real_estelle.url, tabs.real_estelle.id, -1],
          [tabs.real_francis.url, tabs.real_francis.id, -1],
          [tabs.real_harry.url, tabs.real_harry.id, -1],
          [tabs.real_unstashed.url, tabs.real_unstashed.id, -1],
          [tabs.real_helen.url, tabs.real_helen.id, -1],
        ]);

        expect(model.tab(tabs.real_estelle.id)).to.deep.include({
          groupId: -1,
        });
        expect(model.tab(tabs.real_francis.id)).to.deep.include({
          groupId: -1,
        });
        expect(model.group(groups.ef.id)).to.be.undefined;
      });
    }); // tab stays in position

    describe("an entire group is moved", () => {
      it("...backward in the window", async () => {
        await browser.tabGroups.move(groups.ef.id, {index: 3});
        await events.nextN(browser.tabs.onMoved, 2);
        await events.next(browser.tabGroups.onMoved);

        expect(
          model
            .window(windows.real.id)!
            .children.map(t => [t.url, t.id, t.groupId]),
        ).to.deep.equal([
          [tabs.real_patricia.url, tabs.real_patricia.id, -1],
          [tabs.real_paul.url, tabs.real_paul.id, -1],
          [tabs.real_blank.url, tabs.real_blank.id, -1],
          [tabs.real_estelle.url, tabs.real_estelle.id, groups.ef.id],
          [tabs.real_francis.url, tabs.real_francis.id, groups.ef.id],
          [tabs.real_bob.url, tabs.real_bob.id, -1],
          [tabs.real_doug.url, tabs.real_doug.id, -1],
          [tabs.real_doug_2.url, tabs.real_doug_2.id, -1],
          [tabs.real_harry.url, tabs.real_harry.id, -1],
          [tabs.real_unstashed.url, tabs.real_unstashed.id, -1],
          [tabs.real_helen.url, tabs.real_helen.id, -1],
        ]);
      });

      it("...forward in the window", async () => {
        await browser.tabGroups.move(groups.ef.id, {index: 8});
        await events.nextN(browser.tabs.onMoved, 2);
        await events.next(browser.tabGroups.onMoved);

        expect(
          model
            .window(windows.real.id)!
            .children.map(t => [t.url, t.id, t.groupId]),
        ).to.deep.equal([
          [tabs.real_patricia.url, tabs.real_patricia.id, -1],
          [tabs.real_paul.url, tabs.real_paul.id, -1],
          [tabs.real_blank.url, tabs.real_blank.id, -1],
          [tabs.real_bob.url, tabs.real_bob.id, -1],
          [tabs.real_doug.url, tabs.real_doug.id, -1],
          [tabs.real_doug_2.url, tabs.real_doug_2.id, -1],
          [tabs.real_harry.url, tabs.real_harry.id, -1],
          [tabs.real_unstashed.url, tabs.real_unstashed.id, -1],
          [tabs.real_estelle.url, tabs.real_estelle.id, groups.ef.id],
          [tabs.real_francis.url, tabs.real_francis.id, groups.ef.id],
          [tabs.real_helen.url, tabs.real_helen.id, -1],
        ]);
      });

      it("...from one window to another", async () => {
        await browser.tabGroups.move(groups.ef.id, {
          windowId: windows.right.id,
          index: 3,
        });
        await events.nextN(browser.tabs.onAttached, 2);
        await events.next(browser.tabGroups.onMoved);

        expect(
          model
            .window(windows.real.id)!
            .children.map(t => [t.url, t.id, t.groupId]),
        ).to.deep.equal([
          [tabs.real_patricia.url, tabs.real_patricia.id, -1],
          [tabs.real_paul.url, tabs.real_paul.id, -1],
          [tabs.real_blank.url, tabs.real_blank.id, -1],
          [tabs.real_bob.url, tabs.real_bob.id, -1],
          [tabs.real_doug.url, tabs.real_doug.id, -1],
          [tabs.real_doug_2.url, tabs.real_doug_2.id, -1],
          [tabs.real_harry.url, tabs.real_harry.id, -1],
          [tabs.real_unstashed.url, tabs.real_unstashed.id, -1],
          [tabs.real_helen.url, tabs.real_helen.id, -1],
        ]);

        expect(
          model
            .window(windows.right.id)!
            .children.map(t => [t.url, t.id, t.groupId]),
        ).to.deep.equal([
          [tabs.right_blank.url, tabs.right_blank.id, -1],
          [tabs.right_adam.url, tabs.right_adam.id, -1],
          [tabs.right_doug.url, tabs.right_doug.id, -1],
          [tabs.real_estelle.url, tabs.real_estelle.id, groups.ef.id],
          [tabs.real_francis.url, tabs.real_francis.id, groups.ef.id],
        ]);
      });
    }); // an entire group is moved

    describe("a tab within an existing group is moved to a new group", () => {
      it("...from the beginning of the old group", async () => {
        const gid = await browser.tabs.group({
          tabIds: [tabs.real_estelle.id],
        });
        await events.next(browser.tabs.onUpdated);
        await events.next(browser.tabGroups.onCreated);

        expect(
          model
            .window(windows.real.id)!
            .children.map(t => [t.url, t.id, t.groupId]),
        ).to.deep.equal([
          [tabs.real_patricia.url, tabs.real_patricia.id, -1],
          [tabs.real_paul.url, tabs.real_paul.id, -1],
          [tabs.real_blank.url, tabs.real_blank.id, -1],
          [tabs.real_bob.url, tabs.real_bob.id, -1],
          [tabs.real_doug.url, tabs.real_doug.id, -1],
          [tabs.real_doug_2.url, tabs.real_doug_2.id, -1],
          [tabs.real_estelle.url, tabs.real_estelle.id, gid],
          [tabs.real_francis.url, tabs.real_francis.id, groups.ef.id],
          [tabs.real_harry.url, tabs.real_harry.id, -1],
          [tabs.real_unstashed.url, tabs.real_unstashed.id, -1],
          [tabs.real_helen.url, tabs.real_helen.id, -1],
        ]);

        expect(model.group(gid)).to.deep.include({
          id: gid,
          title: "",
          color: "grey",
          collapsed: false,
        });
        expect(model.tab(tabs.real_estelle.id)).to.deep.include({
          groupId: gid,
        });
      });

      it("...from the middle of the old group", async () => {
        await browser.tabs.show(tabs.real_harry.id);
        await events.next(browser.tabs.onUpdated);

        await browser.tabs.group({
          groupId: groups.ef.id,
          tabIds: [tabs.real_harry.id],
        });
        await events.next(browser.tabs.onUpdated);

        const gid = await browser.tabs.group({
          tabIds: [tabs.real_francis.id],
        });
        await events.next(browser.tabs.onUpdated);
        await events.next(browser.tabs.onMoved);
        await events.next(browser.tabGroups.onCreated);

        expect(
          model
            .window(windows.real.id)!
            .children.map(t => [t.url, t.id, t.groupId]),
        ).to.deep.equal([
          [tabs.real_patricia.url, tabs.real_patricia.id, -1],
          [tabs.real_paul.url, tabs.real_paul.id, -1],
          [tabs.real_blank.url, tabs.real_blank.id, -1],
          [tabs.real_bob.url, tabs.real_bob.id, -1],
          [tabs.real_doug.url, tabs.real_doug.id, -1],
          [tabs.real_doug_2.url, tabs.real_doug_2.id, -1],
          [tabs.real_francis.url, tabs.real_francis.id, gid],
          [tabs.real_estelle.url, tabs.real_estelle.id, groups.ef.id],
          [tabs.real_harry.url, tabs.real_harry.id, groups.ef.id],
          [tabs.real_unstashed.url, tabs.real_unstashed.id, -1],
          [tabs.real_helen.url, tabs.real_helen.id, -1],
        ]);

        expect(model.group(gid)).to.deep.include({
          id: gid,
          title: "",
          color: "grey",
          collapsed: false,
        });
        expect(model.tab(tabs.real_francis.id)).to.deep.include({
          groupId: gid,
        });
      });

      it("...from the end of the old group", async () => {
        const gid = await browser.tabs.group({
          tabIds: [tabs.real_francis.id],
        });
        expect(gid).to.not.equal(groups.ef.id);
        await events.next(browser.tabs.onUpdated);
        await events.next(browser.tabs.onMoved);
        await events.next(browser.tabGroups.onCreated);

        expect(
          model
            .window(windows.real.id)!
            .children.map(t => [t.url, t.id, t.groupId]),
        ).to.deep.equal([
          [tabs.real_patricia.url, tabs.real_patricia.id, -1],
          [tabs.real_paul.url, tabs.real_paul.id, -1],
          [tabs.real_blank.url, tabs.real_blank.id, -1],
          [tabs.real_bob.url, tabs.real_bob.id, -1],
          [tabs.real_doug.url, tabs.real_doug.id, -1],
          [tabs.real_doug_2.url, tabs.real_doug_2.id, -1],
          [tabs.real_francis.url, tabs.real_francis.id, gid],
          [tabs.real_estelle.url, tabs.real_estelle.id, groups.ef.id],
          [tabs.real_harry.url, tabs.real_harry.id, -1],
          [tabs.real_unstashed.url, tabs.real_unstashed.id, -1],
          [tabs.real_helen.url, tabs.real_helen.id, -1],
        ]);

        expect(model.group(gid)).to.deep.include({
          id: gid,
          title: "",
          color: "grey",
          collapsed: false,
        });
        expect(model.tab(tabs.real_francis.id)).to.deep.include({
          groupId: gid,
        });
      });
    }); // a tab within an existing group is moved to a new group

    it("all tabs are moved out of the group and the group is removed", async () => {
      await browser.tabs.ungroup([tabs.real_estelle.id, tabs.real_francis.id]);
      await events.nextN(browser.tabs.onUpdated, 2);
      await events.next(browser.tabGroups.onRemoved);

      expect(
        model
          .window(windows.real.id)!
          .children.map(t => [t.url, t.id, t.groupId]),
      ).to.deep.equal([
        [tabs.real_patricia.url, tabs.real_patricia.id, -1],
        [tabs.real_paul.url, tabs.real_paul.id, -1],
        [tabs.real_blank.url, tabs.real_blank.id, -1],
        [tabs.real_bob.url, tabs.real_bob.id, -1],
        [tabs.real_doug.url, tabs.real_doug.id, -1],
        [tabs.real_doug_2.url, tabs.real_doug_2.id, -1],
        [tabs.real_estelle.url, tabs.real_estelle.id, -1],
        [tabs.real_francis.url, tabs.real_francis.id, -1],
        [tabs.real_harry.url, tabs.real_harry.id, -1],
        [tabs.real_unstashed.url, tabs.real_unstashed.id, -1],
        [tabs.real_helen.url, tabs.real_helen.id, -1],
      ]);

      expect(model.tab(tabs.real_estelle.id)).to.deep.include({
        groupId: -1,
      });
      expect(model.tab(tabs.real_francis.id)).to.deep.include({
        groupId: -1,
      });
      expect(model.group(groups.ef.id)).to.be.undefined;
    });
  }); // tab groups
});

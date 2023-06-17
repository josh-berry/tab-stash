import FakeTimers from "@sinonjs/fake-timers";
import {expect} from "chai";

import "../mock/browser";
import * as events from "../mock/events";

import MemoryKVS from "../datastore/kvs/memory";
import * as M from "./deleted-items";

const DATASET_SIZE = 50;

describe("model/deleted-items", () => {
  let clock: FakeTimers.InstalledClock | undefined;
  let source: M.Source;
  let model: M.Model;

  beforeEach(async () => {
    source = new MemoryKVS("deleted_items");
    model = new M.Model(source);
  });

  // Some of these tests use fake timers
  afterEach(() => {
    if (clock) clock.uninstall();
    clock = undefined;
    model.clearRecentlyDeletedItems(); // Clear timers
  });

  // NOT TESTED: src2state(), because it's trivial

  it("lazily and incrementally loads deleted items", async () => {
    // We first prepopulate the KVS using the model's test-only code, and
    // then we reset the model to an empty/new state.
    await model.makeFakeData_testonly(DATASET_SIZE);
    await events.nextN(source.onSet, DATASET_SIZE);
    model = new M.Model(source);

    expect(model.state.entries).to.be.empty;
    expect(model.state.fullyLoaded).to.be.false;
    await model.loadMore();
    expect(model.state.entries.length).to.equal(10);
    expect(model.state.fullyLoaded).to.equal(false);

    let len = model.state.entries.length;
    while (!model.state.fullyLoaded) {
      await model.loadMore();
      if (!model.state.fullyLoaded) {
        expect(len).to.be.lessThan(model.state.entries.length);
      }
    }
    expect(model.state.fullyLoaded).to.equal(true);
    expect(model.state.entries.length).to.equal(DATASET_SIZE);
  });

  it("marks the model as not fully-loaded when new items appear", async () => {
    await model.loadMore();
    expect(model.state.fullyLoaded).to.equal(true);

    await model.add({title: "Foo", url: "http://example.com"});
    await events.next(source.onSet);
    expect(model.state.entries.length).to.equal(0);
    expect(model.state.fullyLoaded).to.equal(false);
  });

  it("loads items newest-first", async () => {
    await model.makeFakeData_testonly(DATASET_SIZE);
    await events.nextN(source.onSet, DATASET_SIZE);
    model = new M.Model(source);

    while (!model.state.fullyLoaded) await model.loadMore();
    let date;
    for (const ent of model.state.entries) {
      if (date) expect(date).to.be.greaterThan(ent.deleted_at);
      date = ent.deleted_at;
    }
  });

  it("observes newly-added items", async () => {
    await model.makeFakeData_testonly(DATASET_SIZE);
    await events.nextN(source.onSet, DATASET_SIZE);
    model = new M.Model(source);
    await model.loadMore();
    expect(model.state.entries.length).to.equal(10);

    const m2 = new M.Model(source);
    await m2.add({title: "Foo", url: "http://foo"});
    await events.next(source.onSet);

    expect(model.state.entries.length).to.equal(11);
    expect(model.state.entries[0]).to.deep.include({
      item: {title: "Foo", url: "http://foo"},
    });

    m2.clearRecentlyDeletedItems();
  });

  it("observes items which were dropped elsewhere", async () => {
    const m2 = new M.Model(source);

    const item = await m2.add({title: "Foo", url: "http://foo"});
    await events.next(source.onSet);

    await model.loadMore();
    expect(model.state.entries.length).to.equal(1);
    expect(model.state.entries[0]).to.deep.include({
      item: {title: "Foo", url: "http://foo"},
    });

    await m2.drop(item.key);
    await events.next(source.onSet);
    expect(model.state.entries).to.deep.equal([]);

    m2.clearRecentlyDeletedItems();
  });

  it("observes item children which were dropped elsewhere", async () => {
    const m2 = new M.Model(source);

    const item = await m2.add({
      title: "Folder",
      children: [
        {title: "First", url: "first"},
        {title: "Second", url: "second"},
        {title: "Third", url: "third"},
      ],
    });
    await events.next(source.onSet);

    await model.loadMore();
    expect(model.state.entries.length).to.equal(1);
    expect(model.state.entries[0]).to.deep.include({
      item: {
        title: "Folder",
        children: [
          {title: "First", url: "first"},
          {title: "Second", url: "second"},
          {title: "Third", url: "third"},
        ],
      },
    });

    await m2.loadMore();
    await m2.drop(item.key, [1]);
    await events.next(source.onSet);
    expect(model.state.entries.length).to.equal(1);
    expect(model.state.entries[0]).to.deep.include({
      item: {
        title: "Folder",
        children: [
          {title: "First", url: "first"},
          {title: "Third", url: "third"},
        ],
      },
    });

    m2.clearRecentlyDeletedItems();
  });

  it("drops nested folders correctly", async () => {
    const item = await model.add({
      title: "Parent",
      children: [
        {title: "Outer 1", url: "outer1"},
        {
          title: "Inner",
          children: [
            {title: "Inner 1", url: "inner1"},
            {title: "Inner 2", url: "inner2"},
            {title: "Leaf", children: [{title: "Leaf 1", url: "leaf1"}]},
          ],
        },
      ],
    });
    await events.next(source.onSet);

    await model.loadMore();
    await model.drop(item.key, [1, 1]);
    await events.next(source.onSet);

    expect(model.state.entries.length).to.equal(1);
    expect(model.state.entries[0]).to.deep.equal({
      key: item.key,
      deleted_at: new Date(item.value.deleted_at),
      deleted_from: undefined,
      item: {
        title: "Parent",
        children: [
          {title: "Outer 1", url: "outer1"},
          {
            title: "Inner",
            children: [
              {title: "Inner 1", url: "inner1"},
              {title: "Leaf", children: [{title: "Leaf 1", url: "leaf1"}]},
            ],
          },
        ],
      },
    });

    await model.drop(item.key, [1, 1]);
    await events.next(source.onSet);

    expect(model.state.entries.length).to.equal(1);
    expect(model.state.entries[0]).to.deep.equal({
      key: item.key,
      deleted_at: new Date(item.value.deleted_at),
      deleted_from: undefined,
      item: {
        title: "Parent",
        children: [
          {title: "Outer 1", url: "outer1"},
          {title: "Inner", children: [{title: "Inner 1", url: "inner1"}]},
        ],
      },
    });
  });

  it("reloads the model when KVS sync is lost", async () => {
    await model.add({title: "Foo", url: "foo"});
    await events.next(source.onSet);
    await model.loadMore(); // loads the item
    await model.loadMore(); // loads no items but sets fullyLoaded
    expect(model.state.entries.length).to.be.greaterThan(0);
    expect(model.state.fullyLoaded).to.equal(true);

    events.send(source.onSyncLost);
    await events.next(source.onSyncLost);

    expect(model.state.entries.length).to.equal(0);
    expect(model.state.fullyLoaded).to.equal(false);
  });

  describe("tracks recently-deleted items", async () => {
    it("tracks single items and clears them after a short time", async () => {
      clock = FakeTimers.install();
      expect(model.state.recentlyDeleted).to.deep.equal(0);

      const i = await model.add({title: "Recent", url: "recent"});
      const ev = events.next(source.onSet);
      clock.runToFrame();
      await ev;

      expect(model.state.recentlyDeleted).to.deep.include({
        key: i.key,
        item: {title: "Recent", url: "recent"},
      });
      clock.runToLast();
      expect(model.state.recentlyDeleted).to.deep.equal(0);
    });

    it("tracks multiple items and clears them after a short time", async () => {
      clock = FakeTimers.install();
      expect(model.state.recentlyDeleted).to.deep.equal(0);

      await model.add({title: "Recent", url: "recent"});
      await model.add({title: "Recent-2", url: "recent2"});
      await model.add({title: "Recent-2", url: "recent3"});
      const ev = events.nextN(source.onSet, 3);
      clock.runToFrame();
      await ev;

      expect(model.state.recentlyDeleted).to.equal(3);
      clock.runToLast();
      expect(model.state.recentlyDeleted).to.deep.equal(0);
    });

    it("clears single deleted items which are restored from elsewhere", async () => {
      expect(model.state.recentlyDeleted).to.deep.equal(0);

      const i = await model.add({title: "Recent", url: "recent"});
      const ev = events.next(source.onSet);
      await ev;

      expect(model.state.recentlyDeleted).to.deep.include({
        key: i.key,
        item: {title: "Recent", url: "recent"},
      });
      await model.drop(i.key);
      await events.next(source.onSet);

      expect(model.state.recentlyDeleted).to.deep.equal(0);
    });
  });

  describe("filtering", () => {
    it("resets the model when a filter is applied", async () => {
      await model.makeFakeData_testonly(50, 27);
      await events.nextN(source.onSet, 2);
      expect(model.state.entries.length).to.equal(0); // lazy-loaded

      model.filter(/* istanbul ignore next */ item => false);
      expect(model.state.entries.length).to.equal(0);
    });

    it("stops an in-progress load when a filter is applied", async () => {
      await model.makeFakeData_testonly(50, 13);
      await events.nextN(source.onSet, 4);
      expect(model.state.entries.length).to.equal(0);
      model = new M.Model(source);

      const p = model.loadMore();
      // We try a few times just to make sure we hit the right race
      // condition inside loadMore().
      for (let i = 0; i < 3; ++i) {
        model.filter(item => false);
        await new Promise(r => r(undefined));
      }
      await p;
      expect(model.state.entries.length).to.equal(0);
    });

    it("loads only items which match the applied filter", async () => {
      await model.makeFakeData_testonly(50, 7);
      await events.nextN(source.onSet, 8);
      expect(model.state.entries.length).to.equal(0);

      model.filter(item => item.title.includes("cat"));
      expect(model.state.entries.length).to.equal(0);

      while (!model.state.fullyLoaded) await model.loadMore();
      expect(model.state.entries.length).to.be.greaterThan(0);
      for (const c of model.state.entries) {
        expect(c.item.title).to.include("cat");
      }
    });

    it("properly handles filters which exclude all items", async () => {
      await model.makeFakeData_testonly(50);
      await events.nextN(source.onSet, 50);

      model.filter(item => false);
      while (!model.state.fullyLoaded) await model.loadMore();
      expect(model.state.entries.length).to.equal(0);
      expect(model.state.fullyLoaded).to.be.true;
    });

    it("only loads new items that match the applied filter", async () => {
      model.filter(item => item.title.includes("cat"));
      const m2 = new M.Model(source);
      await m2.makeFakeData_testonly(50);
      await events.nextN(source.onSet, 50);

      while (!model.state.fullyLoaded) await model.loadMore();
      expect(model.state.entries.length).to.be.greaterThan(0);
      for (const c of model.state.entries) {
        expect(c.item.title).to.include("cat");
      }
    });
  });

  it("sorts newly-added items in a user-friendly way", async () => {
    const first = new Date();
    const second = new Date(first.valueOf() + 1);

    // We do 15 items to test what happens when the item sequence number in
    // the key changes from one to two digits.  Items should still be sorted
    // in the correct order...
    const first_items = [];
    const second_items = [];
    for (let i = 0; i < 15; ++i) {
      first_items.push(`First-${i}`);
      second_items.push(`Second-${i}`);
    }

    for (const i of first_items) {
      await model.add({title: i, url: i}, undefined, first);
    }
    for (const i of second_items) {
      await model.add({title: i, url: i}, undefined, second);
    }
    await events.nextN(source.onSet, 30);

    while (!model.state.fullyLoaded) await model.loadMore();

    // console.log(model.state.entries.map(i => i.key));
    // console.log(model.state.entries.map(i => i.item.title));

    // Entries must be sorted newest-first, except that entries deleted
    // together should be sorted in the same order in which they were
    // deleted (presumably, the same order in which they appeared in the
    // model).
    expect(model.state.entries.map(e => e.item.title)).to.deep.equal([
      ...second_items,
      ...first_items,
    ]);
  });

  it("drops items older than a certain timestamp", async () => {
    const dropTime = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await model.makeFakeData_testonly(100);
    await events.nextN(source.onSet, 100);

    // Load all entries (and ensure the model has old-enough entries).
    while (!model.state.fullyLoaded) await model.loadMore();
    expect(
      model.state.entries[model.state.entries.length - 1].deleted_at,
    ).to.be.lessThan(dropTime);

    // dropOlderThan() should work even if the model has nothing loaded.
    model = new M.Model(source);
    await model.dropOlderThan(dropTime.valueOf());
    expect(
      (await events.watch(source.onSet).untilNextTick()).length,
    ).to.be.greaterThan(0);
    expect(model.state.entries.length).to.equal(0);

    while (!model.state.fullyLoaded) await model.loadMore();
    expect(model.state.entries.length).to.be.greaterThan(0);
    for (const e of model.state.entries) {
      expect(e.deleted_at).to.be.greaterThan(dropTime);
    }
  });
});

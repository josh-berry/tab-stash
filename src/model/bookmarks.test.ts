import {expect} from "chai";
import type {Bookmarks} from "webextension-polyfill";
import browser from "webextension-polyfill";

import * as events from "../mock/events.js";

import * as M from "./bookmarks.js";

import type {BookmarkFixture} from "./fixtures.testlib.js";
import {B, make_bookmarks, STASH_ROOT_NAME} from "./fixtures.testlib.js";
import {shortPoll, tryAgain} from "../util/index.js";

describe("model/bookmarks - creating the stash root", () => {
  let model: M.Model;

  beforeEach(async () => {
    model = await M.Model.from_browser(STASH_ROOT_NAME);
  });

  afterEach(async () => {
    if (model && model.stash_root.value) {
      const p = model.removeTree(model.stash_root.value);
      await events.next(browser.bookmarks.onRemoved);
      await p;
    }
  });

  it("loads the model even without a stash root", async () => {
    expect(model.root).to.be.undefined;
    expect(model.stash_root.value).to.be.undefined;
  });

  it("creates a new stash root when requested", async () => {
    expect(model.root).to.be.undefined;
    expect(model.stash_root.value).to.be.undefined;

    const p = model.ensureStashRoot();
    await events.next(browser.bookmarks.onCreated);
    const stash_root = await p;

    expect(stash_root.title).to.equal(STASH_ROOT_NAME);
    expect(stash_root.isLoaded).to.be.true;
    expect(stash_root.position?.parent).not.to.be.undefined;
  });

  it("populates model.root and .stash_root after creation", async () => {
    expect(model.root).to.be.undefined;
    expect(model.stash_root.value).to.be.undefined;

    const p = model.ensureStashRoot();
    await events.next(browser.bookmarks.onCreated);
    const stash_root = await p;

    expect(model.root).not.to.be.undefined;
    expect(model.stash_root.value).to.equal(stash_root);
  });

  it("reuses an existing stash root", async () => {
    await model.ensureStashRoot();
    expect(model.root).not.to.be.undefined;
    expect(model.stash_root.value).not.to.be.undefined;

    const p = model.ensureStashRoot();
    await events.next(browser.bookmarks.onCreated);
    const stash_root = await p;
    const new_sr = await model.ensureStashRoot();
    expect(new_sr).to.equal(stash_root);
  });

  it("creates only one stash root even if there's a race", async () => {
    const model2 = await M.Model.from_browser(STASH_ROOT_NAME);
    const model3 = await M.Model.from_browser(STASH_ROOT_NAME);

    expect(model.stash_root.value).to.be.undefined;
    expect(model2.stash_root.value).to.be.undefined;
    expect(model3.stash_root.value).to.be.undefined;

    const p1 = model.ensureStashRoot();
    const p2 = model2.ensureStashRoot();
    const p3 = model3.ensureStashRoot();
    await events.nextN(browser.bookmarks.onCreated, 3);
    await events.nextN(browser.bookmarks.onRemoved, 2);
    const sr1 = await p1;
    const sr2 = await p2;
    const sr3 = await p3;
    expect(sr1).to.equal(model.stash_root.value);
    expect(sr2).to.equal(model2.stash_root.value);
    expect(sr3).to.equal(model3.stash_root.value);
    expect(sr1.id).to.equal(sr2.id);
    expect(sr2.id).to.equal(sr3.id);
  });

  it("detects when a new stash root is created", async () => {
    expect(model.root).to.be.undefined;
    expect(model.stash_root.value).to.be.undefined;

    const btn = await browser.bookmarks.create({title: STASH_ROOT_NAME});
    await events.next(browser.bookmarks.onCreated);

    await shortPoll(() => {
      if (!model.root) tryAgain();
      if (!model.stash_root.value) tryAgain();
    });
    expect(model.stash_root.value!.id).to.equal(btn.id);
  });

  it("detects when a folder is renamed to be the stash root", async () => {
    const btn = await browser.bookmarks.create({
      title: `not ${STASH_ROOT_NAME}`,
    });
    await events.next(browser.bookmarks.onCreated);

    // Re-create the model - we don't want it seeing the creation event
    model = await M.Model.from_browser(STASH_ROOT_NAME);
    expect(model.root).to.be.undefined;
    expect(model.stash_root.value).to.be.undefined;

    // Created bookmark should not be loaded since we're not tracking its parent
    expect(model.bookmark(btn.id)).to.be.undefined;

    await browser.bookmarks.update(btn.id, {title: STASH_ROOT_NAME});
    await events.next(browser.bookmarks.onChanged);

    await shortPoll(() => {
      if (!model.root) tryAgain();
      if (!model.stash_root.value) tryAgain();
    });
    expect(model.stash_root.value!.id).to.equal(btn.id);
  });
});

describe("model/bookmarks", () => {
  let bms: BookmarkFixture;
  let model: M.Model;

  beforeEach(async () => {
    bms = await make_bookmarks();
    model = await M.Model.from_browser(STASH_ROOT_NAME);
    expect(events.pendingCount(), "Pending events in beforeEach").to.equal(0);
  });

  describe("loads bookmarks from the browser", () => {
    it("creates bookmark objects", () => {
      // Pick a few at random inside the stash, since bookmarks outside the
      // stash are only loaded as needed.
      for (const l of ["nested_child", "helen", "undyne"]) {
        const template = bms[l as keyof typeof bms];
        const bm = model.node(template.id);
        if (template.url) {
          expect(bm, `${l} URL/title to be set`).to.deep.include({
            id: template.id,
            title: template.title,
            url: template.url,
          });
        }

        const parent = model.folder(template.parentId!)!;
        expect(parent, `${l} parent.children to exist`).to.have.property(
          "children",
        );
        expect(parent.children[template.index!]).to.equal(bm);
      }
    });

    it("creates folders correctly", () => {
      for (const l of ["names", "nested_child", "big_stash"]) {
        const template = bms[l as keyof typeof bms];
        if (!template.children) continue;

        const bm = model.folder(template.id)!;
        expect(bm.id).to.equal(template.id);
        expect(bm.children.map(bm => `${bm?.id} ${bm?.title}`)).to.deep.equal(
          template.children.map(c => `${c.id} ${c.title}`),
        );
      }
    });

    it("indexes URLs correctly", async () => {
      expect(model.loadedBookmarksWithURL(`${B}#doug`)).to.deep.equal(
        new Set([model.node(bms.doug_2.id)]),
      );

      await model.loadedSubtree(model.root!);

      expect(model.loadedBookmarksWithURL(`${B}#doug`)).to.deep.equal(
        new Set([model.node(bms.doug_2.id), model.node(bms.doug_1.id)]),
      );
      expect(model.loadedBookmarksWithURL(`${B}#alice`)).to.deep.equal(
        new Set([model.node(bms.alice.id)]),
      );
    });

    it("eagerly loads subtrees moved into the stash root", async () => {
      expect(model.stash_root.value?.id).to.equal(bms.stash_root.id);
      const stash_root = model.stash_root.value!;

      expect(stash_root.$recursiveStats.isLoaded).to.be.true;
      expect(model.folder(bms.outside.id)).to.be.undefined;

      await browser.bookmarks.move(bms.outside.id, {
        parentId: bms.stash_root.id,
        index: 0,
      });
      await events.next(browser.bookmarks.onMoved);
      expect(stash_root.children.map(c => c?.id)).to.deep.equal([
        undefined,
        bms.names.id,
        bms.unnamed.id,
        bms.big_stash.id,
        bms.nested.id,
      ]);
      expect(stash_root.isLoaded).to.be.false;
      expect(stash_root.$recursiveStats.isLoaded).to.be.false;

      await shortPoll(() => {
        const newcomer = model.folder(bms.outside.id);
        if (!newcomer) tryAgain();
        if (!newcomer.$recursiveStats.isLoaded) tryAgain();
        expect(newcomer.children.every(c => c !== undefined)).to.be.true;
      });
    });
  });

  it("finds all URLs in the stash root", async () => {
    expect(Array.from(await model.urlsInStash()).sort()).to.deep.equal([
      `${B}#1`,
      `${B}#2`,
      `${B}#3`,
      `${B}#4`,
      `${B}#5`,
      `${B}#6`,
      `${B}#7`,
      `${B}#8`,
      `${B}#doug`,
      `${B}#helen`,
      `${B}#nate`,
      `${B}#nested_1`,
      `${B}#nested_2`,
      `${B}#nested_child_1`,
      `${B}#patricia`,
      `${B}#undyne`,
    ]);
  });

  it("inserts bookmarks into the tree", async () => {
    const new_bm = await browser.bookmarks.create({
      title: "New",
      url: "/new",
      parentId: bms.root.id,
      index: 2,
    });
    await events.next(browser.bookmarks.onCreated);

    const n = model.node(new_bm.id as M.NodeID)!;
    expect(n).to.deep.include({
      id: new_bm.id as M.NodeID,
      title: "New",
      url: "/new",
    });
    expect(n.position).to.deep.equal({
      parent: model.folder(bms.root.id)!,
      index: 2,
    });

    expect(model.loadedBookmarksWithURL("/new")).to.deep.equal(new Set([n]));
    expect(model.folder(bms.root.id)!.children.map(bm => bm?.id)).to.deep.equal(
      [
        // We don't expect the entire bookmark tree to be loaded, hence the
        // `undefined`s.
        undefined, // bms.doug_1.id,
        undefined, // bms.francis.id,
        new_bm.id,
        undefined, // bms.outside.id,
        bms.stash_root.id,
      ],
    );
  });

  it("inserts duplicate bookmarks gracefully", async () => {
    await model.loadedSubtree(model.root!);
    const new_a: Bookmarks.BookmarkTreeNode = {
      id: bms.alice.id,
      title: "The New A",
      url: "/new_a",
      parentId: bms.outside.id,
      index: 0,
    };
    events.send(browser.bookmarks.onCreated, new_a.id, new_a);
    await events.next(browser.bookmarks.onCreated);

    new_a.dateAdded = undefined;
    delete new_a.type;
    delete new_a.index;

    expect(model.node(bms.alice.id)).to.deep.include({
      id: bms.alice.id,
      title: "The New A",
      url: "/new_a",
    });
    expect(model.loadedBookmarksWithURL(`${B}#alice`)).to.deep.equal(
      new Set([]),
    );
    expect(model.loadedBookmarksWithURL("/new_a")).to.deep.equal(
      new Set([model.node(bms.alice.id)]),
    );
    expect(
      model.folder(bms.outside.id)!.children.map(bm => bm?.id),
    ).to.deep.equal([bms.alice.id, bms.separator.id, bms.bob.id, bms.empty.id]);
  });

  it("updates bookmarks", async () => {
    await model.loadedSubtree(model.root!);
    await browser.bookmarks.update(bms.alice.id, {
      title: "The New A",
      url: "/new_a",
    });
    await events.next(browser.bookmarks.onChanged);

    expect(model.node(bms.alice.id)).to.deep.include({
      title: "The New A",
      url: "/new_a",
    });
    expect(model.loadedBookmarksWithURL(`${B}#alice`)).to.deep.equal(new Set());
    expect(model.loadedBookmarksWithURL("/new_a")).to.deep.equal(
      new Set([model.node(bms.alice.id)]),
    );
    expect(
      model.folder(bms.outside.id)!.children.map(bm => bm?.id),
    ).to.deep.equal([bms.alice.id, bms.separator.id, bms.bob.id, bms.empty.id]);
  });

  it("updates folder titles", async () => {
    await browser.bookmarks.update(bms.names.id, {title: "Secret"});
    await events.next(browser.bookmarks.onChanged);
    expect(model.node(bms.names.id)!.title).to.equal("Secret");
  });

  it("removes bookmarks idempotently", async () => {
    await model.loadedSubtree(model.root!);
    await browser.bookmarks.remove(bms.bob.id);
    const ev = await events.next(browser.bookmarks.onRemoved);

    events.send(browser.bookmarks.onRemoved, ...ev);
    await events.next(browser.bookmarks.onRemoved);

    expect(model.node(bms.bob.id)).to.be.undefined;
    expect(model.loadedBookmarksWithURL(`${B}#bob`)).to.deep.equal(new Set([]));
    expect(
      model.folder(bms.outside.id)!.children.map(bm => bm?.id),
    ).to.deep.equal([bms.alice.id, bms.separator.id, bms.empty.id]);
  });

  it("removes folders idempotently", async () => {
    await model.loadedSubtree(model.root!);
    expect(model.node(bms.names.id)).not.to.be.undefined;
    await browser.bookmarks.removeTree(bms.names.id);
    const ev = await events.next(browser.bookmarks.onRemoved);

    events.send(browser.bookmarks.onRemoved, ...ev);
    await events.next(browser.bookmarks.onRemoved);

    expect(model.node(bms.names.id)).to.be.undefined;
    expect(model.node(bms.doug_2.id)).to.be.undefined;
    expect(model.node(bms.helen.id)).to.be.undefined;
    expect(model.node(bms.patricia.id)).to.be.undefined;
    expect(model.node(bms.nate.id)).to.be.undefined;

    expect(model.loadedBookmarksWithURL(`${B}#helen`)).to.deep.equal(
      new Set([]),
    );
    expect(model.loadedBookmarksWithURL(`${B}#doug`)).to.deep.equal(
      new Set([model.node(bms.doug_1.id)]),
    );

    expect(model.node(bms.names.id)).to.be.undefined;
    expect(
      model.folder(bms.stash_root.id)!.children.map(bm => bm?.id),
    ).to.deep.equal([bms.unnamed.id, bms.big_stash.id, bms.nested.id]);
  });

  it("reorders bookmarks (forward)", async () => {
    await model.loadedSubtree(model.root!);
    const p = model.move(
      model.bookmark(bms.alice.id)!,
      model.folder(bms.outside.id)!,
      4,
    );
    await events.next(browser.bookmarks.onMoved);
    await p;

    expect(
      model.folder(bms.outside.id)!.children.map(bm => bm?.id),
    ).to.deep.equal([bms.separator.id, bms.bob.id, bms.empty.id, bms.alice.id]);
  });

  it("reorders bookmarks (backward)", async () => {
    await model.loadedSubtree(model.root!);
    const p = model.move(
      model.node(bms.empty.id)!,
      model.folder(bms.outside.id)!,
      0,
    );
    await events.next(browser.bookmarks.onMoved);
    await p;

    expect(
      model.folder(bms.outside.id)!.children.map(bm => bm?.id),
    ).to.deep.equal([bms.empty.id, bms.alice.id, bms.separator.id, bms.bob.id]);
  });

  it("moves bookmarks between folders", async () => {
    await model.loadedStash();
    const p = model.move(
      model.bookmark(bms.three.id)!,
      model.folder(bms.names.id)!,
      2,
    );
    await events.next(browser.bookmarks.onMoved);
    await p;

    expect(
      model.folder(bms.big_stash.id)!.children.map(bm => bm?.id),
    ).to.deep.equal([
      bms.one.id,
      bms.two.id,
      bms.four.id,
      bms.five.id,
      bms.six.id,
      bms.seven.id,
      bms.eight.id,
    ]);
    expect(
      model.folder(bms.names.id)!.children.map(bm => bm?.id),
    ).to.deep.equal([
      bms.doug_2.id,
      bms.helen.id,
      bms.three.id,
      bms.patricia.id,
      bms.nate.id,
    ]);
  });

  it("sorts bookmarks within folders", async () => {
    await model.loadedStash();
    const folder = model.folder(bms.big_stash.id)!;

    let p = model.sort(folder, M.sortByTitle);
    await events.nextN(browser.bookmarks.onMoved, folder.children.length);
    await p;

    expect(folder.children.map(bm => bm?.id)).to.deep.equal([
      bms.eight.id,
      bms.five.id,
      bms.four.id,
      bms.one.id,
      bms.seven.id,
      bms.six.id,
      bms.three.id,
      bms.two.id,
    ]);

    p = model.sort(folder, M.sortByURL);
    await events.nextN(browser.bookmarks.onMoved, folder.children.length);
    await p;

    expect(folder.children.map(bm => bm?.id)).to.deep.equal([
      bms.one.id,
      bms.two.id,
      bms.three.id,
      bms.four.id,
      bms.five.id,
      bms.six.id,
      bms.seven.id,
      bms.eight.id,
    ]);
  });

  describe("sort comparators", () => {
    function mknode(
      id: string,
      n: {title: string; url?: string; dateAdded?: number},
    ): M.Node {
      return n.url
        ? ({
            id: id as M.NodeID,
            position: undefined,
            title: n.title,
            url: n.url,
            dateAdded: n.dateAdded,
          } as M.Bookmark)
        : ({
            id: id as M.NodeID,
            position: undefined,
            title: n.title,
          } as M.Node);
    }

    function t(
      comparator: (a: M.Node, b: M.Node) => number,
      a: {title: string; url?: string; dateAdded?: number},
      expected: "==" | "<" | ">",
      b: {title: string; url?: string; dateAdded?: number},
    ) {
      it(`${comparator.name}: "${a.title}" (${a.url ?? ""}, ${a.dateAdded ?? "undefined"}) ${expected} "${b.title}" (${b.url ?? ""}, ${b.dateAdded ?? "undefined"})`, () => {
        const na = mknode("a", a);
        const nb = mknode("b", b);

        const cmp = comparator(na, nb);
        if (expected === "==") expect(cmp).to.equal(0);
        else if (expected === "<") expect(cmp).to.be.lessThan(0);
        else expect(cmp).to.be.greaterThan(0);
      });
    }

    t(M.sortByTitle, {title: "A"}, "==", {title: "A"});
    t(M.sortByTitle, {title: "B"}, ">", {title: "A"});
    t(M.sortByTitle, {title: "A"}, "<", {title: "B"});
    t(M.sortByTitle, {title: "A"}, "==", {title: "a"});
    t(M.sortByTitle, {title: "e"}, "==", {title: "é"});
    t(M.sortByTitle, {title: "[ticket-1234]"}, ">", {title: "[ticket-20]"});

    t(M.sortByDateAdded, {title: "a", dateAdded: 10, url: "/a"}, "==", {
      title: "b",
      dateAdded: 10,
      url: "/b",
    });
    t(M.sortByDateAdded, {title: "a", dateAdded: 11, url: "/a"}, ">", {
      title: "b",
      dateAdded: 10,
      url: "/b",
    });
    t(M.sortByDateAdded, {title: "a", dateAdded: 11, url: "/a"}, "<", {
      title: "b",
      dateAdded: 12,
      url: "/b",
    });

    t(
      M.sortByDateAddedDescending,
      {title: "a", dateAdded: 10, url: "/a"},
      "==",
      {
        title: "b",
        dateAdded: 10,
        url: "/b",
      },
    );
    t(
      M.sortByDateAddedDescending,
      {title: "a", dateAdded: 11, url: "/a"},
      "<",
      {
        title: "b",
        dateAdded: 10,
        url: "/b",
      },
    );
    t(
      M.sortByDateAddedDescending,
      {title: "a", dateAdded: 11, url: "/a"},
      ">",
      {
        title: "b",
        dateAdded: 12,
        url: "/b",
      },
    );

    t(M.sortByURL, {title: "b", url: "http://example.com/a"}, "<", {
      title: "a",
      url: "http://example.com/b",
    });

    t(M.sortByURL, {title: "b", url: "http://example.com/a"}, "==", {
      title: "a",
      url: "http://example.com/a",
    });

    t(M.sortByURL, {title: "a", url: "http://example.com/b"}, ">", {
      title: "b",
      url: "http://example.com/a",
    });

    t(M.sortByURL, {title: "a", url: "http://a.b.com/foo"}, ">", {
      title: "b",
      url: "http://b.a.com/foo",
    });

    t(M.sortByURL, {title: "a", url: "http://a.b.com/foo?a=b#bar"}, "==", {
      title: "b",
      url: "http://a.b.com/foo?a=b#bar",
    });
    t(M.sortByURL, {title: "a", url: "http://a.b.com/foo?a=b#baz"}, ">", {
      title: "b",
      url: "http://a.b.com/foo?a=b#bar",
    });
    t(M.sortByURL, {title: "a", url: "http://a.b.com/foo?a=b#baz"}, ">", {
      title: "b",
      url: "https://a.b.com/foo?a=b#bar",
    });
    t(M.sortByURL, {title: "a", url: "http://a.b.com/foo?a=b#bar"}, "<", {
      title: "b",
      url: "https://a.b.com/foo?a=b#bar",
    });
    t(M.sortByURL, {title: "a", url: "http://example.com/issues/10"}, ">", {
      title: "b",
      url: "http://example.com/issues/2",
    });
  });

  it("makes space for unloaded bookmarks that are moved into loaded folders", async () => {
    await model.loadedStash();
    expect(
      model.stash_root.value?.$recursiveStats.isLoaded,
      `stash is fully loaded`,
    ).to.be.true;

    const dest = model.folder(bms.unnamed.id)!;
    expect(dest, `dest folder to be present`).to.not.be.undefined;
    expect(dest.isLoaded, `dest folder to be loaded`).to.be.true;

    await browser.bookmarks.move(bms.alice.id, {
      parentId: bms.unnamed.id,
      index: 0,
    });
    await events.next(browser.bookmarks.onMoved);

    expect(dest.isLoaded, `dest folder to no longer be loaded`).to.be.false;
    expect(
      dest.children.map(c => c?.id),
      `dest children`,
    ).to.deep.equal([undefined, bms.undyne.id]);
  });

  describe("reports info about bookmarks", () => {
    describe("folders in the stash containing a URL", () => {
      function test(
        name: string,
        url: string,
        result: (keyof BookmarkFixture)[],
      ) {
        it(name, () =>
          expect(
            model.loadedFoldersInStashWithURL(url).map(f => f.id),
          ).to.deep.equal(result.map(id => bms[id].id)),
        );
      }

      test("not bookmarked", "sir-not-appearing-in-this-film.com", []);
      test("outside the stash", `${B}#alice`, []);
      test("inside the stash in one place", `${B}#helen`, ["names"]);
      test("both inside and outside the stash", `${B}#doug`, ["names"]);
      test("in nested folders", `${B}#nested_child_1`, ["nested_child"]);
      test("stashed in multiple places", `${B}#2`, ["big_stash", "nested_3"]);
    });

    describe("lookup URL in stash", () => {
      it("returns false for URLs not in bookmarks", async () => {
        expect(model.isURLLoadedInStash(`${B}#not-in-bookmarks`)).to.be.false;
      });
      it("returns false for URLs not in the stash w/fully-loaded bookmarks", async () => {
        await model.loadedSubtree(model.root!);
        expect(model.loadedBookmarksWithURL(`${B}#francis`).size).to.equal(1);
        expect(model.isURLLoadedInStash(`${B}#francis`)).to.be.false;
      });
      it("returns false for URLs in the stash but not loaded", async () => {
        expect(model.loadedBookmarksWithURL(`${B}#francis`).size).to.equal(0);
        expect(model.isURLLoadedInStash(`${B}#francis`)).to.be.false;
      });
      it("returns true for URLs nested deeply in the stash", async () => {
        expect(
          model.loadedBookmarksWithURL(`${B}#nested_child_1`).size,
        ).to.equal(1);
        expect(model.isURLLoadedInStash(`${B}#nested_child_1`)).to.be.true;
      });
      it("returns true for URLs in a top-level group in the stash", async () => {
        expect(model.loadedBookmarksWithURL(`${B}#1`).size).to.equal(1);
        expect(model.isURLLoadedInStash(`${B}#1`)).to.be.true;
      });
    });
  });

  describe("tracks the stash root", () => {
    it("finds the stash root during construction", async () => {
      expect(model.stash_root.value).to.equal(model.node(bms.stash_root.id));
      expect(model.stash_root_warning.value).to.be.undefined;
    });

    it("loses the stash root when it is renamed", async () => {
      await browser.bookmarks.update(bms.stash_root.id, {title: "Old Root"});
      await events.next(browser.bookmarks.onChanged);
      expect(events.pendingCount()).to.equal(0);

      await shortPoll(() => {
        if (model.stash_root.value !== undefined) tryAgain();
      });
      expect(model.stash_root.value).to.be.undefined;
      expect(model.stash_root_warning.value).to.be.undefined;
    });

    it("finds multiple stash roots at the same level", async () => {
      const new_root = await browser.bookmarks.create({
        parentId: bms.root.id,
        title: STASH_ROOT_NAME,
      });
      await events.next(browser.bookmarks.onCreated);
      expect(events.pendingCount()).to.equal(0);

      await shortPoll(() => {
        if (model.stash_root_warning.value === undefined) tryAgain();
      });

      // Either the stash root is the new root OR the old root, but it should
      // never be neither (or both).
      expect(model.stash_root.value).to.satisfy(
        (m: M.Bookmark) =>
          (m.id === new_root.id) !== (m.id === bms.stash_root.id),
      );
      expect(model.stash_root_warning.value).not.to.be.undefined;
    });

    it("finds the topmost stash root", async () => {
      await browser.bookmarks.create({
        parentId: bms.outside.id,
        title: STASH_ROOT_NAME,
      });
      await events.next(browser.bookmarks.onCreated);
      expect(events.pendingCount()).to.equal(0);

      await shortPoll(() => {
        if (model.stash_root.value?.id !== bms.stash_root.id) tryAgain();
      });
      expect(model.stash_root.value).to.equal(model.node(bms.stash_root.id));
      expect(model.stash_root_warning.value).to.be.undefined;
    });

    it("follows the topmost stash root", async () => {
      await browser.bookmarks.move(bms.stash_root.id, {
        parentId: bms.outside.id,
      });
      await events.next(browser.bookmarks.onMoved);
      expect(events.pendingCount()).to.equal(0);

      await shortPoll(() => {
        if (model.stash_root.value?.id !== bms.stash_root.id) tryAgain();
      });
      expect(model.stash_root.value).to.equal(model.node(bms.stash_root.id));
      expect(model.stash_root_warning.value).to.be.undefined;

      const bm = await browser.bookmarks.create({
        parentId: bms.root.id,
        title: STASH_ROOT_NAME,
      });
      await events.next(browser.bookmarks.onCreated);
      expect(events.pendingCount()).to.equal(0);

      await shortPoll(() => {
        if (model.stash_root.value?.id !== bm.id) tryAgain();
      });
      expect(model.stash_root.value).to.deep.include({id: bm.id});
      expect(model.stash_root_warning.value).to.be.undefined;
    });
  });

  describe("ensureStashRoot()", () => {
    it("when it already exists", async () => {
      const root = await model.ensureStashRoot();
      expect(model.stash_root.value).to.equal(root);
      expect(model.stash_root.value).to.equal(model.node(bms.stash_root.id));
      expect(model.stash_root_warning.value).to.be.undefined;
    });

    it("when it does not exist", async () => {
      await browser.bookmarks.update(bms.stash_root.id, {title: "Old Root"});
      await events.next(browser.bookmarks.onChanged);
      expect(events.pendingCount()).to.equal(0);
      expect(model.stash_root.value).to.be.undefined;

      const p = model.ensureStashRoot();
      await events.next(browser.bookmarks.onCreated);
      expect(events.pendingCount()).to.equal(0);

      const root = await p;
      expect(root).not.to.be.undefined;
      expect(model.stash_root.value).to.equal(root);
    });

    it("reentrant", async () => {
      // Testing the case where two different bookmark instances on two
      // different computers (or maybe just in two different windows on
      // the same computer) create two different stash roots.
      await browser.bookmarks.update(bms.stash_root.id, {title: "Old Root"});
      await events.next(browser.bookmarks.onChanged);
      expect(events.pendingCount()).to.equal(0);
      expect(model.stash_root.value).to.be.undefined;

      const model2 = await M.Model.from_browser(STASH_ROOT_NAME);

      const p1 = model.ensureStashRoot();
      const p2 = model2.ensureStashRoot();
      await events.nextN(browser.bookmarks.onCreated, 2);
      await events.nextN(browser.bookmarks.onRemoved, 1);
      expect(events.pendingCount()).to.equal(0);

      const root1 = await p1;
      const root2 = await p2;
      expect(root1).not.to.be.undefined;
      expect(root2).not.to.be.undefined;
      expect(root1.id).to.equal(root2.id);
      expect(model.stash_root.value).to.equal(root1);
      expect(model2.stash_root.value).to.equal(root2);
    });
  });

  describe("cleans up empty folders", () => {
    it("when deleting stash bookmarks from an unnamed folder", async () => {
      const p = model.remove(model.bookmark(bms.undyne.id)!);
      await events.nextN(browser.bookmarks.onRemoved, 2);
      await p;

      expect(model.node(bms.unnamed.id)).to.be.undefined;
      expect(
        model.folder(bms.stash_root.id)!.children.map(bm => bm?.id),
      ).to.deep.equal([bms.names.id, bms.big_stash.id, bms.nested.id]);
    });

    it("when moving stash bookmarks to another folder", async () => {
      const p = model.move(
        model.bookmark(bms.undyne.id)!,
        model.folder(bms.names.id)!,
        5,
      );
      await events.next(browser.bookmarks.onMoved);
      await events.next(browser.bookmarks.onRemoved);
      await p;

      expect(model.node(bms.unnamed.id)).to.be.undefined;
      expect(
        model.folder(bms.stash_root.id)!.children.map(bm => bm?.id),
      ).to.deep.equal([bms.names.id, bms.big_stash.id, bms.nested.id]);
      expect(
        model.folder(bms.names.id)!.children.map(bm => bm?.id),
      ).to.deep.equal([
        bms.doug_2.id,
        bms.helen.id,
        bms.patricia.id,
        bms.nate.id,
        bms.undyne.id,
      ]);
    });

    describe("but not", () => {
      let new_unnamed: M.Node;
      let new_child: M.Node;

      beforeEach(async () => {
        const p1 = model.create({
          title: "saved-1970-01-01T00:00:00.000Z",
          parentId: bms.outside.id,
        });
        await events.next(browser.bookmarks.onCreated);
        new_unnamed = await p1;

        const p2 = model.create({
          title: "Foo",
          url: "foo",
          parentId: new_unnamed.id,
        });
        await events.next(browser.bookmarks.onCreated);
        new_child = await p2;
      });

      it("when deleting bookmarks outside the stash root", async () => {
        await model.loadedSubtree(model.root!);
        const p = model.remove(new_child);
        await events.nextN(browser.bookmarks.onRemoved, 1);
        await p;

        expect(model.node(new_child.id)).to.be.undefined;
        expect(model.folder(new_unnamed.id)!.children).to.deep.equal([]);
        expect(
          model.folder(bms.outside.id)!.children.map(bm => bm?.id),
        ).to.deep.equal([
          bms.alice.id,
          bms.separator.id,
          bms.bob.id,
          bms.empty.id,
          new_unnamed.id,
        ]);
      });

      it("when moving bookmarks outside the stash root", async () => {
        const names = model.folder(bms.names.id)!;

        const p = browser.bookmarks.move(new_child.id, {
          parentId: names.id,
          index: 5,
        });
        await events.next(browser.bookmarks.onMoved);
        await p;

        expect((new_unnamed as M.Folder).children).to.deep.equal([]);
        // We can't check `outside` as it's not loaded in the model
        expect(model.folder(bms.outside.id)).to.be.undefined;
        expect(
          model.folder(bms.names.id)!.children.map(bm => bm?.id),
        ).to.deep.equal([
          bms.doug_2.id,
          bms.helen.id,
          bms.patricia.id,
          bms.nate.id,
          new_child.id,
        ]);
      });
    });
  });
});

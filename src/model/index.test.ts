// Functional tests for Tab Stash, intended to mirror real-world user
// activities.

import {expect} from "chai";
import browser from "webextension-polyfill";

import * as events from "../mock/events.js";
import {B} from "./fixtures.testlib.js";
import {setupModelTestEnv, type ModelTestEnv} from "./index.testlib.js";

import {filterMap, later, redirUrl, urlToStash} from "../util/index.js";

import {_StoredObjectFactory} from "../datastore/stored-object.js";
import {CUR_WINDOW_MD_ID} from "./bookmark-metadata.js";
import {
  getDefaultFolderNameISODate,
  isBookmark,
  isFolder,
  type Folder,
} from "./bookmarks.js";
import type {DeletedFolder} from "./deleted-items.js";
import * as M from "./index.js";
import type {TabID} from "./tabs.js";

describe("model", () => {
  let env: ModelTestEnv = undefined!;

  beforeEach(async () => {
    env = await setupModelTestEnv();
  });

  describe("garbage collection", () => {
    const deleted_item_cutoff =
      Date.now() -
      M.Options.SYNC_DEF.deleted_items_expiration_days.default *
        24 *
        60 *
        60 *
        1000;

    beforeEach(() => {
      events.ignore(undefined);
    });

    it("remembers metadata for the current window", async () => {
      const entry = {key: CUR_WINDOW_MD_ID, value: {collapsed: true}};
      await env.bookmark_metadata.set([entry]);

      await env.model.gc();

      expect(await env.bookmark_metadata.get([CUR_WINDOW_MD_ID])).to.deep.equal(
        [entry],
      );
    });

    it("deletes bookmark metadata for deleted bookmarks", async () => {
      expect(await env.bookmark_metadata.get(["nonexistent"])).to.deep.equal([
        {key: "nonexistent", value: {collapsed: true}},
      ]);

      await env.model.gc();

      expect(await env.bookmark_metadata.get(["nonexistent"])).to.deep.equal(
        [],
      );
    });

    it("deletes cached favicons that are not in bookmarks or open tabs", async () => {
      expect(
        await env.favicons.get([`${B}#sir-not-appearing-in-this-film`]),
      ).to.deep.equal([
        {
          key: `${B}#sir-not-appearing-in-this-film`,
          value: {favIconUrl: `${B}#sir-not-appearing-in-this-film.favicon`},
        },
      ]);

      await env.model.gc();

      expect(
        await env.favicons.get([`${B}#sir-not-appearing-in-this-film`]),
      ).to.deep.equal([]);
    });

    it("deletes expired deleted items", async () => {
      expect(
        env.model.options.sync.state.deleted_items_expiration_days,
      ).to.equal(M.Options.SYNC_DEF.deleted_items_expiration_days.default);

      const old_deleted_item = (
        await env.deleted_items.getStartingFrom(undefined, 1)
      )[0];
      expect(old_deleted_item!.value.item).to.deep.include({
        title: "Older Deleted Bookmark",
        url: `${B}#older-deleted`,
      });
      expect(
        new Date(old_deleted_item!.value.deleted_at).valueOf(),
      ).to.be.lessThan(deleted_item_cutoff);

      await env.model.gc();

      expect(await env.deleted_items.get([old_deleted_item.key])).to.deep.equal(
        [],
      );
    });

    it("keeps bookmark metadata for active bookmarks", async () => {
      await env.model.gc();

      expect(
        await env.bookmark_metadata.get([env.bookmarks.unnamed.id]),
      ).to.deep.equal([
        {key: env.bookmarks.unnamed.id, value: {collapsed: true}},
      ]);
    });

    it("keeps cached favicons that are in open tabs", async () => {
      await env.model.gc();

      expect(await env.favicons.get([`${B}#doug`, `${B}#alice`])).to.deep.equal(
        [
          {key: `${B}#doug`, value: {favIconUrl: `${B}#doug.favicon`}},
          {key: `${B}#alice`, value: {favIconUrl: `${B}#alice.favicon`}},
        ],
      );
    });

    it("keeps cached favicons for bookmarks", async () => {
      await env.model.gc();

      expect(
        await env.favicons.get([`${B}#nate`, `${B}#undyne`]),
      ).to.deep.equal([
        {key: `${B}#nate`, value: {favIconUrl: `${B}#nate.favicon`}},
        {key: `${B}#undyne`, value: {favIconUrl: `${B}#undyne.favicon`}},
      ]);
    });

    it("keeps recently deleted items", async () => {
      expect(
        env.model.options.sync.state.deleted_items_expiration_days,
      ).to.equal(M.Options.SYNC_DEF.deleted_items_expiration_days.default);

      const newest_deleted = (
        await env.deleted_items.getEndingAt(undefined, 1)
      )[0];
      expect(Date.parse(newest_deleted.value.deleted_at)).to.be.greaterThan(
        deleted_item_cutoff,
      );

      await env.model.gc();

      const items = await env.deleted_items.getEndingAt(undefined, 1000);
      expect(items.length).to.be.greaterThan(0);
      for (const item of items) {
        expect(Date.parse(item.value.deleted_at)).to.be.greaterThan(
          deleted_item_cutoff,
        );
      }
    });

    describe("hidden tabs", () => {
      it("leaves stashed tabs alone", async () => {
        await browser.sessions.setTabValue(
          env.tabs.real_doug_2.id,
          M.Tabs.SK_HIDDEN_BY_TAB_STASH,
          true,
        );

        await env.model.closeOrphanedHiddenTabs();

        const hidden = await browser.tabs.query({hidden: true});
        expect(hidden.map(t => t.id!)).to.deep.equal([
          env.tabs.small_hidden.id,
          env.tabs.real_doug_2.id,
          env.tabs.real_harry.id,
          env.tabs.real_helen.id,
        ]);
      });

      it("closes orphaned stashed tabs", async () => {
        await browser.sessions.setTabValue(
          env.tabs.real_doug_2.id,
          M.Tabs.SK_HIDDEN_BY_TAB_STASH,
          true,
        );

        await browser.bookmarks.remove(env.bookmarks.doug_2.id);
        while (
          env.model.bookmarks.node(env.bookmarks.doug_2.id) !== undefined
        ) {
          await new Promise(r => setTimeout(r));
        }

        await env.model.closeOrphanedHiddenTabs();

        const hidden = await browser.tabs.query({hidden: true});
        expect(hidden.map(t => t.id!)).to.deep.equal([
          env.tabs.small_hidden.id,
          env.tabs.real_harry.id,
          env.tabs.real_helen.id,
        ]);
      });

      it("leaves tabs hidden by other extensions alone", async () => {
        await env.model.closeOrphanedHiddenTabs();

        const hidden = await browser.tabs.query({hidden: true});
        expect(hidden.map(t => t.id!)).to.deep.equal([
          env.tabs.small_hidden.id,
          env.tabs.real_doug_2.id,
          env.tabs.real_harry.id,
          env.tabs.real_helen.id,
        ]);
      });
    });
  });

  describe("choosing stashable tabs in a window", () => {
    it("throws when an invalid window is selected", () => {
      expect(() => env.model.stashableTabsInWindow("asdf" as any)).to.throw(
        Error,
      );
    });

    it("chooses all non-hidden, non-pinned and non-privileged tabs", () => {
      const win = env.model.tabs.window(env.windows.real.id)!;
      expect(env.model.stashableTabsInWindow(win).map(t => t.id)).to.deep.equal(
        [
          env.tabs.real_bob.id,
          env.tabs.real_doug.id,
          env.tabs.real_estelle.id,
          env.tabs.real_francis.id,
          env.tabs.real_unstashed.id,
        ],
      );
    });

    it("allows user selection to override the default choice", async () => {
      await browser.tabs.update(env.tabs.real_bob.id, {highlighted: true});
      await browser.tabs.update(env.tabs.real_doug.id, {highlighted: true});
      await browser.tabs.update(env.tabs.real_paul.id, {highlighted: true});
      await browser.tabs.update(env.tabs.real_harry.id, {highlighted: true});
      await events.nextN(browser.tabs.onHighlighted, 4);

      const win = env.model.tabs.window(env.windows.real.id)!;
      expect(env.model.stashableTabsInWindow(win).map(t => t.id)).to.deep.equal(
        [
          // was previously active and therefore explicitly selected
          env.tabs.real_blank.id,
          // explicitly selected
          env.tabs.real_bob.id,
          // explicitly selected
          env.tabs.real_doug.id,
          // paul is always excluded because he's pinned
          // harry is always excluded because he's hidden
        ],
      );
    });
  });

  describe("hides or closes stashed tabs", () => {
    describe("according to user settings", () => {
      it("hides tabs but keeps them loaded", async () => {
        await env.model.options.local.set({after_stashing_tab: "hide"});
        await events.next(browser.storage.onChanged);
        await events.next(browser.storage.local.onChanged);
        await events.next(env.model.options.local.onChanged);
        expect(env.model.options.local.state.after_stashing_tab).to.equal(
          "hide",
        );

        await env.model.hideOrCloseStashedTabs([
          env.model.tabs.tab(env.tabs.right_doug.id)!,
        ]);
        await events.next(browser.tabs.onUpdated); // hidden

        const t = await browser.tabs.get(env.tabs.right_doug.id);
        expect(t).to.deep.include({
          url: env.tabs.right_doug.url,
          hidden: true,
        });
        expect(env.model.tabs.tab(env.tabs.right_doug.id)).to.deep.include({
          url: env.tabs.right_doug.url,
          hidden: true,
        });
        expect(env.model.tabs.tab(env.tabs.right_doug.id)!.discarded).not.to.be
          .ok;

        const bm_id = await browser.sessions.getTabValue(
          env.tabs.right_doug.id,
          M.Tabs.SK_HIDDEN_BY_TAB_STASH,
        );
        expect(bm_id).to.equal(true);
      });

      it("hides and unloads tabs", async () => {
        await env.model.options.local.set({after_stashing_tab: "hide_discard"});
        await events.next(browser.storage.onChanged);
        await events.next(browser.storage.local.onChanged);
        await events.next(env.model.options.local.onChanged);
        expect(env.model.options.local.state.after_stashing_tab).to.equal(
          "hide_discard",
        );

        await env.model.hideOrCloseStashedTabs([
          env.model.tabs.tab(env.tabs.right_doug.id)!,
        ]);
        await events.next(browser.tabs.onUpdated); // hidden
        await events.next(browser.tabs.onUpdated); // discarded

        expect(await browser.tabs.get(env.tabs.right_doug.id)).to.deep.include({
          url: env.tabs.right_doug.url,
          hidden: true,
          discarded: true,
        });
        expect(env.model.tabs.tab(env.tabs.right_doug.id)).to.deep.include({
          url: env.tabs.right_doug.url,
          hidden: true,
          discarded: true,
        });

        const bm_id = await browser.sessions.getTabValue(
          env.tabs.right_doug.id,
          M.Tabs.SK_HIDDEN_BY_TAB_STASH,
        );
        expect(bm_id).to.equal(true);
      });

      it("closes tabs", async () => {
        await env.model.options.local.set({after_stashing_tab: "close"});
        await events.next(browser.storage.onChanged);
        await events.next(browser.storage.local.onChanged);
        await events.next(env.model.options.local.onChanged);
        expect(env.model.options.local.state.after_stashing_tab).to.equal(
          "close",
        );

        const p = env.model.hideOrCloseStashedTabs([
          env.model.tabs.tab(env.tabs.right_doug.id)!,
        ]);
        await events.next(browser.tabs.onRemoved);
        await p;

        await browser.tabs.get(env.tabs.right_doug.id).then(
          /* c8 ignore next -- bug-checking */
          () => expect.fail("browser.tabs.get did not throw"),
          () => {},
        );
        expect(env.model.tabs.tab(env.tabs.right_doug.id)).to.be.undefined;
      });
    });

    it("opens a new empty tab if needed to keep the window open", async () => {
      await env.model.options.local.set({after_stashing_tab: "hide"});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);
      await events.next(env.model.options.local.onChanged);
      expect(env.model.options.local.state.after_stashing_tab).to.equal("hide");

      await env.model.hideOrCloseStashedTabs(
        [
          env.tabs.left_alice.id,
          env.tabs.left_betty.id,
          env.tabs.left_charlotte.id,
        ].map(id => env.model.tabs.tab(id)!),
      );
      await events.next(browser.tabs.onHighlighted); // un-highlight current tab
      await events.next(browser.tabs.onCreated);
      await events.next(browser.tabs.onActivated);
      await events.next(browser.tabs.onHighlighted);
      await events.nextN(browser.tabs.onUpdated, 4);

      const win = await browser.tabs.query({windowId: env.windows.left.id});
      expect(
        win.map(({id, url, active, hidden}) => ({id, url, active, hidden})),
      ).to.deep.equal([
        {
          id: env.tabs.left_alice.id,
          url: `${B}#alice`,
          active: false,
          hidden: true,
        },
        {
          id: env.tabs.left_betty.id,
          url: `${B}#betty`,
          active: false,
          hidden: true,
        },
        {
          id: env.tabs.left_charlotte.id,
          url: `${B}#charlotte`,
          active: false,
          hidden: true,
        },
        {id: win[3].id, url: B, active: true, hidden: undefined},
      ]);

      expect(
        env.model.tabs.window(env.windows.left.id)!.children.map(bm => bm.id),
      ).to.deep.equal([
        env.tabs.left_alice.id,
        env.tabs.left_betty.id,
        env.tabs.left_charlotte.id,
        win[3].id!,
      ]);
      expect(env.model.tabs.tab(env.tabs.left_alice.id)!.hidden).to.be.true;
      expect(env.model.tabs.tab(env.tabs.left_betty.id)!.hidden).to.be.true;
      expect(env.model.tabs.tab(env.tabs.left_charlotte.id)!.hidden).to.be.true;
      expect(env.model.tabs.tab(win[3].id as TabID)).to.deep.include({
        active: true,
      });
    });

    it("refocuses away from an active tab that is to be closed", async () => {
      await env.model.hideOrCloseStashedTabs([
        env.model.tabs.tab(env.tabs.left_alice.id)!,
      ]);
      await events.next(browser.tabs.onHighlighted); // un-highlight current tab
      await events.next(browser.tabs.onActivated);
      await events.next(browser.tabs.onHighlighted);
      await events.next(browser.tabs.onUpdated); // hidden

      const win = await browser.tabs.query({windowId: env.windows.left.id});
      expect(
        win.map(({id, url, active, hidden}) => ({id, url, active, hidden})),
      ).to.deep.equal([
        {
          id: env.tabs.left_alice.id,
          url: `${B}#alice`,
          active: false,
          hidden: true,
        },
        {
          id: env.tabs.left_betty.id,
          url: `${B}#betty`,
          active: true,
          hidden: undefined,
        },
        {
          id: env.tabs.left_charlotte.id,
          url: `${B}#charlotte`,
          active: false,
          hidden: undefined,
        },
      ]);
    });

    it("clears any selections on hidden tabs", async () => {
      const tab = env.model.tabs.tab(env.tabs.real_bob.id)!;
      const si = env.model.selection.info(tab);

      si.isSelected = true;
      expect(Array.from(env.model.selection.selectedItems())).to.deep.equal([
        tab,
      ]);

      const p1 = browser.tabs.update(tab.id, {highlighted: true});
      await events.next(browser.tabs.onHighlighted);
      await p1;

      expect(tab.highlighted).to.be.true;

      const p2 = env.model.hideOrCloseStashedTabs([tab]);
      await events.next(browser.tabs.onHighlighted);
      await events.next(browser.tabs.onUpdated);
      await p2;

      expect(tab.hidden).to.be.true;
      expect(tab.highlighted).to.be.false;
      expect(si.isSelected).to.be.false;
      expect(Array.from(env.model.selection.selectedItems())).to.deep.equal([]);
    });
  });

  describe("creates and uses default stash destinations", () => {
    beforeEach(() => {
      expect(env.model.bookmarks.stash_root.value).not.to.be.undefined;
      expect(env.model.defaultStashDestFolder()).to.be.undefined;
    });

    async function createStashFolder() {
      const p = env.model.createStashFolder();
      await events.next(browser.bookmarks.onCreated);
      return await p;
    }

    it("creates a new destination (no search)", async () => {
      const f = await createStashFolder();

      expect(env.model.bookmarks.stash_root.value!.children[0]).to.equal(f);
      expect(M.Bookmarks.getDefaultFolderNameISODate(f.title)).to.be.a(
        "string",
      );
      expect(env.model.defaultStashDestFolder()).to.equal(f);
    });

    it("creates a new destination (with search)", async () => {
      env.model.searchText.value = "the folder title";
      const f = await createStashFolder();

      expect(env.model.bookmarks.stash_root.value!.children[0]).to.equal(f);
      expect(f.title).to.equal("the folder title");
      expect(env.model.defaultStashDestFolder()).to.equal(f);
    });

    it("reuses an existing (without search)", async () => {
      const f = await createStashFolder();
      const f2 = await env.model.ensureDefaultStashDestFolder();

      expect(M.Bookmarks.getDefaultFolderNameISODate(f.title)).to.be.a(
        "string",
      );
      expect(f).to.not.be.undefined;
      expect(f).to.equal(f2);
    });

    it("reuses an existing (with search)", async () => {
      env.model.searchText.value = "the folder title";

      const f = await createStashFolder();
      const f2 = await env.model.ensureDefaultStashDestFolder();

      expect(f).to.not.be.undefined;
      expect(f).to.equal(f2);
      expect(f.title).to.equal("the folder title");
    });
  });

  describe("puts items in bookmark folders", () => {
    async function check_folder(
      folderName: keyof typeof env.bookmarks,
      children: (keyof typeof env.bookmarks)[],
    ) {
      const real_folder = await browser.bookmarks.getChildren(
        env.bookmarks[folderName].id,
      );
      expect(
        real_folder.map(c => c.title),
        "Browser bookmark titles",
      ).to.deep.equal(children.map(c => env.bookmarks[c].title));
      expect(
        real_folder.map(c => c.id),
        "Browser bookmark IDs",
      ).to.deep.equal(children.map(c => env.bookmarks[c].id));

      const folder = env.model.bookmarks.folder(env.bookmarks[folderName].id)!;
      expect(folder, `Folder ${folderName} is loaded in model`).to.not.be
        .undefined;
      expect(
        folder.children.map(c => c?.title),
        "Model bookmark titles",
      ).to.deep.equal(children.map(c => env.bookmarks[c].title));
      expect(
        folder.children.map(bm => bm?.id),
        "Model bookmark IDs",
      ).to.deep.equal(children.map(c => env.bookmarks[c].id));
    }

    const testMove =
      (options: {
        items: (keyof typeof env.bookmarks)[];
        toFolder: keyof typeof env.bookmarks;
        toIndex: number;
        finalState: (keyof typeof env.bookmarks)[];
      }) =>
      async () => {
        const p = env.model.putItemsInFolder({
          items: options.items.map(
            i => env.model.bookmarks.node(env.bookmarks[i].id)!,
          ),
          toFolder: env.model.bookmarks.folder(
            env.bookmarks[options.toFolder].id,
          )!,
          toIndex: options.toIndex,
        });
        await events.nextN(browser.bookmarks.onMoved, options.items.length);
        await p;
        await check_folder(options.toFolder, options.finalState);
      };

    beforeEach(async () => {
      await env.model.bookmarks.loadedSubtree(
        env.model.bookmarks.stash_root.value!,
      );
      await check_folder("big_stash", [
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
        "eight",
      ]);
    });

    describe("moves bookmarks in the same folder to a new position", () => {
      it(
        "to the beginning",
        testMove({
          items: ["three", "five"],
          toFolder: "big_stash",
          toIndex: 0,
          finalState: [
            "three",
            "five",
            "one",
            "two",
            "four",
            "six",
            "seven",
            "eight",
          ],
        }),
      );

      it(
        "to almost the end",
        testMove({
          items: ["three", "five"],
          toFolder: "big_stash",
          toIndex: 7,
          finalState: [
            "one",
            "two",
            "four",
            "six",
            "seven",
            "three",
            "five",
            "eight",
          ],
        }),
      );

      it(
        "to the end",
        testMove({
          items: ["three", "five"],
          toFolder: "big_stash",
          toIndex: 8,
          finalState: [
            "one",
            "two",
            "four",
            "six",
            "seven",
            "eight",
            "three",
            "five",
          ],
        }),
      );

      it(
        "forward single",
        testMove({
          items: ["two"],
          toFolder: "big_stash",
          toIndex: 4,
          finalState: [
            "one",
            "three",
            "four",
            "two",
            "five",
            "six",
            "seven",
            "eight",
          ],
        }),
      );

      it(
        "backward single",
        testMove({
          items: ["six"],
          toFolder: "big_stash",
          toIndex: 2,
          finalState: [
            "one",
            "two",
            "six",
            "three",
            "four",
            "five",
            "seven",
            "eight",
          ],
        }),
      );

      it(
        "forward multiple",
        testMove({
          items: ["one", "two", "four"],
          toFolder: "big_stash",
          toIndex: 5,
          finalState: [
            "three",
            "five",
            "one",
            "two",
            "four",
            "six",
            "seven",
            "eight",
          ],
        }),
      );

      it(
        "backward multiple",
        testMove({
          items: ["five", "six", "eight"],
          toFolder: "big_stash",
          toIndex: 1,
          finalState: [
            "one",
            "five",
            "six",
            "eight",
            "two",
            "three",
            "four",
            "seven",
          ],
        }),
      );

      it(
        "to the middle",
        testMove({
          items: ["two", "three", "six", "eight"],
          toFolder: "big_stash",
          toIndex: 4,
          finalState: [
            "one",
            "four",
            "two",
            "three",
            "six",
            "eight",
            "five",
            "seven",
          ],
        }),
      );

      it(
        "to the middle (moving the insertion point)",
        testMove({
          items: ["two", "three", "five", "eight"],
          toFolder: "big_stash",
          toIndex: 4,
          finalState: [
            "one",
            "four",
            "two",
            "three",
            "five",
            "eight",
            "six",
            "seven",
          ],
        }),
      );

      it(
        "leaves everything where it is",
        testMove({
          items: ["three", "four", "five"],
          toFolder: "big_stash",
          toIndex: 3,
          finalState: [
            "one",
            "two",
            "three",
            "four",
            "five",
            "six",
            "seven",
            "eight",
          ],
        }),
      );
    });

    it(
      "moves bookmarks from different folders into the target folder",
      testMove({
        items: ["helen", "patricia"],
        toFolder: "big_stash",
        toIndex: 3,
        finalState: [
          "one",
          "two",
          "three",
          "helen",
          "patricia",
          "four",
          "five",
          "six",
          "seven",
          "eight",
        ],
      }),
    );

    it(
      "moves a combination of bookmarks from the same/different folders",
      testMove({
        items: ["one", "three", "seven", "helen", "nate"],
        toFolder: "big_stash",
        toIndex: 3,
        finalState: [
          "two",
          "one",
          "three",
          "seven",
          "helen",
          "nate",
          "four",
          "five",
          "six",
          "eight",
        ],
      }),
    );

    it("copies external items into the folder", async () => {
      const p = env.model.putItemsInFolder({
        items: [
          {url: "foo", title: "Foo"},
          {url: "bar", title: "Bar"},
        ],
        toFolder: env.model.bookmarks.folder(env.bookmarks.names.id)!,
        toIndex: 2,
      });
      await events.nextN(browser.bookmarks.onCreated, 2);
      await p;

      const titles = [
        "Doug Duplicate",
        "Helen Hidden",
        "Foo",
        "Bar",
        "Patricia Pinned",
        "Nate NotOpen",
      ];
      const urls = [
        `${B}#doug`,
        `${B}#helen`,
        `foo`,
        `bar`,
        `${B}#patricia`,
        `${B}#nate`,
      ];

      const real_folder = await browser.bookmarks.getChildren(
        env.bookmarks.names.id,
      );
      expect(
        real_folder.map(c => c.title),
        "Browser bookmark titles",
      ).to.deep.equal(titles);
      expect(
        real_folder.map(c => c.url),
        "Browser bookmark URLs",
      ).to.deep.equal(urls);

      const folder = env.model.bookmarks.folder(env.bookmarks.names.id)!;
      expect(
        folder.children.map(c => c?.title),
        "Model bookmark titles",
      ).to.deep.equal(titles);
      expect(
        folder.children.map(c => c && isBookmark(c) && c.url),
        "Model bookmark URLs",
      ).to.deep.equal(urls);
    });

    it("moves tabs into the folder", async () => {
      const p = env.model.putItemsInFolder({
        items: [
          env.model.tabs.tab(env.tabs.real_bob.id)!,
          env.model.tabs.tab(env.tabs.real_estelle.id)!,
        ],
        toFolder: env.model.bookmarks.folder(env.bookmarks.names.id)!,
        toIndex: 2,
      });
      await events.nextN(browser.bookmarks.onCreated, 2);
      await events.nextN(browser.tabs.onUpdated, 2);
      await p;

      const titles = [
        "Doug Duplicate",
        "Helen Hidden",
        `${B}#bob`,
        `${B}#estelle`,
        "Patricia Pinned",
        "Nate NotOpen",
      ];
      const urls = [
        `${B}#doug`,
        `${B}#helen`,
        `${B}#bob`,
        `${B}#estelle`,
        `${B}#patricia`,
        `${B}#nate`,
      ];

      expect(env.model.tabs.tab(env.tabs.real_bob.id)!.hidden).to.be.true;
      expect(env.model.tabs.tab(env.tabs.real_estelle.id)!.hidden).to.be.true;

      const real_folder = await browser.bookmarks.getChildren(
        env.bookmarks.names.id,
      );
      expect(
        real_folder.map(c => c.title),
        "Browser bookmark titles",
      ).to.deep.equal(titles);
      expect(
        real_folder.map(c => c.url),
        "Browser bookmark URLs",
      ).to.deep.equal(urls);

      const folder = env.model.bookmarks.folder(env.bookmarks.names.id)!;
      expect(
        folder.children.map(c => c?.title),
        "Model bookmark titles",
      ).to.deep.equal(titles);
      expect(
        folder.children.map(c => c && isBookmark(c) && c.url),
        "Model bookmark URLs",
      ).to.deep.equal(urls);
    });

    it("moves tabs and bookmarks into the folder", async () => {
      const p = env.model.putItemsInFolder({
        items: [
          env.model.tabs.tab(env.tabs.real_bob.id)!,
          env.model.tabs.tab(env.tabs.real_estelle.id)!,
          env.model.bookmarks.bookmark(env.bookmarks.two.id)!,
          env.model.bookmarks.bookmark(env.bookmarks.four.id)!,
        ],
        toFolder: env.model.bookmarks.folder(env.bookmarks.names.id)!,
        toIndex: 2,
      });
      await events.nextN(browser.bookmarks.onCreated, 2);
      await events.nextN(browser.bookmarks.onMoved, 2);
      await events.nextN(browser.tabs.onUpdated, 2);
      await p;

      const titles = [
        "Doug Duplicate",
        "Helen Hidden",
        `${B}#bob`,
        `${B}#estelle`,
        `Two`,
        `Four`,
        "Patricia Pinned",
        "Nate NotOpen",
      ];
      const urls = [
        `${B}#doug`,
        `${B}#helen`,
        `${B}#bob`,
        `${B}#estelle`,
        `${B}#2`,
        `${B}#4`,
        `${B}#patricia`,
        `${B}#nate`,
      ];

      expect(env.model.tabs.tab(env.tabs.real_bob.id)!.hidden).to.be.true;
      expect(env.model.tabs.tab(env.tabs.real_estelle.id)!.hidden).to.be.true;
      expect(
        env.model.bookmarks.bookmark(env.bookmarks.two.id)!.position!.parent,
      ).to.equal(env.model.bookmarks.folder(env.bookmarks.names.id));
      expect(
        env.model.bookmarks.bookmark(env.bookmarks.four.id)!.position!.parent,
      ).to.equal(env.model.bookmarks.folder(env.bookmarks.names.id));

      const real_folder = await browser.bookmarks.getChildren(
        env.bookmarks.names.id,
      );
      expect(
        real_folder.map(c => c.title),
        "Browser bookmark titles",
      ).to.deep.equal(titles);
      expect(
        real_folder.map(c => c.url),
        "Browser bookmark URLs",
      ).to.deep.equal(urls);

      const folder = env.model.bookmarks.folder(env.bookmarks.names.id)!;
      expect(
        folder.children.map(c => c?.title),
        "Model bookmark titles",
      ).to.deep.equal(titles);
      expect(
        folder.children.map(c => c && isBookmark(c) && c.url),
        "Model bookmark URLs",
      ).to.deep.equal(urls);

      expect(
        env.model.bookmarks
          .folder(env.bookmarks.big_stash.id)!
          .children.map(bm => bm?.id),
      ).to.deep.equal([
        env.bookmarks.one.id,
        env.bookmarks.three.id,
        env.bookmarks.five.id,
        env.bookmarks.six.id,
        env.bookmarks.seven.id,
        env.bookmarks.eight.id,
      ]);
    });

    it("skips or steals duplicates when putting items in the same folder", async () => {
      const urls = [
        `${B}#gazebo`,
        `${B}#doug`,
        `${B}#gazebo`,
        `${B}#turtle`,
        `${B}#nate`,
        // https://github.com/josh-berry/tab-stash/issues/638
        redirUrl(`${B}#patricia`),
      ];
      const folder = env.model.bookmarks.folder(env.bookmarks.names.id)!;
      const p = env.model.putItemsInFolder({
        toFolder: folder,
        toIndex: 2,
        items: urls.map(url => ({url})),
      });
      await events.next(browser.bookmarks.onCreated);
      await events.next(browser.bookmarks.onMoved);
      await events.next(browser.bookmarks.onCreated);
      await events.next(browser.bookmarks.onCreated);
      await events.next(browser.bookmarks.onMoved);
      await events.next(browser.bookmarks.onMoved);
      const res = await p;

      const expectedIds = [
        env.bookmarks.helen.id,
        res[0].id,
        env.bookmarks.doug_2.id,
        res[2].id,
        res[3].id,
        env.bookmarks.nate.id,
        env.bookmarks.patricia.id,
      ];

      expect(
        filterMap(res, r => (r as M.Bookmarks.Bookmark).url),
      ).to.deep.equal(urls.map(u => urlToStash(u)));

      expect(folder.children.map(bm => bm?.id)).to.deep.equal(expectedIds);
      expect(
        folder.children.map(b => b && isBookmark(b) && b.url),
      ).to.deep.equal([
        `${B}#helen`,
        `${B}#gazebo`,
        `${B}#doug`,
        `${B}#gazebo`,
        `${B}#turtle`,
        `${B}#nate`,
        `${B}#patricia`,
      ]);

      expect(
        (await browser.bookmarks.getChildren(env.bookmarks.names.id)).map(
          b => b.id,
        ),
      ).to.deep.equal(expectedIds);
    });

    it("puts nested folders into the stash", async () => {
      const folder = env.model.bookmarks.folder(env.bookmarks.names.id)!;
      const p = env.model.putItemsInFolder({
        toFolder: folder,
        toIndex: 0,
        items: [
          {
            title: "Folder",
            children: [
              {title: "1", url: `${B}#1`},
              {title: "2", url: `${B}#2`},
              {
                title: "Nested",
                children: [
                  {title: "3", url: `${B}#3`},
                  {title: "4", url: `${B}#4`},
                ],
              },
            ],
          },
        ],
      });
      await events.nextN(browser.bookmarks.onCreated, 6);
      await p;

      const topChild = folder.children[0] as Folder;
      expect(isFolder(topChild)).to.be.true;
      expect(topChild.title).to.equal("Folder");
      expect(topChild.children.map(c => c?.title)).to.deep.equal([
        "1",
        "2",
        "Nested",
      ]);

      const nestedChildren = (topChild.children[2] as Folder).children;
      expect(nestedChildren.map(c => c?.title)).to.deep.equal(["3", "4"]);
    });
  });

  describe("puts items in windows", () => {
    async function check_window(
      windowName: keyof typeof env.windows,
      children: (keyof typeof env.tabs)[],
    ) {
      const real_tabs = await browser.tabs.query({
        windowId: env.windows[windowName].id,
      });
      expect(
        real_tabs.map(c => c.url),
        "Browser tab URLs",
      ).to.deep.equal(children.map(c => env.tabs[c].url));
      expect(
        real_tabs.map(c => c.id),
        "Browser tab IDs",
      ).to.deep.equal(children.map(c => env.tabs[c].id));

      const win = env.model.tabs.window(env.windows[windowName].id)!;
      // console.log(win.tabs);
      // console.log(children.map(c => ({[c]: tabs[c].id})));
      expect(
        win.children.map(c => c.url),
        "Model tab URLs",
      ).to.deep.equal(children.map(c => env.tabs[c].url));
      expect(
        win.children.map(t => t.id),
        "Model tab IDs",
      ).to.deep.equal(children.map(c => env.tabs[c].id));
    }

    const testMove =
      (options: {
        items: (keyof typeof env.tabs)[];
        toWindow: keyof typeof env.windows;
        toIndex: number;
        finalState: (keyof typeof env.tabs)[];
      }) =>
      async () => {
        const p = env.model.putItemsInWindow({
          items: options.items.map(i => env.model.tabs.tab(env.tabs[i].id)!),
          toWindow: env.model.tabs.window(env.windows[options.toWindow].id)!,
          toIndex: options.toIndex,
        });
        await events.nextN<any>(
          [browser.tabs.onMoved, browser.tabs.onAttached],
          options.items.length,
        );
        await p;
        await check_window(options.toWindow, options.finalState);
      };

    beforeEach(async () => {
      await check_window("real", [
        "real_patricia",
        "real_paul",
        "real_blank",
        "real_bob",
        "real_doug",
        "real_doug_2",
        "real_estelle",
        "real_francis",
        "real_harry",
        "real_unstashed",
        "real_helen",
      ]);
    });

    describe("moves tabs in the same window to a new position", () => {
      it(
        "to the beginning",
        testMove({
          items: ["real_bob"],
          toWindow: "real",
          toIndex: 0,
          finalState: [
            "real_bob",
            "real_patricia",
            "real_paul",
            "real_blank",
            "real_doug",
            "real_doug_2",
            "real_estelle",
            "real_francis",
            "real_harry",
            "real_unstashed",
            "real_helen",
          ],
        }),
      );

      it(
        "to almost the end",
        testMove({
          items: ["real_bob"],
          toWindow: "real",
          toIndex: 10,
          finalState: [
            "real_patricia",
            "real_paul",
            "real_blank",
            "real_doug",
            "real_doug_2",
            "real_estelle",
            "real_francis",
            "real_harry",
            "real_unstashed",
            "real_bob",
            "real_helen",
          ],
        }),
      );

      it(
        "to the end",
        testMove({
          items: ["real_bob"],
          toWindow: "real",
          toIndex: 11,
          finalState: [
            "real_patricia",
            "real_paul",
            "real_blank",
            "real_doug",
            "real_doug_2",
            "real_estelle",
            "real_francis",
            "real_harry",
            "real_unstashed",
            "real_helen",
            "real_bob",
          ],
        }),
      );

      it(
        "forward single",
        testMove({
          items: ["real_bob"],
          toWindow: "real",
          toIndex: 7,
          finalState: [
            "real_patricia",
            "real_paul",
            "real_blank",
            "real_doug",
            "real_doug_2",
            "real_estelle",
            "real_bob",
            "real_francis",
            "real_harry",
            "real_unstashed",
            "real_helen",
          ],
        }),
      );

      it(
        "backward single",
        testMove({
          items: ["real_francis"],
          toWindow: "real",
          toIndex: 2,
          finalState: [
            "real_patricia",
            "real_paul",
            "real_francis",
            "real_blank",
            "real_bob",
            "real_doug",
            "real_doug_2",
            "real_estelle",
            "real_harry",
            "real_unstashed",
            "real_helen",
          ],
        }),
      );

      it(
        "forward multiple",
        testMove({
          items: ["real_bob", "real_doug_2"],
          toWindow: "real",
          toIndex: 7,
          finalState: [
            "real_patricia",
            "real_paul",
            "real_blank",
            "real_doug",
            "real_estelle",
            "real_bob",
            "real_doug_2",
            "real_francis",
            "real_harry",
            "real_unstashed",
            "real_helen",
          ],
        }),
      );

      it(
        "backward multiple",
        testMove({
          items: ["real_estelle", "real_harry"],
          toWindow: "real",
          toIndex: 2,
          finalState: [
            "real_patricia",
            "real_paul",
            "real_estelle",
            "real_harry",
            "real_blank",
            "real_bob",
            "real_doug",
            "real_doug_2",
            "real_francis",
            "real_unstashed",
            "real_helen",
          ],
        }),
      );

      it(
        "to the middle",
        testMove({
          items: ["real_paul", "real_bob", "real_francis", "real_harry"],
          toWindow: "real",
          toIndex: 5,
          finalState: [
            "real_patricia",
            "real_blank",
            "real_doug",
            "real_paul",
            "real_bob",
            "real_francis",
            "real_harry",
            "real_doug_2",
            "real_estelle",
            "real_unstashed",
            "real_helen",
          ],
        }),
      );

      it(
        "to the middle (moving the insertion point)",
        testMove({
          items: ["real_paul", "real_doug", "real_doug_2", "real_harry"],
          toWindow: "real",
          toIndex: 5,
          finalState: [
            "real_patricia",
            "real_blank",
            "real_bob",
            "real_paul",
            "real_doug",
            "real_doug_2",
            "real_harry",
            "real_estelle",
            "real_francis",
            "real_unstashed",
            "real_helen",
          ],
        }),
      );

      it(
        "leaves everything where it is",
        testMove({
          items: ["real_bob", "real_doug", "real_doug_2", "real_estelle"],
          toWindow: "real",
          toIndex: 5,
          finalState: [
            "real_patricia",
            "real_paul",
            "real_blank",
            "real_bob",
            "real_doug",
            "real_doug_2",
            "real_estelle",
            "real_francis",
            "real_harry",
            "real_unstashed",
            "real_helen",
          ],
        }),
      );
    });

    // Probably works, but not a thing we care about right now, since the
    // Tab Stash UI only supports one window at a time...
    //
    // it('moves tabs from different windows into the target window');
    // it('moves a combination of tabs from the same/different windows');

    it("immediately loads tabs if so requested", async () => {
      await env.model.options.local.set({load_tabs_on_restore: "immediately"});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);
      await events.next("StoredObject.onChanged");
      expect(env.model.options.local.state.load_tabs_on_restore).to.equal(
        "immediately",
      );

      const p = env.model.putItemsInWindow({
        items: [{url: "http://example.com/#1"}, {url: "http://example.com/#2"}],
        toWindow: env.model.tabs.window(env.windows.right.id)!,
        toIndex: 2,
      });
      await events.nextN(browser.tabs.onCreated, 2);
      await events.nextN(browser.tabs.onUpdated, 6);
      await p;

      const urls = [
        `${B}`,
        `${B}#adam`,
        `http://example.com/#1`,
        `http://example.com/#2`,
        `${B}#doug`,
      ];

      const real_tabs = await browser.tabs.query({
        windowId: env.windows.right.id,
      });
      expect(
        real_tabs.map(c => c.url),
        "Browser tab URLs",
      ).to.deep.equal(urls);
      expect(real_tabs.every(c => !c.discarded)).to.be.true;
    });

    it("copies external items into the window", async () => {
      await env.model.options.local.set({load_tabs_on_restore: "lazily"});
      await events.next(browser.storage.onChanged);
      await events.next(browser.storage.local.onChanged);
      await events.next("StoredObject.onChanged");
      expect(env.model.options.local.state.load_tabs_on_restore).to.equal(
        "lazily",
      );

      const p = env.model.putItemsInWindow({
        items: [{url: `${B}#new1`}, {url: `${B}#new2`}],
        toWindow: env.model.tabs.window(env.windows.right.id)!,
        toIndex: 2,
      });
      await events.nextN(browser.tabs.onCreated, 2);
      await events.nextN(browser.tabs.onUpdated, 2);
      await p;

      const urls = [`${B}`, `${B}#adam`, `${B}#new1`, `${B}#new2`, `${B}#doug`];

      const real_tabs = await browser.tabs.query({
        windowId: env.windows.right.id,
      });
      expect(
        real_tabs.map(c => c.url),
        "Browser tab URLs",
      ).to.deep.equal(urls);

      const win = env.model.tabs.window(env.windows.right.id)!;
      expect(
        win.children.map(c => c.url),
        "Model tab URLs",
      ).to.deep.equal(urls);
    });

    it("moves bookmarks into the window", async () => {
      await env.model.bookmarks.loadedStash();
      expect(env.model.tabs.tab(env.tabs.real_helen.id)).to.deep.include({
        position: {
          parent: env.model.tabs.window(env.windows.real.id),
          index: 10,
        },
        hidden: true,
      });

      const p = env.model.putItemsInWindow({
        items: [
          env.model.bookmarks.bookmark(env.bookmarks.helen.id)!, // hidden tab
          env.model.bookmarks.bookmark(env.bookmarks.nate.id)!, // not open
        ],
        toWindow: env.model.tabs.window(env.windows.right.id)!,
        toIndex: 2,
      });
      await events.nextN<any>(
        [browser.tabs.onAttached, browser.tabs.onMoved],
        1,
      );
      await events.nextN(browser.tabs.onUpdated, 1);
      await events.nextN(browser.tabs.onCreated, 1); // nate created
      await events.nextN(browser.tabs.onUpdated, 1); // nate loaded
      await events.nextN(browser.bookmarks.onRemoved, 2);
      const res = await p;

      const urls = [
        `${B}`,
        `${B}#adam`,
        `${B}#helen`,
        `${B}#nate`,
        `${B}#doug`,
      ];

      const ids = [
        env.tabs.right_blank.id,
        env.tabs.right_adam.id,
        env.tabs.real_helen.id,
        res[1].id,
        env.tabs.right_doug.id,
      ];

      const real_tabs = await browser.tabs.query({
        windowId: env.windows.right.id,
      });
      expect(
        real_tabs.map(c => c.url),
        "Browser tab URLs",
      ).to.deep.equal(urls);
      expect(
        real_tabs.map(c => c.id),
        "Browser tab IDs",
      ).to.deep.equal(ids);

      const win = env.model.tabs.window(env.windows.right.id)!;
      expect(
        win.children.map(c => c.url),
        "Model tab URLs",
      ).to.deep.equal(urls);
      expect(
        win.children.map(t => t.id),
        "Model tab IDs",
      ).to.deep.equal(ids);

      expect(
        env.model.bookmarks
          .folder(env.bookmarks.names.id)!
          .children.map(bm => bm?.id),
      ).to.deep.equal([env.bookmarks.doug_2.id, env.bookmarks.patricia.id]);

      expect(env.model.tabs.tab(env.tabs.real_helen.id)).to.deep.include({
        position: {
          parent: env.model.tabs.window(env.windows.right.id),
          index: 2,
        },
        hidden: false,
      });

      // We should get some deleted items since we moved bookmarks out
      await events.nextN("KVS.Memory.onSet", 2);
      await env.model.deleted_items.loadMore();
      expect(env.model.deleted_items.state.entries[0].item).to.deep.include({
        url: env.bookmarks.helen.url,
      });
      expect(env.model.deleted_items.state.entries[1].item).to.deep.include({
        url: env.bookmarks.nate.url,
      });
    });

    it("moves tabs and bookmarks into the window", async () => {
      await env.model.bookmarks.loadedStash();
      const p = env.model.putItemsInWindow({
        items: [
          env.model.tabs.tab(env.tabs.right_doug.id)!,
          env.model.bookmarks.bookmark(env.bookmarks.nate.id)!,
        ],
        toWindow: env.model.tabs.window(env.windows.right.id)!,
        toIndex: 1,
      });
      await events.nextN(browser.tabs.onMoved, 1);
      await events.nextN(browser.tabs.onCreated, 1);
      await events.nextN(browser.tabs.onUpdated, 1);
      await events.nextN(browser.bookmarks.onRemoved, 1);
      await p;

      const urls = [`${B}`, `${B}#doug`, `${B}#nate`, `${B}#adam`];

      const real_tabs = await browser.tabs.query({
        windowId: env.windows.right.id,
      });
      expect(
        real_tabs.map(c => c.url),
        "Browser tab URLs",
      ).to.deep.equal(urls);

      const win = env.model.tabs.window(env.windows.right.id)!;
      expect(
        win.children.map(c => c.url),
        "Model tab URLs",
      ).to.deep.equal(urls);

      expect(
        env.model.bookmarks
          .folder(env.bookmarks.names.id)!
          .children.map(bm => bm?.id),
      ).to.deep.equal([
        env.bookmarks.doug_2.id,
        env.bookmarks.helen.id,
        env.bookmarks.patricia.id,
      ]);

      // We should get some deleted items since we moved bookmarks out
      await events.nextN("KVS.Memory.onSet", 1);
      await env.model.deleted_items.loadMore();
      expect(env.model.deleted_items.state.entries[0].item).to.deep.include({
        url: env.bookmarks.nate.url,
      });
    });

    it("moves bookmarks with hidden tabs into the window (backward)", async () => {
      await env.model.bookmarks.loadedStash();
      const p = env.model.putItemsInWindow({
        items: [env.model.bookmarks.bookmark(env.bookmarks.helen.id)!],
        toWindow: env.model.tabs.window(env.windows.real.id)!,
        toIndex: 9,
      });
      await events.next(browser.tabs.onMoved);
      await events.next(browser.tabs.onUpdated);
      await events.next(browser.bookmarks.onRemoved);
      await events.next("KVS.Memory.onSet");
      await p;

      await check_window("real", [
        "real_patricia",
        "real_paul",
        "real_blank",
        "real_bob",
        "real_doug",
        "real_doug_2",
        "real_estelle",
        "real_francis",
        "real_harry",
        "real_helen",
        "real_unstashed",
      ]);
    });

    it("moves bookmarks with hidden tabs into the window (forward)", async () => {
      await env.model.bookmarks.loadedStash();
      const p = env.model.putItemsInWindow({
        items: [env.model.bookmarks.bookmark(env.bookmarks.doug_2.id)!],
        toWindow: env.model.tabs.window(env.windows.real.id)!,
        toIndex: 9,
      });
      await events.next(browser.tabs.onMoved);
      await events.next(browser.tabs.onUpdated);
      await events.next(browser.bookmarks.onRemoved);
      await events.next("KVS.Memory.onSet");
      await p;

      await check_window("real", [
        "real_patricia",
        "real_paul",
        "real_blank",
        "real_bob",
        "real_doug",
        "real_estelle",
        "real_francis",
        "real_harry",
        "real_doug_2",
        "real_unstashed",
        "real_helen",
      ]);
    });
  });

  describe("restores tabs", () => {
    beforeEach(() => {
      expect(env.model.tabs.initialWindow.value).to.equal(
        env.model.tabs.window(env.windows.real.id),
      );
      expect(env.model.tabs.activeTab()!.url).to.equal(B);
    });

    it("restores a single hidden tab", async () => {
      const p = env.model.restoreTabs([{url: `${B}#harry`}], {});
      await events.next(browser.tabs.onMoved);
      await events.next(browser.tabs.onUpdated);
      await events.next(browser.tabs.onActivated);
      await events.next(browser.tabs.onHighlighted);
      await events.next(browser.tabs.onRemoved); // closing new-tab page
      await p;

      const restored = env.model.tabs.tab(env.tabs.real_harry.id)!;
      expect(restored.hidden).to.be.false;
      expect(restored.active).to.be.true;
      expect(restored.position?.parent.id).to.equal(env.windows.real.id);

      const win = env.model.tabs.window(env.windows.real.id)!;
      expect(win.children[win.children.length - 1].id).to.equal(
        env.tabs.real_harry.id,
      );
    });

    it("restores a single already-open tab by switching to it", async () => {
      await env.model.restoreTabs([{url: `${B}#estelle`}], {});
      await events.next(browser.tabs.onActivated);
      await events.next(browser.tabs.onHighlighted);

      const restored = env.model.tabs.tab(env.tabs.real_estelle.id)!;
      expect(restored.hidden).to.be.false;
      expect(restored.active).to.be.true;
      expect(restored.position?.parent.id).to.equal(env.windows.real.id);

      // Nothing should have moved
      const win = env.model.tabs.window(env.windows.real.id)!;
      expect(win.children.map(t => t.id)).to.deep.equal(
        env.windows.real.tabs!.map(t => t.id),
      );
    });

    it("restores multiple tabs", async () => {
      const p = env.model.restoreTabs(
        [{url: `${B}#harry`}, {url: `${B}#new-restored`}],
        {},
      );
      await events.next(browser.tabs.onMoved);
      await events.next(browser.tabs.onUpdated);
      await events.next(browser.tabs.onCreated);
      await events.next(browser.tabs.onUpdated);
      await events.next(browser.tabs.onActivated);
      await events.next(browser.tabs.onHighlighted);
      const restored = await p;
      await events.next(browser.tabs.onRemoved); // closing new-tab page

      expect(restored[0].hidden).to.be.false;
      expect(restored[0].active).to.be.false;
      expect(restored[1].hidden).to.be.false;
      expect(restored[1].active).to.be.true;

      const win = env.model.tabs.window(env.windows.real.id)!;
      expect(win.children.map(t => t.id)).to.deep.equal([
        env.tabs.real_patricia.id,
        env.tabs.real_paul.id,
        env.tabs.real_bob.id,
        env.tabs.real_doug.id,
        env.tabs.real_doug_2.id,
        env.tabs.real_estelle.id,
        env.tabs.real_francis.id,
        env.tabs.real_unstashed.id,
        env.tabs.real_helen.id,
        env.tabs.real_harry.id,
        restored[1].id,
      ]);
    });

    it("steals duplicates when restoring tabs", async () => {
      const p = env.model.restoreTabs(
        [`${B}#harry`, `${B}#doug`, `${B}#betty`, `${B}#doug`, `${B}#paul`].map(
          url => ({url}),
        ),
        {},
      );
      await events.next(browser.tabs.onMoved);
      await events.next(browser.tabs.onUpdated);
      await events.next(browser.tabs.onMoved);
      await events.next(browser.tabs.onUpdated);
      const new_betty = (await events.next(browser.tabs.onCreated))[0];
      await events.next(browser.tabs.onMoved);
      const new_paul = (await events.next(browser.tabs.onCreated))[0];
      await events.nextN(browser.tabs.onUpdated, 2);
      await events.next(browser.tabs.onActivated);
      await events.next(browser.tabs.onHighlighted);
      const restored = await p;
      await events.next(browser.tabs.onRemoved); // closing new-tab page

      expect(restored).to.deep.equal(
        [
          env.tabs.real_harry.id,
          env.tabs.real_doug_2.id,
          new_betty.id as TabID,
          env.tabs.real_doug.id,
          new_paul.id as TabID,
        ].map(id => env.model.tabs.tab(id)),
      );

      expect(restored.map(t => t.hidden)).to.deep.equal([
        false,
        false,
        false,
        false,
        false,
      ]);
      expect(restored.map(t => t.active)).to.deep.equal([
        false,
        false,
        false,
        false,
        true,
      ]);

      const win = env.model.tabs.window(env.windows.real.id)!;
      expect(win.children.map(t => t.id)).to.deep.equal([
        env.tabs.real_patricia.id,
        env.tabs.real_paul.id,
        env.tabs.real_bob.id,
        env.tabs.real_estelle.id,
        env.tabs.real_francis.id,
        env.tabs.real_unstashed.id,
        env.tabs.real_helen.id,
        env.tabs.real_harry.id,
        env.tabs.real_doug_2.id,
        new_betty.id,
        env.tabs.real_doug.id,
        new_paul.id,
      ]);
    });
  });

  describe("deletes and un-deletes bookmarks", () => {
    async function makeEmptyStashFolder() {
      await browser.bookmarks.create({
        parentId: env.model.bookmarks.stash_root.value!.id,
        index: 0,
        title: "Empty Folder",
      });
      await events.nextN(browser.bookmarks.onCreated, 1);
      expect(env.model.bookmarks.stash_root.value!.children.length).to.equal(4);
    }

    beforeEach(async () => {
      await env.model.bookmarks.loadedStash();
    });

    it("deletes folders and remembers them as deleted items", async () => {
      const f = env.model.bookmarks.node(env.bookmarks.names.id)!;
      const p = env.model.deleteBookmarkTree(f);
      await events.next(browser.bookmarks.onRemoved);
      await events.next("KVS.Memory.onSet");
      await p;

      expect(env.model.bookmarks.node(env.bookmarks.names.id)).to.be.undefined;
      expect(
        env.model.bookmarks.stash_root.value!.children.map(bm => bm?.id),
      ).to.deep.equal([
        env.bookmarks.unnamed.id,
        env.bookmarks.big_stash.id,
        env.bookmarks.nested.id,
      ]);

      await env.model.deleted_items.loadMore();
      expect(env.model.deleted_items.state.entries.length).to.be.greaterThan(0);
      expect(env.model.deleted_items.state.entries[0].item).to.deep.equal({
        title: "Names",
        children: [
          {
            title: "Doug Duplicate",
            url: `${B}#doug`,
            favIconUrl: `${B}#doug.favicon`,
          },
          {title: "Helen Hidden", url: `${B}#helen`},
          {title: "Patricia Pinned", url: `${B}#patricia`},
          {title: "Nate NotOpen", url: `${B}#nate`},
        ],
      });
    });

    it("deletes bookmarks and remembers them as deleted items", async () => {
      const p = env.model.deleteBookmark(
        env.model.bookmarks.bookmark(env.bookmarks.helen.id)!,
      );
      await events.next(browser.bookmarks.onRemoved);
      await events.next("KVS.Memory.onSet");
      await p;

      expect(env.model.bookmarks.node(env.bookmarks.helen.id)).to.be.undefined;
      expect(
        env.model.bookmarks
          .folder(env.bookmarks.names.id)!
          .children.map(b => b?.id),
      ).to.deep.equal([
        env.bookmarks.doug_2.id,
        env.bookmarks.patricia.id,
        env.bookmarks.nate.id,
      ]);

      await env.model.deleted_items.loadMore();
      expect(env.model.deleted_items.state.entries.length).to.be.greaterThan(0);
      expect(env.model.deleted_items.state.entries[0].item).to.deep.equal({
        title: "Helen Hidden",
        url: `${B}#helen`,
      });
      expect(
        env.model.deleted_items.state.entries[0].deleted_from,
      ).to.deep.equal({
        folder_id: env.bookmarks.names.id,
        title: "Names",
      });
    });

    it("un-deletes folders", async () => {
      const f = env.model.bookmarks.node(env.bookmarks.names.id)!;
      const p1 = env.model.deleteBookmarkTree(f);
      await events.next(browser.bookmarks.onRemoved);
      await events.next(env.deleted_items.onSet);
      await p1;

      expect(env.model.bookmarks.node(env.bookmarks.names.id)).to.be.undefined;

      await env.model.deleted_items.loadMore();
      expect(env.model.deleted_items.state.entries.length).to.be.greaterThan(0);

      const p = env.model.undelete(env.model.deleted_items.state.entries[0]);
      await events.nextN(browser.bookmarks.onCreated, 5);
      await events.next(env.deleted_items.onSet);
      await p;
      await events.nextN(env.favicons.onSet, 2);

      const restored = env.model.bookmarks.stash_root.value!
        .children[0] as Folder;
      expect(isFolder(restored)).to.be.true;
      expect(restored.title).to.equal(env.bookmarks.names.title);
      expect(
        restored.children.map(bm => bm && isBookmark(bm) && bm.url),
      ).to.deep.equal(env.bookmarks.names.children!.map(bm => bm.url));
    });

    describe("un-deletes bookmarks", () => {
      beforeEach(async () => {
        await env.model.bookmarks.loadedStash();
        const p = env.model.deleteBookmark(
          env.model.bookmarks.bookmark(env.bookmarks.helen.id)!,
        );
        await events.next(browser.bookmarks.onRemoved);
        await events.next(env.deleted_items.onSet);
        await p;

        // Wait for time to advance so we don't delete two items in the
        // same millisecond, and we can thus guarantee their sort order.
        const now = Date.now();
        while (Date.now() === now) await new Promise<void>(r => later(r));

        expect(env.model.bookmarks.node(env.bookmarks.helen.id)).to.be
          .undefined;
        expect(
          env.model.bookmarks
            .folder(env.bookmarks.names.id)!
            .children.map(b => b?.id),
        ).to.deep.equal([
          env.bookmarks.doug_2.id,
          env.bookmarks.patricia.id,
          env.bookmarks.nate.id,
        ]);

        expect(env.model.deleted_items.state.entries.length).to.equal(0);
        await env.model.deleted_items.loadMore();
        expect(env.model.deleted_items.state.entries.length).to.be.greaterThan(
          0,
        );
      });

      it("into their old folder", async () => {
        const p = env.model.undelete(env.model.deleted_items.state.entries[0]);
        await events.nextN(browser.bookmarks.onCreated, 1);
        await events.next(env.deleted_items.onSet);
        await p;

        const bms = env.model.bookmarks.folder(
          env.bookmarks.names.id,
        )!.children;
        expect(bms.map(bm => bm && isBookmark(bm) && bm.url)).to.deep.equal([
          `${B}#doug`,
          `${B}#patricia`,
          `${B}#nate`,
          `${B}#helen`,
        ]);
      });

      it("into a recent unnamed folder", async () => {
        // deleted item #1 is the item deleted in beforeEach() above

        // deleted item #0:
        const f = env.model.bookmarks.node(env.bookmarks.names.id)!;
        const p1 = env.model.deleteBookmarkTree(f);
        await events.next(browser.bookmarks.onRemoved);
        await events.next(env.deleted_items.onSet);
        await p1;

        await env.model.deleted_items.loadMore();
        expect(env.model.deleted_items.state.entries.length).to.be.greaterThan(
          1,
        );
        expect(env.model.deleted_items.state.entries[1].item.title).to.equal(
          "Helen Hidden",
        );
        expect(env.model.bookmarks.stash_root.value!.children.length).to.equal(
          3,
        );

        const p = env.model.undelete(env.model.deleted_items.state.entries[1]);
        await events.nextN(browser.bookmarks.onCreated, 1);
        await events.next(env.deleted_items.onSet);
        await p;

        expect(env.model.bookmarks.stash_root.value!.children.length).to.equal(
          3,
        );
        const restored_folder = env.model.bookmarks.folder(
          env.bookmarks.unnamed.id,
        )!;
        expect(
          restored_folder.children.map(bm => bm && isBookmark(bm) && bm.url),
        ).to.deep.equal([`${B}#undyne`, `${B}#helen`]);
      });

      it("into a new folder if the old one is gone", async () => {
        // deleted item #1 is the item deleted in beforeEach() above

        // deleted item #0:
        const f = env.model.bookmarks.node(env.bookmarks.names.id)!;
        const p1 = env.model.deleteBookmarkTree(f);
        await events.next(browser.bookmarks.onRemoved);
        await events.next(env.deleted_items.onSet);
        await p1;

        await env.model.deleted_items.loadMore();
        expect(env.model.deleted_items.state.entries.length).to.be.greaterThan(
          1,
        );
        expect(env.model.deleted_items.state.entries[1].item.title).to.equal(
          "Helen Hidden",
        );

        // We need to create a new folder here since the topmost folder is
        // now an unnamed folder.
        await makeEmptyStashFolder();

        const p = env.model.undelete(env.model.deleted_items.state.entries[1]);
        await events.nextN(browser.bookmarks.onCreated, 2);
        await events.next(env.deleted_items.onSet);
        await p;

        expect(env.model.bookmarks.stash_root.value!.children.length).to.equal(
          5,
        );
        const restored_folder = env.model.bookmarks.stash_root.value!
          .children[0] as Folder;
        expect(isFolder(restored_folder)).to.be.true;
        expect(getDefaultFolderNameISODate(restored_folder.title)).not.to.be
          .null;
        expect(
          restored_folder.children.map(bm => bm && isBookmark(bm) && bm.url),
        ).to.deep.equal([`${B}#helen`]);
      });
    });

    describe("un-deletes individual bookmarks in a deleted folder", () => {
      beforeEach(async () => {
        const f = env.model.bookmarks.node(env.bookmarks.names.id)!;
        const p = env.model.deleteBookmarkTree(f);
        await events.next(browser.bookmarks.onRemoved);
        await events.next(env.deleted_items.onSet);
        await p;

        expect(env.model.deleted_items.state.entries.length).to.equal(0);
        await env.model.deleted_items.loadMore();
        expect(env.model.deleted_items.state.entries.length).to.be.greaterThan(
          0,
        );
      });

      it("into a recently-created unnamed folder", async () => {
        const p = env.model.undelete(env.model.deleted_items.state.entries[0], [
          2,
        ]);
        await events.nextN(browser.bookmarks.onCreated, 1);
        await events.next(env.deleted_items.onSet); // deleted-item update
        await p;

        expect(env.model.bookmarks.stash_root.value!.children.length).to.equal(
          3,
        );
        const restored_folder = env.model.bookmarks.folder(
          env.bookmarks.unnamed.id,
        )!;
        expect(
          restored_folder.children.map(bm => bm && isBookmark(bm) && bm.url),
        ).to.deep.equal([`${B}#undyne`, `${B}#patricia`]);

        const item = env.model.deleted_items.state.entries[0]
          .item as DeletedFolder;
        expect(item.children).to.deep.equal([
          {
            title: "Doug Duplicate",
            url: `${B}#doug`,
            favIconUrl: `${B}#doug.favicon`,
          },
          {title: "Helen Hidden", url: `${B}#helen`},
          {title: "Nate NotOpen", url: `${B}#nate`},
        ]);
      });

      it("into a new folder", async () => {
        // We need to create a new folder here since the topmost folder is
        // now an unnamed folder.
        await makeEmptyStashFolder();

        const p = env.model.undelete(env.model.deleted_items.state.entries[0], [
          2,
        ]);
        await events.nextN(browser.bookmarks.onCreated, 2);
        await events.next(env.deleted_items.onSet); // deleted-item update
        await p;

        expect(env.model.bookmarks.stash_root.value!.children.length).to.equal(
          5,
        );
        const restored_folder = env.model.bookmarks.stash_root.value!
          .children[0] as Folder;
        expect(isFolder(restored_folder)).to.be.true;
        expect(getDefaultFolderNameISODate(restored_folder.title)).not.to.be
          .null;
        expect(
          restored_folder.children.map(bm => bm && isBookmark(bm) && bm.url),
        ).to.deep.equal([`${B}#patricia`]);

        const item = env.model.deleted_items.state.entries[0]
          .item as DeletedFolder;
        expect(item.children).to.deep.equal([
          {
            title: "Doug Duplicate",
            url: `${B}#doug`,
            favIconUrl: `${B}#doug.favicon`,
          },
          {title: "Helen Hidden", url: `${B}#helen`},
          {title: "Nate NotOpen", url: `${B}#nate`},
        ]);
      });
    });
  });
});

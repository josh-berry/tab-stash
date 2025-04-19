import {expect} from "chai";
import browser from "webextension-polyfill";

import type {NewTab} from "../model/index.js";
import {extractURLs, importURLs} from "./import.js";
import {TaskMonitor} from "../util/progress.js";
import {isFolder, type Bookmark, type Folder} from "../model/bookmarks.js";

import * as events from "../mock/events.js";
import tabWindowMock from "../mock/browser/tabs-and-windows.js";
import {setupModelTestEnv, type ModelTestEnv} from "../model/index.testlib.js";

describe("import", function () {
  describe("extractURLs", function () {
    const itf = (desc: string, i: string, o: NewTab[]) =>
      it(desc, () => expect(Array.from(extractURLs(i))).to.deep.equal(o));

    itf("parses a single URL", "http://example.com/", [
      {url: "http://example.com/"},
    ]);

    itf("parses a single URL with blank lines", "\n\nhttp://example.com/\n\n", [
      {url: "http://example.com/"},
    ]);

    itf("ignores leading whitespace", "\n  \thttp://foo.com/", [
      {url: "http://foo.com/"},
    ]);

    itf("ignores trailing whitespace", "http://foo.com/  \n", [
      {url: "http://foo.com/"},
    ]);

    itf(
      "parses a single URL with a OneTab title",
      "http://example.com/ | Example",
      [{url: "http://example.com/", title: "Example"}],
    );

    itf("ignores non-URL-shaped lines", "\nhttp://example.com/\nasdf\n", [
      {url: "http://example.com/"},
    ]);

    itf(
      "parses multiple URLs on different lines",
      "\nhttp://example.com/\nhttp://alt.com/\n\n",
      [{url: "http://example.com/"}, {url: "http://alt.com/"}],
    );

    itf(
      "parses multiple URLs on different lines with garbage",
      `
http://example.com/\tasdf
  http://ws.com/
   \thttp://wat.com/ fff`,
      [
        {url: "http://example.com/"},
        {url: "http://ws.com/"},
        {url: "http://wat.com/"},
      ],
    );

    itf("parses multiple URLs on the same line", `http://foo http://bar.com/`, [
      {url: "http://foo"},
      {url: "http://bar.com/"},
    ]);

    itf(
      "parses URLs in Markdown links",
      `- This is a [markdown link](http://whatever.com)`,
      [{url: "http://whatever.com", title: "markdown link"}],
    );

    // https://github.com/josh-berry/tab-stash/issues/306
    itf(
      "parses URLs that are hiding inside escaped quotes",
      '\\"this is a url: http://nowhere.com/foo\\"',
      [{url: "http://nowhere.com/foo"}],
    );

    itf(
      "parses URLs in raw HTML",
      `<a href="http://asdf.com/?test={uuid}#hashtag">link</a>`,
      [{url: "http://asdf.com/?test={uuid}#hashtag"}],
    );

    itf(
      "ignores mailto and other non-authoritative URLs",
      `mailto:foo@bar data:asdf`,
      [],
    );
  });

  describe("importURLs", function () {
    let env: ModelTestEnv = undefined!;

    async function waitForFetchingSiteInfo(nr_tabs: number) {
      const ps = [];
      for (let i = 0; i < nr_tabs; i++) {
        ps.push(
          (async () => {
            const [tab] = await events.next(browser.tabs.onCreated);

            // Make sure a title and favicon are set so we don't time out while
            // waiting for them to show up after the tab is loaded.
            tabWindowMock.updateTabInfo(tab.id!, {
              title: tab.url,
              favIconUrl: "about:favicon",
            });

            // Two status updates, and one update for the favicon
            await events.nextN(browser.tabs.onUpdated, 3);
            await events.next(browser.tabs.onRemoved);
          })(),
        );
      }
      await events.next(env.favicons.onSet);
      await Promise.all(ps);
      await events.watch(env.favicons.onSet).untilNextTick();
    }

    beforeEach(async () => {
      env = await setupModelTestEnv();
      // Stash root is created automatically when the model is created
    });

    it("returns failures for invalid URLs", async () => {
      const p = TaskMonitor.run(tm =>
        importURLs({
          model: env.model,
          toFolder: undefined,
          folders: [
            {
              title: "Mixed URLs",
              children: [
                {url: "file:///tmp/foobar.txt"},
                {url: "http://valid.com"},
                {url: "about:config"},
                {url: "http://example.com"},
              ],
            },
          ],
          fetchIconsAndTitles: true,
          task: tm,
        }),
      );
      await events.nextN(browser.bookmarks.onCreated, 5);
      await waitForFetchingSiteInfo(2); // one per valid URL
      await events.nextN(browser.bookmarks.onChanged, 2); // one per valid URL
      const failures = await p;

      expect(new Set(failures.urls)).to.deep.equal(
        new Set(["file:///tmp/foobar.txt", "about:config"]),
      );

      // Verify all URLs (valid and invalid) were imported
      const stashRoot = env.model.bookmarks.stash_root.value!;
      expect(stashRoot.children[0]!.title).to.equal("Mixed URLs");
      expect(isFolder(stashRoot.children[0]!)).to.be.true;

      const bookmarks = (stashRoot.children[0]! as Folder).children;
      expect(bookmarks.map(bm => (bm! as Bookmark).url)).to.deep.equal([
        "file:///tmp/foobar.txt",
        "http://valid.com",
        "about:config",
        "http://example.com",
      ]);
    });

    it("returns no failures if not fetching icons and titles", async () => {
      const p = TaskMonitor.run(tm =>
        importURLs({
          model: env.model,
          toFolder: undefined,
          folders: [
            {
              title: "Mixed URLs",
              children: [
                {url: "file:///tmp/foobar.txt"},
                {url: "http://valid.com"},
                {url: "about:config"},
                {url: "http://example.com"},
              ],
            },
          ],
          fetchIconsAndTitles: false,
          task: tm,
        }),
      );
      await events.nextN(browser.bookmarks.onCreated, 5);
      const failures = await p;

      expect(new Set(failures.urls)).to.deep.equal(new Set([]));
    });

    it("prepends single folders as top-level groups", async () => {
      const p = TaskMonitor.run(tm =>
        importURLs({
          model: env.model,
          toFolder: undefined,
          folders: [
            {
              title: "Top-Level Group",
              children: [
                {url: "http://example.com/1"},
                {url: "http://example.com/2"},
              ],
            },
          ],
          fetchIconsAndTitles: true,
          task: tm,
        }),
      );
      await events.nextN(browser.bookmarks.onCreated, 3);
      await waitForFetchingSiteInfo(2); // one per valid URL
      await events.nextN(browser.bookmarks.onChanged, 2); // one per valid URL
      const failures = await p;

      expect(failures.urls).to.be.empty;

      const stashRoot = env.model.bookmarks.stash_root.value!;
      expect(stashRoot.children[0]!.title).to.equal("Top-Level Group");
      expect(isFolder(stashRoot.children[0]!)).to.be.true;

      const bookmarks = (stashRoot.children[0]! as Folder).children;
      expect(bookmarks.map(bm => (bm! as Bookmark).url)).to.deep.equal([
        "http://example.com/1",
        "http://example.com/2",
      ]);
    });

    it("prepends multiple folders as top-level groups", async () => {
      const p = TaskMonitor.run(tm =>
        importURLs({
          model: env.model,
          toFolder: undefined,
          folders: [
            {
              title: "Group 1",
              children: [{url: "http://example.com/1"}],
            },
            {
              title: "Group 2",
              children: [{url: "http://example.com/2"}],
            },
          ],
          fetchIconsAndTitles: true,
          task: tm,
        }),
      );
      await events.nextN(browser.bookmarks.onCreated, 4);
      await waitForFetchingSiteInfo(2); // one per valid URL
      await events.nextN(browser.bookmarks.onChanged, 2); // one per valid URL
      const failures = await p;

      expect(failures.urls).to.be.empty;

      const stashRoot = env.model.bookmarks.stash_root.value!;
      const newChildren = stashRoot.children.slice(0, 2);
      expect(newChildren.map(c => c!.title)).to.deep.equal([
        "Group 1",
        "Group 2",
      ]);
      expect(newChildren.every(c => isFolder(c!))).to.be.true;

      const group1 = (stashRoot.children[0]! as Folder).children;
      const group2 = (stashRoot.children[1]! as Folder).children;
      expect(group1.map(bm => (bm! as Bookmark).url)).to.deep.equal([
        "http://example.com/1",
      ]);
      expect(group2.map(bm => (bm! as Bookmark).url)).to.deep.equal([
        "http://example.com/2",
      ]);
    });

    it("appends single folders to child groups", async () => {
      // Create parent folder first and wait for its event before completion
      const createFolderP = env.model.createStashFolder("Parent Folder");
      await events.next(browser.bookmarks.onCreated);
      const parentFolder = await createFolderP;

      const firstChildP = env.model.bookmarks.create({
        title: "First Child",
        url: "about:blank#first",
        parentId: parentFolder.id,
      });
      await events.next(browser.bookmarks.onCreated);
      await firstChildP;

      const p = TaskMonitor.run(tm =>
        importURLs({
          model: env.model,
          toFolder: parentFolder,
          folders: [
            {
              title: "Child Group",
              children: [
                {url: "http://example.com/1"},
                {url: "http://example.com/2"},
              ],
            },
          ],
          fetchIconsAndTitles: true,
          task: tm,
        }),
      );
      await events.nextN(browser.bookmarks.onCreated, 3);
      await waitForFetchingSiteInfo(2); // one per valid URL
      await events.nextN(browser.bookmarks.onChanged, 2); // one per valid URL
      const failures = await p;

      expect(failures.urls).to.be.empty;

      expect(parentFolder.children[0]!.title).to.equal("First Child");
      expect(isFolder(parentFolder.children[0]!)).to.be.false;
      expect(parentFolder.children[1]!.title).to.equal("Child Group");
      expect(isFolder(parentFolder.children[1]!)).to.be.true;

      const bookmarks = (parentFolder.children[1]! as Folder).children;
      expect(bookmarks.map(bm => (bm! as Bookmark).url)).to.deep.equal([
        "http://example.com/1",
        "http://example.com/2",
      ]);
    });

    it("appends multiple folders to child groups", async () => {
      // Create parent folder first and wait for its event before completion
      const createFolderP = env.model.createStashFolder("Parent Folder");
      await events.next(browser.bookmarks.onCreated);
      const parentFolder = await createFolderP;

      const firstChildP = env.model.bookmarks.create({
        title: "First Child",
        url: "about:blank#first",
        parentId: parentFolder.id,
      });
      await events.next(browser.bookmarks.onCreated);
      await firstChildP;

      const p = TaskMonitor.run(tm =>
        importURLs({
          model: env.model,
          toFolder: parentFolder,
          folders: [
            {
              title: "Child 1",
              children: [{url: "http://example.com/1"}],
            },
            {
              title: "Child 2",
              children: [{url: "http://example.com/2"}],
            },
          ],
          fetchIconsAndTitles: true,
          task: tm,
        }),
      );
      await events.nextN(browser.bookmarks.onCreated, 4);
      await waitForFetchingSiteInfo(2); // one per valid URL
      await events.nextN(browser.bookmarks.onChanged, 2); // one per valid URL
      const failures = await p;

      expect(failures.urls).to.be.empty;

      expect(parentFolder.children.map(c => c!.title)).to.deep.equal([
        "First Child",
        "Child 1",
        "Child 2",
      ]);
      expect(isFolder(parentFolder.children[0]!)).to.be.false;
      expect(parentFolder.children.slice(1, 3).every(c => isFolder(c!))).to.be
        .true;

      const child1 = (parentFolder.children[1]! as Folder).children;
      const child2 = (parentFolder.children[2]! as Folder).children;
      expect(child1.map(bm => (bm! as Bookmark).url)).to.deep.equal([
        "http://example.com/1",
      ]);
      expect(child2.map(bm => (bm! as Bookmark).url)).to.deep.equal([
        "http://example.com/2",
      ]);
    });
  });
});

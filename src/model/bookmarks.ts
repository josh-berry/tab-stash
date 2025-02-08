import {computed, reactive, ref, watchEffect, type Ref} from "vue";
import type {Bookmarks} from "webextension-polyfill";
import browser from "webextension-polyfill";

import {trace_fn} from "../util/debug.js";
import {
  backingOff,
  expect,
  filterMap,
  nonReentrant,
  shortPoll,
  tryAgain,
  urlToOpen,
  type OpenableURL,
} from "../util/index.js";
import {logErrorsFrom} from "../util/oops.js";
import {EventWiring} from "../util/wiring.js";
import {
  insertNode,
  isChildInParent,
  pathTo,
  placeNode,
  removeNode,
  type LoadedTreeParent,
  type TreeNode,
  type TreeParent,
} from "./tree.js";

/** A node in the bookmark tree. */
export interface Node extends TreeNode<Folder, Node> {
  id: NodeID;
  dateAdded?: number;
  title: string;
}

export interface Folder extends Node, TreeParent<Folder, Node> {
  $stats: FolderStats;
  $recursiveStats: FolderStats;
}

export type LoadedFolder = LoadedTreeParent<Folder, Node>;

export interface Bookmark extends Node {
  url: string;
}

export interface Separator extends Node {
  type: "separator";
}

export type NodeID = string & {readonly __node_id: unique symbol};

export type NodePosition = {parent: Folder; index: number};

export type FolderStats = {
  bookmarkCount: number;
  folderCount: number;
  isLoaded: boolean;
};

export function isBookmark(node: Node): node is Bookmark {
  return "url" in node;
}
export function isFolder(node: Node): node is Folder {
  return "children" in node;
}
export function isSeparator(node: Node): node is Separator {
  return "type" in node && node.type === "separator";
}

const trace = trace_fn("bookmarks");

/** The name of the stash root folder.  This name must match exactly (including
 * in capitalization). */
const STASH_ROOT = "Tab Stash";

const ROOT_FOLDER_HELP =
  "https://github.com/josh-berry/tab-stash/wiki/Problems-Locating-the-Tab-Stash-Bookmark-Folder";

/** A Vue model for the state of the browser bookmark tree.
 *
 * Similar to `tabs.ts`, this model follows the WebExtension conventions, with
 * some slight changes to handle hierarchy in the same manner as `tabs.ts`, and
 * ensure the state is JSON-serializable.
 */
export class Model {
  private readonly by_id = new Map<NodeID, Node>();
  private readonly by_url = new Map<OpenableURL, Set<Bookmark>>();

  /** The root node of the bookmark tree. Contains all other bookmarks, in and
   * out of the stash. (You probably want `stash_root` instead.) The bookmark
   * tree is, in general, loaded lazily; it's possible that folders with
   * unloaded elements will have `undefined` children. See the Folder and
   * LoadedFolder types for more details. */
  root: Folder | undefined = undefined;

  /** The title to look for to locate the stash root. */
  readonly stash_root_name: string;

  /** A Vue ref to the root folder for Tab Stash's saved tabs. This is updated
   * lazily as the model detects events that might cause the stash root to
   * change. An update can also be triggered by calling findStashRoot().
   *
   * Whenever `stash_root` changes, the model will load the entire sub-tree
   * under the new `stash_root` in the background.  There is generally no need
   * to trigger loading manually. */
  readonly stash_root: Ref<Folder | undefined> = ref();

  /** If set, there is more than one candidate stash root, and it's not clear
   * which one to use.  The contents of the warning are an error to show the
   * user and a function to direct them to more information. */
  readonly stash_root_warning: Ref<
    {text: string; help: () => void} | undefined
  > = ref();

  /** Tracks nodes which are candidates to be the stash root, and their parents
   * (up to the root).  Any changes to these nodes will trigger recomputation of
   * the stash root in the background. */
  private _stash_root_watch = new Set<Node>();

  /** Folders which we are in the middle of loading. */
  private readonly _loading = new Map<Folder, Promise<LoadedFolder>>();

  //
  // Loading data and wiring up events
  //

  /** Construct a model by loading bookmarks from the browser bookmark store.
   * It will listen for bookmark events to keep itself updated.
   *
   * To start, we eagerly load the root of the bookmark tree and its children
   * (e.g.  the bookmarks toolbar and menu).  We also load just enough to find
   * the stash root, but we do not eagerly load anything else (not even the
   * stash root).  A background load of the stash root is triggered
   * automatically, but likely will not finish by the time from_browser()
   * returns. */
  static async from_browser(
    stash_root_name_test_only?: string,
  ): Promise<Model> {
    /* c8 ignore next -- test-only branch is always taken */
    if (!stash_root_name_test_only) stash_root_name_test_only = STASH_ROOT;

    const model = new Model(stash_root_name_test_only);

    // Find the bookmark root and stash root. We do these together because we
    // have to fetch the bookmark root anyway as part of finding the stash root,
    // and the fewer times we can hit the browser.* APIs, the faster we load.
    await model._findRoots();

    // Make sure the stash root always stays fully-loaded.
    watchEffect(() => {
      if (!model.stash_root.value) return;
      if (model.stash_root.value.$recursiveStats.isLoaded) return;
      logErrorsFrom(() => model.loadedStash());
    });

    return model;
  }

  private constructor(stash_root_name: string) {
    this.stash_root_name = stash_root_name;

    const wiring = new EventWiring(this, {
      onFired: () => {},
      /* c8 ignore next 3 -- safety net for recovering from bugs */
      onError: () => {
        logErrorsFrom(() => this.reload());
      },
    });

    wiring.listen(browser.bookmarks.onCreated, this.whenBookmarkCreated);
    wiring.listen(browser.bookmarks.onChanged, this.whenBookmarkChanged);
    wiring.listen(browser.bookmarks.onMoved, this.whenBookmarkMoved);
    wiring.listen(browser.bookmarks.onRemoved, this.whenBookmarkRemoved);
  }

  /* c8 ignore start -- for manual debugging only */
  dumpState(): any {
    const state = (n: Node | undefined): any => {
      if (n === undefined) return null;
      return {
        id: n.id,
        title: n.title,
        parentId: n.position?.parent?.id,
        index: n.position?.index,
        ...(isBookmark(n) ? {url: n.url} : {}),
        ...(isFolder(n) ? {children: n.children.map(state)} : {}),
      };
    };
    return {
      root: this.root?.id,
      stash_root: this.stash_root.value?.id,
      bookmarks: state(this.root),
    };
  }
  /* c8 ignore stop */

  /** Reload all bookmark data we know about from the browser.  This can help in
   * crash-recovery or inconsistency situations where something has gone wrong
   * and we don't know why. */
  readonly reload = backingOff(async () => {
    // Reload data on individual bookmarks. We also prune any "dead" bookmarks
    // that were deleted while we weren't looking. We do NOT prune anything
    // that's still known to exist, because that would make them potentially
    // non-reactive and leave the UI in a stale state.
    for (const node of this.by_id.values()) {
      let btn: Bookmarks.BookmarkTreeNode[];

      // We get each bookmark individually so we know which ones still exist.
      try {
        btn = await browser.bookmarks.get(node.id);
      } catch (e) {
        btn = [];
      }

      if (btn.length === 1) {
        this._updateNode(node, btn[0]);
      } else {
        this.whenBookmarkRemoved(node.id);
      }
    }

    // Reload hierarchy information for each folder (including the root).
    for (const node of this.by_id.values()) {
      if (!isFolder(node)) continue;
      node.isLoaded = false;
      await this.loaded(node);
    }
  });

  //
  // Accessors
  //

  /** Retrieves the node with the specified ID (if it exists). */
  node(id: string): Node | undefined {
    return this.by_id.get(id as NodeID);
  }

  /** Retrieves the bookmark with the specified ID.  Returns `undefined` if it
   * does not exist or is not a bookmark. */
  bookmark(id: string): Bookmark | undefined {
    const node = this.node(id);
    if (node && isBookmark(node)) return node;
    return undefined;
  }

  /** Retrieves the folder with the specified ID.  Returns `undefined` if it
   * does not exist or is not a folder. Note that the folder may not be
   * fully-loaded (that is, not all its children may be available). If you want
   * a LoadedFolder, combine this with `loaded()`. */
  folder(id: string): Folder | undefined {
    const node = this.node(id);
    if (node && isFolder(node)) return node;
    return undefined;
  }

  /** Ensures the passed-in folder is fully-loaded, and returns it. Note that
   * this is NOT recursive, that is, child folders may still not be
   * fully-loaded. */
  loaded(folder: Folder): Promise<LoadedFolder> {
    if (folder.isLoaded) return Promise.resolve(folder as LoadedFolder);

    return this._run_loader(folder, async () => {
      const children = await browser.bookmarks.getChildren(folder.id);
      fixupIndexes(children);
      for (const c of children) this._upsertNode(c);

      folder.isLoaded = true;
      return folder as LoadedFolder;
    });
  }

  /** Ensures the entire subtree underneath _folder_ is fully-loaded. */
  loadedSubtree(folder: Folder): Promise<LoadedFolder> {
    if (folder.$recursiveStats.isLoaded) {
      return Promise.resolve(folder as LoadedFolder);
    }

    // General case -- if the folder is already partially loaded, recursively
    // try to load its descendants.
    if (folder.children.length > 0) {
      return (async () => {
        const lf = await this.loaded(folder);
        for (const f of lf.children) {
          if (isFolder(f)) await this.loadedSubtree(f);
        }
        return lf;
      })();
    }

    // Performance optimization -- if this folder has no children at all, fetch
    // the whole subtree at once, but load it into the model asynchronously.
    // However, we still need to yield back to the event loop periodically.
    // This maintains responsiveness while still providing higher throughput
    // than using browser.bookmarks.getChildren() recursively.

    let start = Date.now();

    return this._run_loader(folder, async () => {
      // Performance optimization: fetch the whole subtree at once, but load it
      // into the model asynchronously.
      const f = await browser.bookmarks.getSubTree(folder.id);

      const upsertAsync = async (
        parent: Folder,
        children: Bookmarks.BookmarkTreeNode[],
      ) => {
        const child_ps = [];

        if (Date.now() - start >= 25) {
          // Yield so UI events can be processed
          await new Promise(r => setTimeout(r));
          start = Date.now();
        }

        // This is written to avoid yielding inside the loop, so that both the
        // child node and its loading state appear at the same time. Otherwise
        // we might allow for multiple loaders for the same child to run.
        // Worse, the other loader might be non-recursive, so loadedSubtree()
        // wouldn't actually perform as expected.
        fixupIndexes(children);
        for (const n of children) {
          const f = this._upsertNode(n) as Folder;
          const c = n.children;
          if (!c) continue;
          child_ps.push(this._run_loader(f, () => upsertAsync(f, c)));
        }
        parent.isLoaded = true;
        await Promise.all(child_ps);
        return parent as LoadedFolder;
      };

      if (f[0].children) await upsertAsync(folder, f[0].children);
      return folder as LoadedFolder;
    });
  }

  /** Ensures the entire stash is loaded, if it exists, and returns the root of
   * the stash. */
  async loadedStash(): Promise<LoadedFolder | undefined> {
    if (!this.stash_root.value) return;
    await this.loaded(this.stash_root.value);
    return await this.loadedSubtree(this.stash_root.value);
  }

  private _run_loader(
    folder: Folder,
    loader: () => Promise<LoadedFolder>,
  ): Promise<LoadedFolder> {
    let p = this._loading.get(folder);
    if (p) return p;

    trace("loading", folder.id);
    p = loader();
    this._loading.set(folder, p);
    return p.finally(() => {
      this._loading.delete(folder);
    });
  }

  /** Returns a (reactive) set of bookmarks with the specified URL that are
   * currently loaded in the model. */
  loadedBookmarksWithURL(url: string): Set<Bookmark> {
    let index = this.by_url.get(urlToOpen(url));
    if (!index) {
      index = reactive(new Set<Bookmark>());
      this.by_url.set(urlToOpen(url), index);
    }
    return index;
  }

  /** Check if `node` is contained, directly or indirectly, by the stash root.
   * If there is no stash root, always returns `false`. */
  isNodeInStashRoot(node: Node): boolean {
    /* c8 ignore next -- we always have a root in tests */
    if (!this.stash_root.value) return false;
    return isChildInParent(node, this.stash_root.value);
  }

  /** Returns true if a particular URL is present in the stash in a bookmark
   * that is currently loaded in the model. */
  isURLLoadedInStash(url: string): boolean {
    const stash_root = this.stash_root.value;
    /* c8 ignore next -- uncommon and hard to test */
    if (!stash_root) return false;

    for (const bm of this.loadedBookmarksWithURL(url)) {
      if (this.isNodeInStashRoot(bm)) return true;
    }
    return false;
  }

  /** Given a URL, find and return all the currently-loaded folders under the
   * stash root which contain bookmarks with that URL.  (This is used by the UI
   * to show "Stashed in ..." tooltips on tabs.) */
  loadedFoldersInStashWithURL(url: string): Folder[] {
    const stash_root = this.stash_root.value;
    /* c8 ignore next -- uncommon and hard to test */
    if (!stash_root) return [];

    const ret: Folder[] = [];
    for (const bm of this.loadedBookmarksWithURL(url)) {
      const parent = bm.position?.parent;
      /* c8 ignore next -- bookmarks should never be roots */
      if (!parent) continue;
      if (!isChildInParent(parent as Node, stash_root)) continue;
      ret.push(parent);
    }
    return ret;
  }

  /** Return all the URLs present in the stash root. */
  async urlsInStash(): Promise<Set<string>> {
    const urls = new Set<string>();

    const urlsInChildren = (folder: Folder) => {
      for (const c of folder.children) {
        /* c8 ignore next 3 -- bug-checking */
        if (!c) {
          throw new Error(`BUG: Some children are missing from ${folder.id}`);
        }
        if (isBookmark(c)) urls.add(c.url);
        else if (isFolder(c)) urlsInChildren(c);
      }
    };

    const stash = await this.loadedStash();
    if (stash) urlsInChildren(stash);

    return urls;
  }

  //
  // Mutators
  //

  /** Creates a bookmark and waits for the model to reflect the creation.
   * Returns the bookmark node in the model. */
  async create(bm: browser.Bookmarks.CreateDetails): Promise<Node> {
    const ret = await browser.bookmarks.create(bm);
    return await shortPoll(() => {
      const bm = this.by_id.get(ret.id as NodeID);
      if (!bm) tryAgain();
      return bm;
    });
  }

  /** Updates a bookmark's title and waits for the model to reflect the
   * update. */
  async rename(bm: Bookmark | Folder, title: string): Promise<void> {
    await browser.bookmarks.update(bm.id, {title});
    await shortPoll(() => {
      if (bm.title !== title) tryAgain();
    });
  }

  /** Deletes a bookmark and waits for the model to reflect the deletion.
   *
   * If the node is part of the stash and belongs to an unnamed folder which
   * is now empty, cleanup that folder as well.
   */
  async remove(node: Node): Promise<void> {
    const pos = node.position;

    await browser.bookmarks.remove(node.id);

    // Wait for the model to catch up
    await shortPoll(() => {
      // Wait for the model to catch up
      if (this.by_id.has(node.id)) tryAgain();
    });

    if (pos) await this.maybeCleanupEmptyFolder(pos.parent);
  }

  /** Deletes an entire tree of bookmarks and waits for the model to reflect
   * the deletion. */
  async removeTree(node: Node): Promise<void> {
    await browser.bookmarks.removeTree(node.id);

    // Wait for the model to catch up
    await shortPoll(() => {
      // Wait for the model to catch up
      if (this.by_id.has(node.id)) tryAgain();
    });
  }

  /** Moves a bookmark such that it precedes the item with index `toIndex` in
   * the destination folder.  (You can pass an index `>=` the length of the
   * bookmark folder's children to move the item to the end of the folder.)
   *
   * Use this instead of `browser.bookmarks.move()`, which behaves differently
   * in Chrome and Firefox... */
  async move(node: Node, toParent: Folder, toIndex: number): Promise<void> {
    // Firefox's `index` parameter behaves like the bookmark is first
    // removed, then re-added.  Chrome's/Edge's behaves like the bookmark is
    // first added, then removed from its old location, so the index of the
    // item after the move will sometimes be toIndex-1 instead of toIndex;
    // we account for this below.
    const position = expect(
      node.position,
      () => `Unable to locate node ${node.id} in its parent`,
    );

    // Clamp the destination index based on the model length, or the poll
    // below won't see the index it's expecting.  (This isn't 100%
    // reliable--we might still get an exception if multiple concurrent
    // moves are going on, but even Firefox itself has bugs in this
    // situation, soooo... *shrug*)
    toIndex = Math.min(toParent.children.length, Math.max(0, toIndex));

    /* c8 ignore next -- platform-specific check */
    if (!!browser.runtime.getBrowserInfo) {
      // We're using Firefox
      if (position.parent === toParent) {
        if (toIndex > position.index) toIndex--;
      }
    }
    const oldParent = node.position?.parent;
    const oldIndex = node.position?.index;
    await browser.bookmarks.move(node.id, {
      parentId: toParent.id,
      index: toIndex,
    });
    await shortPoll(() => {
      const pos = node.position;
      /* c8 ignore next -- race avoidance */
      if (!pos) tryAgain();

      // We assume the bookmark move has happened even if the bookmark did not
      // move to where we expect.  This is because the Firefox bookmark DB might
      // have incorrect indexes in it, so the bookmark might not move to the
      // position we expect even if no other concurrent moves are happening.
      // There is unfortunately little we can do about this, so we ignore it.
      if (pos.parent !== oldParent || pos.index !== oldIndex) return;

      // It's possible the old and new parents/indexes are the same. If so, the
      // bookmark will have "moved", but the check above will still fail.
      if (pos.parent === toParent && pos.index === toIndex) return;

      tryAgain();
    });

    await this.maybeCleanupEmptyFolder(position.parent);
  }

  /** Find and return the stash root, or create one if it doesn't exist. */
  async ensureStashRoot(): Promise<Folder> {
    if (this.stash_root.value) return this.stash_root.value;

    trace("creating new stash root");

    // NOTE: We don't use this.create() here because it's possible the
    // newly-created stash root will never be loaded into the model, if its
    // parent isn't present.  The subsequent call(s) to _findRoots() should take
    // care of this for us.
    await browser.bookmarks.create({title: this.stash_root_name});

    // GROSS HACK to avoid creating duplicate roots follows.
    //
    // We sample at irregular intervals for a bit to see if any other models
    // are trying to create the stash root at the same time we are. If so,
    // this sampling gives us a higher chance to observe each other.  But if
    // we consistently see a single candidate over time, we can assume we're
    // the only one running right now.
    const start = Date.now();
    let delay = 20;

    let candidates = await this._findRoots();
    while (Date.now() - start < delay) {
      if (candidates.length > 1) {
        trace(
          "race detected; winner = ",
          candidates[0].id,
          "loser = ",
          candidates[1].id,
        );
        // If we find MULTIPLE candidates so soon after finding NONE,
        // there must be multiple threads trying to create the root
        // folder.  Let's try to remove one.  We are guaranteed that all
        // threads see the same ordering of candidate folders (and thus
        // will all choose the same folder to save) because the
        // candidate list is sorted deterministically.
        await this.remove(candidates[1]).catch(() => {});
        delay += 10;
      }
      await new Promise(r => setTimeout(r, 5 * Math.random()));
      candidates = await this._findRoots();
    }
    // END GROSS HACK

    trace("converged on stash root = ", candidates[0].id);
    return candidates[0];
  }

  /** Removes the folder if it is empty, unnamed and within the stash root. */
  private async maybeCleanupEmptyFolder(folder: Folder) {
    // Folder does not have a default/unnamed-shape name
    if (getDefaultFolderNameISODate(folder.title) === null) return;
    if (folder.children.length > 0) return;
    if (!this.stash_root.value) return;
    if (!isChildInParent(folder as Node, this.stash_root.value)) return;

    // NOTE: This will never be recursive because remove() only calls us if
    // we're removing a leaf node, which we are never doing here.
    //
    // ALSO NOTE: If the folder is suddenly NOT empty due to a race, stale
    // model, etc., this will fail, because the browser itself will throw.
    await this.remove(folder);
  }

  //
  // Events which are detected automatically by this model; these can be
  // called for testing purposes but otherwise you can ignore them.
  //
  // (In contrast to onFoo-style things, they are event listeners, not event
  // senders.)
  //

  whenBookmarkCreated(id: string, new_bm: Bookmarks.BookmarkTreeNode) {
    trace("whenBookmarkCreated", new_bm);

    /* c8 ignore start -- conformance to interface / bug-checking */
    if (id !== new_bm.id) throw new Error(`Bookmark IDs don't match`);
    /* c8 ignore stop */

    this._upsertNode(new_bm, "shift-if-new");
  }

  whenBookmarkChanged(id: string, info: Bookmarks.OnChangedChangeInfoType) {
    trace("whenBookmarkChanged", id, info);
    const node = this.node(id as NodeID);

    if (!node) {
      // If we see a node is being renamed to a name that matches the stash
      // root, we should check if it's becoming the new stash root.
      if (info.title === this.stash_root_name) this._maybeUpdateStashRoot();
      return;
    }

    this._updateNode(node, info);
  }

  whenBookmarkMoved(id: string, info: {parentId: string; index: number}) {
    trace("whenBookmarkMoved", id, info);

    const node = this.node(id as NodeID);
    const parent = this.folder(info.parentId);

    if (node) {
      // If we don't know about the node's old parent, `node.position` will be
      // undefined. If we don't know about the node's new parent, `parent` will
      // be undefined.
      if (node.position) removeNode(node.position);
      if (parent) insertNode(node, {parent, index: info.index});

      if (this._stash_root_watch.has(node)) this._maybeUpdateStashRoot();
    } else if (parent) {
      // An unloaded node was just moved into a loaded parent; make room for it
      // in the parent and note that the parent is no longer loaded.
      insertNode(undefined, {parent, index: info.index});
      parent.isLoaded = false;
    }
  }

  whenBookmarkRemoved(id: string) {
    trace("whenBookmarkRemoved", id);

    const node = this.by_id.get(id as NodeID);
    if (!node) return;

    // We must remove children before their parents, so that we never have a
    // child referencing a parent that doesn't exist.
    if (isFolder(node)) {
      // Array.from() is needed here, because the removal process itself will
      // alter `node.children`.
      for (const c of Array.from(node.children)) {
        if (c) this.whenBookmarkRemoved(c.id);
      }
    }

    if (node.position) removeNode(node.position);

    this.by_id.delete(node.id);
    if (isBookmark(node)) this._remove_url(node);

    if (this._stash_root_watch.has(node)) {
      // We must explicitly remove `node` here because its title is
      // still "Tab Stash" even after it is deleted.
      this._stash_root_watch.delete(node);
      this._maybeUpdateStashRoot();
    }
  }

  /** Updates the stash root, if appropriate. */
  private readonly _maybeUpdateStashRoot = nonReentrant(async () => {
    await this._findRoots();
  });

  /** Finds the bookmark root and stash root, updates `this.root` and
   * `this.stash_root`, and returns a sorted list of candidate folders that
   * could have been used for the stash root.
   *
   * A folder is used for the stash root if it has the right name, and is the
   * closest folder to the root with that name. Ties are broken in favor of the
   * oldest folder, or folders are the same age, the folder with the lowest ID.
   *
   * This function is quite expensive, since it calls out to the browser
   * multiple times, so it should be used quite sparingly.  Unless you need the
   * candidates for some reason, you probably want `_maybeUpdateStashRoot()`
   * instead. */
  private async _findRoots(): Promise<Folder[]> {
    // Find all the candidate folders that have the right name.
    const searched = (
      await browser.bookmarks.search(this.stash_root_name)
    ).filter(c => isBrowserBTNFolder(c) && c.title === this.stash_root_name);

    trace("_findRoots", searched.length, "folders named", this.stash_root_name);

    // Make sure those folders and their parents (recursively) are loaded into
    // the model. This is so we can keep an eye on changes and re-trigger the
    // stash-root search if anything changes.
    let to_fetch = new Set(searched.map(c => c.parentId!));
    let to_upsert = Array.from(searched);

    while (to_fetch.size > 0) {
      trace("_findRoots fetching", to_fetch);
      const bms = await browser.bookmarks.get(Array.from(to_fetch));

      to_fetch = new Set();
      for (const b of bms) {
        if (b.parentId !== undefined) to_fetch.add(b.parentId);
        to_upsert.push(b);
      }
    }

    this._stash_root_watch = new Set();
    to_upsert.reverse();
    for (const b of to_upsert) {
      const node = this._upsertNode(b);
      if (b.parentId === undefined) this.root = node as Folder;
      this._stash_root_watch.add(node);
    }

    // Now we rank each candidate node.

    let candidates = filterMap(searched, s => this.folder(s.id));
    const paths = filterMap(candidates, c => ({
      folder: c,
      path: pathTo<Folder, Node>(c),
    }));

    // Find the depth of the candidate closest to the root.
    const depth = Math.min(...paths.map(p => p.path.length));

    // Filter out candidates that are deeper than the minimum depth, and
    // sort the remainder in a stable fashion according to their creation
    // date and ID.
    candidates = paths
      .filter(p => p.path.length <= depth)
      .map(p => p.folder)
      .sort((a, b) => {
        const byDate = (a.dateAdded ?? 0) - (b.dateAdded ?? 0);
        if (byDate !== 0) return byDate;
        if (a.id < b.id) return -1;
        if (a.id > b.id) return 1;
        return 0;
      });

    // The actual stash root is the first candidate.  The if-statement ensures
    // we only update the stash root if it's actually changed, since updating it
    // can be quite expensive (it will effectively redraw the whole UI).
    if (candidates.length > 0) {
      if (this.stash_root.value !== candidates[0]) {
        this.stash_root.value = candidates[0];
        trace("_findRoots", "set stash_root to", candidates[0].id);
      }
    } else if (this.stash_root.value !== undefined) {
      trace("_findRoots", "cleared stash_root");
      this.stash_root.value = undefined;
    }

    // But if we have multiple candidates, we need to raise the alarm that
    // there is an ambiguity the user should resolve.
    if (candidates.length > 1) {
      trace("_findRoots", "found multiple stash_root candidates");
      this.stash_root_warning.value = {
        text:
          `You have multiple "${this.stash_root_name}" bookmark ` +
          `folders, and Tab Stash isn't sure which one to use.  ` +
          `Click here to find out how to resolve the issue.`,
        /* istanbul ignore next */
        help: () => browser.tabs.create({active: true, url: ROOT_FOLDER_HELP}),
      };
    } else if (this.stash_root_warning.value !== undefined) {
      trace("_findRoots", "found single stash_root candidate");
      this.stash_root_warning.value = undefined;
    }

    // We return the candidate list here so that callers can see what
    // candidates are available (since there may be ways of resolving
    // conflicts we can't do here).
    return candidates;
  }

  /** Update or create a model node, populating it with information from the
   * browser. The model node is returned. */
  private _upsertNode(
    btn: Bookmarks.BookmarkTreeNode,
    shiftIfNew?: "shift-if-new",
  ): Node {
    const nodeId = btn.id as NodeID;

    let node = this.by_id.get(nodeId);
    const parent = btn.parentId !== undefined && this.folder(btn.parentId);

    trace("_upsertNode", nodeId, btn.parentId, btn.index, btn.title);

    // Make sure the node exists.
    if (!node) {
      if (isBrowserBTNFolder(btn)) {
        node = makeFolder(btn.id as NodeID);
      } else if (btn.type === "separator") {
        node = makeSeparator(btn.id as NodeID);
      } else {
        node = makeBookmark(btn.id as NodeID);
      }
      node.dateAdded = btn.dateAdded;
      this.by_id.set(nodeId, node);
    }

    // Place the node in the right location in its parent. If we know this is a
    // net-new node creation, rather than simply filling in a hole in the model,
    // we will shift sibling nodes in the parent accordingly.
    if (parent && btn.index !== undefined) {
      const pos = {parent, index: btn.index!};
      if (
        parent !== node.position?.parent ||
        pos.index !== node.position?.index
      ) {
        if (node.position) {
          removeNode(node.position);
          insertNode(node, pos);
        } else {
          (shiftIfNew ? insertNode : placeNode)(node, pos);
        }
      }
    }

    // Fill in the node details, update the URL index, and check if this node
    // might be a stash root.
    this._updateNode(node, btn);

    return node;
  }

  /** Update an existing node with new information from the browser. */
  private _updateNode(node: Node, btn: Bookmarks.OnChangedChangeInfoType) {
    const titleChanged = btn.title !== undefined && node.title !== btn.title;
    const urlChanged =
      btn.url !== undefined && isBookmark(node) && node.url !== btn.url;

    trace("_updateNode", node.id, btn.url, urlChanged, btn.title, titleChanged);

    if (titleChanged) node.title = btn.title;

    if (urlChanged) {
      this._remove_url(node);
      node.url = btn.url!;
      this._add_url(node);
    }

    if (isFolder(node)) {
      // Finally, see if this folder is a candidate for being a stash root.
      if (node.title === this.stash_root_name) this._stash_root_watch.add(node);

      // We have to explicitly check for title/parent changes, because
      // _maybeUpdateStashRoot() will call out to the browser to search for
      // candidate stash roots, and upsert those stash roots into the model,
      // thus landing us right back here in a potentially-infinite loop.
      if (titleChanged && this._stash_root_watch.has(node)) {
        trace("_updateNode", "triggering stash root check");
        this._maybeUpdateStashRoot();
      }
    }
  }

  private _add_url(bm: Bookmark) {
    if (!bm.url) return;
    this.loadedBookmarksWithURL(bm.url).add(bm);
  }

  private _remove_url(bm: Bookmark) {
    if (!bm.url) return;
    const index = this.by_url.get(urlToOpen(bm.url));
    /* c8 ignore next -- internal consistency */
    if (!index) return;
    index.delete(bm);
  }
}

//
// Public helper functions for dealing with folders under the stash root
//

/** Given a folder name, check if it's an "default"-shaped folder name (i.e.
 * just a timestamp) and return the timestamp portion of the name if so. */
export function getDefaultFolderNameISODate(n: string): string | null {
  let m = n.match(/saved-([-0-9:.T]+Z)/);
  return m ? m[1] : null;
}

/** Generate a "default"-shaped folder name from a timestamp (usually the
 * timestamp of its creation). */
export function genDefaultFolderName(date: Date): string {
  return `saved-${date.toISOString()}`;
}

/** Given a folder name as it appears in the bookmarks tree, return a "friendly"
 * version to show to the user.  This translates folder names that look like a
 * "default"-shaped folder name into a user-friendly string, if applicable. */
export function friendlyFolderName(name: string): string {
  const folderDate = getDefaultFolderNameISODate(name);
  if (folderDate) return `Saved ${new Date(folderDate).toLocaleString()}`;
  return name;
}

//
// Helper functions for the model
//

function makeFolder(nodeId: NodeID): Folder {
  const folder: Folder = reactive({
    id: nodeId,
    position: undefined,
    dateAdded: 0,
    title: "",
    isLoaded: false,
    children: [],

    $stats: computed(() => {
      let bookmarkCount = 0;
      let folderCount = 0;
      for (const c of folder.children) {
        if (!c) continue;
        if (isFolder(c)) ++folderCount;
        if (isBookmark(c)) ++bookmarkCount;
      }
      return {bookmarkCount, folderCount, isLoaded: folder.isLoaded};
    }),

    $recursiveStats: computed(() => {
      let bookmarkCount = folder.$stats.bookmarkCount;
      let folderCount = folder.$stats.folderCount;
      let isLoaded = folder.isLoaded;
      for (const c of folder.children) {
        if (!c || !isFolder(c)) continue;
        const stats = c.$recursiveStats;
        bookmarkCount += stats.bookmarkCount;
        folderCount += stats.folderCount;
        isLoaded &&= stats.isLoaded;
      }
      return {bookmarkCount, folderCount, isLoaded};
    }),
  });

  return folder;
}

function makeSeparator(nodeId: NodeID): Separator {
  return reactive({
    id: nodeId,
    position: undefined,
    dateAdded: 0,
    type: "separator" as "separator",
    title: "" as "",
  });
}

function makeBookmark(nodeId: NodeID): Bookmark {
  return reactive({
    id: nodeId,
    position: undefined,
    dateAdded: 0,
    title: "",
    url: "",
  });
}

/** A cross-browser compatible way to tell if a bookmark returned by the
 * `browser.bookmarks` API is a folder or not. */
function isBrowserBTNFolder(bm: Bookmarks.BookmarkTreeNode): boolean {
  if (bm.type === "folder") return true; // for Firefox
  if (bm.children) return true; // for Chrome (sometimes)
  if (!("type" in bm) && !("url" in bm)) return true; // for Chrome
  return false;
}

/** Firefox sometimes returns a list of bookmark children that have negative
 * indexes, indexes with gaps, or duplicate indexes. We try to normalize these
 * here so the rest of Tab Stash doesn't complain. See:
 * https://github.com/josh-berry/tab-stash/issues/542 */
function fixupIndexes(nodes: Bookmarks.BookmarkTreeNode[]): void {
  for (let i = 0; i < nodes.length; ++i) nodes[i].index = i;
}

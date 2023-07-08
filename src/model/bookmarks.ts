import {computed, reactive, ref, type Ref} from "vue";
import type {Bookmarks} from "webextension-polyfill";
import browser from "webextension-polyfill";

import {
  backingOff,
  expect,
  filterMap,
  shortPoll,
  tryAgain,
  urlToOpen,
  type OpenableURL,
} from "../util";
import {trace_fn} from "../util/debug";
import {logErrorsFrom} from "../util/oops";
import {EventWiring} from "../util/wiring";
import {
  isChildInParent,
  pathTo,
  setPosition,
  type TreeNode,
  type TreeParent,
} from "./tree";

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

  /** The ID of the root node (set only once the model is loaded). */
  root_id: NodeID | undefined;

  /** The title to look for to locate the stash root. */
  readonly stash_root_name: string;

  /** A Vue ref to the root folder for Tab Stash's saved tabs. */
  readonly stash_root: Ref<Folder | undefined> = ref();

  /** If set, there is more than one candidate stash root, and it's not clear
   * which one to use.  The contents of the warning are an error to show the
   * user and a function to direct them to more information. */
  readonly stash_root_warning: Ref<
    {text: string; help: () => void} | undefined
  > = ref();

  /** Tracks folders which are candidates to be the stash root, and their
   * parents (up to the root).  Any changes to these folders should recompute
   * the stash root. */
  private _stash_root_watch = new Set<Folder>();

  /** Are we in the middle of a reload? */
  private _is_reloading = false;

  /** Did we receive an event since the last (re)load of the model? */
  private _event_since_load: boolean = false;

  //
  // Loading data and wiring up events
  //

  /** Construct a model by loading bookmarks from the browser bookmark store.
   * It will listen for bookmark events to keep itself updated. */
  static async from_browser(
    stash_root_name_test_only?: string,
  ): Promise<Model> {
    // istanbul ignore if
    if (!stash_root_name_test_only) stash_root_name_test_only = STASH_ROOT;

    const model = new Model(stash_root_name_test_only);
    await model.reload();
    return model;
  }

  private constructor(stash_root_name: string) {
    this.stash_root_name = stash_root_name;

    const wiring = new EventWiring(this, {
      onFired: () => {
        this._event_since_load = true;
      },
      // istanbul ignore next -- safety net; reload the model in the event
      // of an unexpected exception.
      onError: () => {
        logErrorsFrom(() => this.reload());
      },
    });

    wiring.listen(browser.bookmarks.onCreated, this.whenBookmarkCreated);
    wiring.listen(browser.bookmarks.onChanged, this.whenBookmarkChanged);
    wiring.listen(browser.bookmarks.onMoved, this.whenBookmarkMoved);
    wiring.listen(browser.bookmarks.onRemoved, this.whenBookmarkRemoved);
  }

  dumpState(): any {
    return {
      root: this.root_id,
      stash_root: this.stash_root.value?.id,
      bookmarks: JSON.parse(JSON.stringify(Object.fromEntries(this.by_id))),
    };
  }

  /** Fetch bookmarks from the browser again and update the model's
   * understanding of the world with the browser's data.  Use this if it looks
   * like the model has gotten out of sync with the browser (e.g. for crash
   * recovery). */
  readonly reload = backingOff(async () => {
    function mark(marked: Set<string>, root: Bookmarks.BookmarkTreeNode) {
      marked.add(root.id);
      if (root.children) for (const c of root.children) mark(marked, c);
    }

    // We loop until we can complete a reload without receiving any
    // concurrent events from the browser--if we get a concurrent event, we
    // need to try loading again, since we don't know how the event was
    // ordered with respect to the getTree().
    this._is_reloading = true;
    try {
      this._event_since_load = true;
      while (this._event_since_load) {
        this._event_since_load = false;

        const tree = await browser.bookmarks.getTree();
        const root = tree[0]!;
        this.root_id = root.id as NodeID;
        this.whenBookmarkCreated(root.id, root);

        // Clean up bookmarks that don't exist anymore
        const marked = new Set<string>();
        mark(marked, root);
        for (const id of this.by_id.keys()) {
          if (!marked.has(id)) this.whenBookmarkRemoved(id);
        }
      }
    } finally {
      this._is_reloading = false;
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

  /** Retrieves the folder with the specified ID.  Returns `undefined` if it does not exist or is not a folder. */
  folder(id: string): Folder | undefined {
    const node = this.node(id);
    if (node && isFolder(node)) return node;
    return undefined;
  }

  /** Returns a (reactive) set of bookmarks with the specified URL. */
  bookmarksWithURL(url: string): Set<Bookmark> {
    let index = this.by_url.get(urlToOpen(url));
    if (!index) {
      index = reactive(new Set<Bookmark>());
      this.by_url.set(urlToOpen(url), index);
    }
    return index;
  }

  isParent(node: Node): node is Folder {
    return isFolder(node);
  }

  /** Check if `node` is contained, directly or indirectly, by the stash root.
   * If there is no stash root, always returns `false`. */
  isNodeInStashRoot(node: Node): boolean {
    // istanbul ignore if -- we always have a root in tests
    if (!this.stash_root.value) return false;
    return isChildInParent(node, this.stash_root.value);
  }

  /** Returns true if a particular URL is present in the stash. */
  isURLStashed(url: string): boolean {
    const stash_root = this.stash_root.value;
    // istanbul ignore if -- uncommon and hard to test
    if (!stash_root) return false;

    for (const bm of this.bookmarksWithURL(url)) {
      if (this.isNodeInStashRoot(bm)) return true;
    }
    return false;
  }

  /** Given a URL, find and return all the folders under the stash root which
   * contain bookmarks with that URL.  (This is used by the UI to show "Stashed
   * in ..." tooltips on tabs.) */
  foldersInStashContainingURL(url: string): Folder[] {
    const stash_root = this.stash_root.value;
    // istanbul ignore if -- uncommon and hard to test
    if (!stash_root) return [];

    const ret: Folder[] = [];
    for (const bm of this.bookmarksWithURL(url)) {
      const parent = bm.position?.parent;
      // istanbul ignore next -- should never happen in practice; it's not
      // possible to place bookmarks directly under the root folder
      if (!parent) continue;
      if (!isChildInParent(parent as Node, stash_root)) continue;
      ret.push(parent);
    }
    return ret;
  }

  /** Return all the URLs present in the stash root. */
  urlsInStash(): Set<string> {
    const urls = new Set<string>();

    const urlsInChildren = (folder: Folder) => {
      for (const c of folder.children) {
        if (isBookmark(c)) urls.add(c.url);
        else if (isFolder(c)) urlsInChildren(c);
      }
    };

    if (this.stash_root.value) urlsInChildren(this.stash_root.value);

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
  async remove(id: NodeID): Promise<void> {
    const node = this.node(id);
    if (!node) return;

    const pos = node.position;

    await browser.bookmarks.remove(id);

    // Wait for the model to catch up
    await shortPoll(() => {
      // Wait for the model to catch up
      if (this.by_id.has(id)) tryAgain();
    });

    if (pos) await this.maybeCleanupEmptyFolder(pos.parent);
  }

  /** Deletes an entire tree of bookmarks and waits for the model to reflect
   * the deletion. */
  async removeTree(id: NodeID): Promise<void> {
    await browser.bookmarks.removeTree(id);

    // Wait for the model to catch up
    await shortPoll(() => {
      // Wait for the model to catch up
      if (this.by_id.has(id)) tryAgain();
    });
  }

  /** Moves a bookmark such that it precedes the item with index `toIndex` in
   * the destination folder.  (You can pass an index `>=` the length of the
   * bookmark folder's children to move the item to the end of the folder.)
   *
   * Use this instead of `browser.bookmarks.move()`, which behaves differently
   * in Chrome and Firefox... */
  async move(id: NodeID, toParent: NodeID, toIndex: number): Promise<void> {
    // Firefox's `index` parameter behaves like the bookmark is first
    // removed, then re-added.  Chrome's/Edge's behaves like the bookmark is
    // first added, then removed from its old location, so the index of the
    // item after the move will sometimes be toIndex-1 instead of toIndex;
    // we account for this below.
    const node = expect(this.node(id), () => `No such bookmark node: ${id}`);
    const position = expect(
      node.position,
      () => `Unable to locate node ${id} in its parent`,
    );

    // Clamp the destination index based on the model length, or the poll
    // below won't see the index it's expecting.  (This isn't 100%
    // reliable--we might still get an exception if multiple concurrent
    // moves are going on, but even Firefox itself has bugs in this
    // situation, soooo... *shrug*)
    const toParentFolder = expect(
      this.folder(toParent),
      () => `Unable to locate destination folder: ${toParent}`,
    );
    toIndex = Math.min(toParentFolder.children.length, Math.max(0, toIndex));

    // istanbul ignore else
    if (!!browser.runtime.getBrowserInfo) {
      // We're using Firefox
      if (position.parent.id === toParent) {
        if (toIndex > position.index) toIndex--;
      }
    }
    await browser.bookmarks.move(id, {parentId: toParent, index: toIndex});
    await shortPoll(() => {
      const pos = node.position;
      if (!pos) tryAgain();
      if (pos.parent.id !== toParent || pos.index !== toIndex) tryAgain();
    });

    await this.maybeCleanupEmptyFolder(position.parent);
  }

  /** Find and return the stash root, or create one if it doesn't exist. */
  async ensureStashRoot(): Promise<Folder> {
    if (this.stash_root.value) return this.stash_root.value;

    await this.create({title: this.stash_root_name});

    // GROSS HACK to avoid creating duplicate roots follows.
    //
    // We sample at irregular intervals for a bit to see if any other models
    // are trying to create the stash root at the same time we are. If so,
    // this sampling gives us a higher chance to observe each other.  But if
    // we consistently see a single candidate over time, we can assume we're
    // the only one running right now.
    const start = Date.now();
    let delay = 10;

    let candidates = this._maybeUpdateStashRoot();
    while (Date.now() - start < delay) {
      if (candidates.length > 1) {
        // If we find MULTIPLE candidates so soon after finding NONE,
        // there must be multiple threads trying to create the root
        // folder.  Let's try to remove one.  We are guaranteed that all
        // threads see the same ordering of candidate folders (and thus
        // will all choose the same folder to save) because the
        // candidate list is sorted deterministically.
        await this.remove(candidates[1].id).catch(() => {});
        delay += 10;
      }
      await new Promise(r => setTimeout(r, 5 * Math.random()));
      candidates = this._maybeUpdateStashRoot();
    }
    // END GROSS HACK

    return candidates[0];
  }

  /** Create a new folder at the top of the stash root (creating the stash
   * root itself if it does not exist).  If the name is not specified, a
   * default name will be assigned based on the folder's creation time. */
  async createStashFolder(
    name?: string,
    parent?: NodeID,
    position?: "top" | "bottom",
  ): Promise<Folder> {
    const stash_root = await this.ensureStashRoot();
    parent ??= stash_root.id;
    position ??= "top";

    const bm = await this.create({
      parentId: parent,
      title: name ?? genDefaultFolderName(new Date()),
      // !-cast: this.create() will check the existence of the parent for us
      index: position === "top" ? 0 : this.folder(parent)!.children.length,
    });
    return bm as Folder;
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
    await this.remove(folder.id);
  }

  //
  // Events which are detected automatically by this model; these can be
  // called for testing purposes but otherwise you can ignore them.
  //
  // (In contrast to onFoo-style things, they are event listeners, not event
  // senders.)
  //

  whenBookmarkCreated(id: string, new_bm: Bookmarks.BookmarkTreeNode) {
    // istanbul ignore next -- this is kind of a dumb/redundant API, but it
    // must conform to browser.bookmarks.onCreated...
    if (id !== new_bm.id) throw new Error(`Bookmark IDs don't match`);

    trace("whenBookmarkCreated", new_bm);

    const nodeId = id as NodeID;
    const parentId = (new_bm.parentId ?? "") as NodeID;

    // The parent must already exist and be a folder
    const parent = this.folder(parentId);
    if (parentId && !parent) {
      // We ignore missing parents if we're reloading--this is probably an event
      // for a child whose parent we haven't processed yet, and we'll just pick
      // it up next time around.
      if (this._is_reloading) return;
      throw new Error(
        `Trying to create a non-root bookmark "${id}" whose parent "${parentId}" doesn't exist`,
      );
    }

    let node = this.by_id.get(nodeId);
    if (!node) {
      if (isBrowserBTNFolder(new_bm)) {
        const folder: Folder = reactive({
          position: undefined,
          id: nodeId,
          dateAdded: new_bm.dateAdded,
          title: new_bm.title ?? "",
          children: [],
          $stats: computed(() => {
            let bookmarkCount = 0;
            let folderCount = 0;
            for (const c of folder.children) {
              if (isFolder(c)) ++folderCount;
              if (isBookmark(c)) ++bookmarkCount;
            }
            return {bookmarkCount, folderCount};
          }),
          $recursiveStats: computed(() => {
            let bookmarkCount = folder.$stats.bookmarkCount;
            let folderCount = folder.$stats.folderCount;
            for (const c of folder.children) {
              if (!isFolder(c)) continue;
              const stats = c.$recursiveStats;
              bookmarkCount += stats.bookmarkCount;
              folderCount += stats.folderCount;
            }
            return {bookmarkCount, folderCount};
          }),
        });
        node = folder;
      } else if (new_bm.type === "separator") {
        node = reactive({
          position: undefined,
          id: nodeId,
          dateAdded: new_bm.dateAdded,
          type: "separator" as "separator",
          title: "" as "",
        });
      } else {
        node = reactive({
          position: undefined,
          id: nodeId,
          dateAdded: new_bm.dateAdded,
          title: new_bm.title ?? "",
          url: new_bm.url ?? "",
        });
        this._add_url(node as Bookmark);
      }

      this.by_id.set(node.id, node);
    } else {
      // For idempotency, if the bookmark already exists, we merge the new
      // info we got with the existing record.
      node.title = new_bm.title;
      if (isBookmark(node)) {
        this._remove_url(node);
        node.url = new_bm.url ?? "";
        this._add_url(node);
      }
      node.dateAdded = new_bm.dateAdded;
    }

    // Move ourselves to the correct position in the tree.
    setPosition(node, parent ? {parent, index: new_bm.index!} : undefined);

    // If we got children, bring them in as well.
    if (isBrowserBTNFolder(new_bm) && new_bm.children) {
      for (const child of new_bm.children) {
        this.whenBookmarkCreated(child.id, child);
      }
    }

    // Finally, see if this folder is a candidate for being a stash root.
    if (isFolder(node)) {
      if (node.title === this.stash_root_name) this._stash_root_watch.add(node);
      if (this._stash_root_watch.has(node)) this._maybeUpdateStashRoot();
    }
  }

  whenBookmarkChanged(id: string, info: Bookmarks.OnChangedChangeInfoType) {
    trace("whenBookmarkChanged", id, info);
    if (this._is_reloading) return;

    const node = expect(
      this.by_id.get(id as NodeID),
      () => `Got change event for unknown node ${id}: ${JSON.stringify(info)}`,
    );

    if ("title" in info) {
      node.title = info.title;
      if (isFolder(node) && node.title === this.stash_root_name) {
        this._stash_root_watch.add(node);
      }
    }

    if (info.url !== undefined && isBookmark(node)) {
      this._remove_url(node);
      node.url = info.url;
      this._add_url(node);
    }

    // If this bookmark has been renamed to != this.stash_root_name,
    // _maybeUpdateStashRoot() will remove it from the watch set
    // automatically.
    if (isFolder(node) && this._stash_root_watch.has(node)) {
      this._maybeUpdateStashRoot();
    }
  }

  whenBookmarkMoved(id: string, info: {parentId: string; index: number}) {
    trace("whenBookmarkMoved", id, info);
    if (this._is_reloading) return;

    const node = expect(
      this.by_id.get(id as NodeID),
      () => `Got move event for unknown node ${id}: ${JSON.stringify(info)}`,
    );

    const new_parent = expect(
      this.folder(info.parentId as NodeID),
      () => `Move of ${id} is going to unknown folder ${info.parentId}`,
    );

    setPosition(node, {parent: new_parent, index: info.index});

    if (isFolder(node) && this._stash_root_watch.has(node)) {
      this._maybeUpdateStashRoot();
    }
  }

  whenBookmarkRemoved(id: string) {
    trace("whenBookmarkRemoved", id);
    if (this._is_reloading) return;

    const node = this.by_id.get(id as NodeID);
    if (!node) return;

    // We must remove children before their parents, so that we never have a
    // child referencing a parent that doesn't exist.
    if (isFolder(node)) {
      for (const c of Array.from(node.children)) this.whenBookmarkRemoved(c.id);
    }

    setPosition(node, undefined);

    this.by_id.delete(node.id);
    if (isBookmark(node)) this._remove_url(node);

    if (isFolder(node) && this._stash_root_watch.has(node)) {
      // We must explicitly remove `node` here because its title is
      // still "Tab Stash" even after it is deleted.
      this._stash_root_watch.delete(node);
      this._maybeUpdateStashRoot();
    }
  }

  /** Update `this.stash_root` if appropriate.  This function tries to be
   * fairly efficient in most cases since it is expected to be called quite
   * frequently.
   *
   * We avoid using watch() or watchEffect() here because we have to inspect
   * quite a few objects (starting from the root) to determine the stash root,
   * and so we want to minimize when this search is actually done. */
  private _maybeUpdateStashRoot(): Folder[] {
    // Collect the current candidate set from the watch, limiting ourselves
    // only to actual candidates (folders with the right name).
    let candidates = Array.from(this._stash_root_watch).filter(
      bm => bm.children && bm.title === this.stash_root_name,
    );

    // Find the path from each candidate to the root, and make sure we're
    // watching the whole path (so if a parent gets moved, we get called
    // again).
    const paths = filterMap(candidates, c => ({
      folder: c,
      path: pathTo<Folder, Node>(c),
    }));
    this._stash_root_watch = new Set(candidates);
    for (const p of paths) {
      for (const pos of p.path) this._stash_root_watch.add(pos.parent);
    }

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
    if (this.stash_root.value !== candidates[0]) {
      this.stash_root.value = candidates[0];
    }

    // But if we have multiple candidates, we need to raise the alarm that
    // there is an ambiguity the user should resolve.
    if (candidates.length > 1) {
      this.stash_root_warning.value = {
        text:
          `You have multiple "${this.stash_root_name}" bookmark ` +
          `folders, and Tab Stash isn't sure which one to use.  ` +
          `Click here to find out how to resolve the issue.`,
        /* istanbul ignore next */
        help: () => browser.tabs.create({active: true, url: ROOT_FOLDER_HELP}),
      };
    } else {
      this.stash_root_warning.value = undefined;
    }

    // We return the candidate list here so that callers can see what
    // candidates are available (since there may be ways of resolving
    // conflicts we can't do here).
    return candidates;
  }

  private _add_url(bm: Bookmark) {
    this.bookmarksWithURL(bm.url).add(bm);
  }

  private _remove_url(bm: Bookmark) {
    const index = this.by_url.get(urlToOpen(bm.url));
    // istanbul ignore if -- internal consistency
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

/** A cross-browser compatible way to tell if a bookmark returned by the
 * `browser.bookmarks` API is a folder or not. */
function isBrowserBTNFolder(bm: Bookmarks.BookmarkTreeNode): boolean {
  if (bm.type === "folder") return true; // for Firefox
  if (bm.children) return true; // for Chrome (sometimes)
  if (!("type" in bm) && !("url" in bm)) return true; // for Chrome
  return false;
}

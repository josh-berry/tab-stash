// All Tab Stash data models live in here somewhere, directly or indirectly.
//
// <aside>
// This generally follows Vuex/the Flux design pattern, but I don't use Vuex
// because I find Vuex to be proscriptive in ways that aren't helpful/actually
// hinder rapid development.  For example, with KVS-based models, I commonly
// want to keep a non-reactive Map which is a cache of records I've seen, so I
// can quickly tell what's part of the state already and what's new.  But this
// isn't possible with Vuex since it places strong limits on how the state is
// accessed during mutations.
//
// Also, a lot of these Vuex limitations seem to be driven by the need to keep
// the state read-only unless it's being accessed thru a mutation.  IMO this is
// done more reliably and with less runtime overhead at compile time.  So this
// is the approach I will take once I get the TypeScript typings worked out.
// </aside>
//
// That said, models generally export three things:
//
// - Source :: A type indicating the data source for the model (e.g. other
//   models, a KVS, a StoredObject, etc.).  A Source is usually necessary to
//   construct a model.
//
// - State :: (optional) A read-only, JSON-ifiable data structure which can be
//   used to read data out of the model.  The state is expected to be reactive
//   so that Vue can observe it.
//
// - Model :: The model itself--typically a class or other "smart" data
//   structure that uses the Source to produce state, and provides methods for
//   mutating and accessing the state in various ways that a user might want to
//   perform.  All the business logic resides here.

import {computed, ref, type Ref} from "vue";
import browser from "webextension-polyfill";

import {trace_fn} from "../util/debug.js";
import {
  backingOff,
  filterMap,
  shortPoll,
  TaskMonitor,
  textMatcher,
  tryAgain,
  urlToOpen,
  urlToStash,
} from "../util/index.js";
import {logError, logErrorsFrom, UserError} from "../util/oops.js";
import {makeRandomString} from "../util/random.js";

import * as BookmarkMetadata from "./bookmark-metadata.js";
import * as Bookmarks from "./bookmarks.js";
import * as BrowserSettings from "./browser-settings.js";
import * as Containers from "./containers.js";
import * as DeletedItems from "./deleted-items.js";
import * as Favicons from "./favicons.js";
import * as Options from "./options.js";
import * as Tabs from "./tabs.js";
import {TreeFilter} from "./tree-filter.js";
import {TreeSelection} from "./tree-selection.js";
import {BookmarkTree, friendlyFolderName} from "./bookmarks.js";
import {Tree, type TreePosition} from "./tree.js";

export {
  BookmarkMetadata,
  Bookmarks,
  BrowserSettings,
  Containers,
  DeletedItems,
  Favicons,
  Options,
  Tabs,
};

const trace = trace_fn("model");

/** The path separator used in group titles, whenever we need to flatten nested
 * folders into tab groups. */
export const GROUP_TITLE_PATH_SEP = " > ";

/** The StashItem is anything that can be placed in the stash.  It could already
 * be present as a tab (`id: number`), a bookmark (`id: string`), or not present
 * at all (no `id`).  It captures just the essential details of an item, like
 * its title, URL and identity (if it's part of the model). */
export type StashItem = NewTab | NewFolder | ModelItem;
export type StashParent =
  | NewFolder
  | Bookmarks.Folder
  | Tabs.Window
  | Tabs.TabGroupExtent;
export type StashLeaf = NewTab | Bookmarks.Bookmark | Tabs.Tab;

/** A container (bookmark folder or window) that is part of the model. */
export type ModelParent = Bookmarks.Folder | Tabs.Window | Tabs.TabGroupExtent;

/** An actual bookmark/tab that is part of the model. */
export type ModelItem =
  | Bookmarks.Node
  | Tabs.Window
  | Tabs.TabGroupExtent
  | Tabs.Tab;

export type NewTab = {title?: string; url: string};
export type NewFolder = {title: string; children: (NewTab | NewFolder)[]};

//
// StashItem type predicates
//

// TODO remove most of these in favor of explicit .type checks
export const isParent = (item: StashItem): item is StashParent =>
  "children" in item;

export const isLeaf = (item: StashItem): item is StashLeaf =>
  !isParent(item) && "url" in item;

export const isModelParent = (
  item: ModelItem | ModelParent,
): item is ModelParent => "children" in item;

export const isModelItem = (item: StashItem): item is ModelItem =>
  "type" in item;

export const isWindow = (item: StashItem): item is Tabs.Window =>
  isModelItem(item) && item.type === "window";

export const isTabGroupExtent = (
  item: StashItem,
): item is Tabs.TabGroupExtent => isModelItem(item) && "group" in item;

export const isTab = (item: StashItem): item is Tabs.Tab =>
  isModelItem(item) && item.type === "tab";

export const isNode = (item: StashItem): item is Bookmarks.Node =>
  isModelItem(item) &&
  (item.type === "bookmark" ||
    item.type === "folder" ||
    item.type === "separator");

export const isBookmark = (item: StashItem): item is Bookmarks.Bookmark =>
  isModelItem(item) && item.type === "bookmark";

export const isFolder = (item: StashItem): item is Bookmarks.Folder =>
  isModelItem(item) && item.type === "folder";

// NOTE: There are no isNew*() functions because NewTab and NewFolder are strict
// subsets of the model. What you're really asking is `!isModelItem()`, which is
// different--TypeScript will assume that all Tabs are NewTabs, which is
// probably not the behavior you want.

//
// StashItem accessors
//

function titleOf(item: StashItem): string | undefined {
  if ("title" in item) return item.title;
  if ("type" in item) {
    if (item.type === "tab-group") return item.group.title;
  }
  return undefined;
}

export const ModelTree = new (class extends Tree<
  Tabs.Window,
  Bookmarks.Folder | Tabs.TabGroupExtent,
  Bookmarks.Bookmark | Bookmarks.Separator | Tabs.Tab
> {
  isRootType(
    node: Bookmarks.Node | Tabs.Window | Tabs.TabGroupExtent | Tabs.Tab,
  ): node is Tabs.Window {
    return node.type === "window";
  }

  isLeafType(
    node: Bookmarks.Node | Tabs.Window | Tabs.TabGroupExtent | Tabs.Tab,
  ): node is Bookmarks.Bookmark | Bookmarks.Separator | Tabs.Tab {
    return (
      node.type === "bookmark" ||
      node.type === "separator" ||
      node.type === "tab"
    );
  }

  isLoaded(
    parent: Tabs.Window | Tabs.TabGroupExtent | Bookmarks.Folder,
  ): boolean {
    return (
      isWindow(parent) ||
      isTabGroupExtent(parent) ||
      (isFolder(parent) && parent.isLoaded)
    );
  }

  positionOf(
    node: Bookmarks.Node | Tabs.TabGroupExtent | Tabs.Tab,
  ):
    | TreePosition<Tabs.Window | Bookmarks.Folder | Tabs.TabGroupExtent>
    | undefined {
    return node.position;
  }

  childrenOf(
    parent: Tabs.Window | Tabs.TabGroupExtent | Bookmarks.Folder,
  ): (Bookmarks.Node | Tabs.TabGroupExtent | Tabs.Tab | undefined)[] {
    return parent.children;
  }

  protected setPosition(
    _node: Bookmarks.Node | Tabs.Window | Tabs.TabGroupExtent | Tabs.Tab,
    _position: TreePosition<Tabs.Window | Bookmarks.Folder> | undefined,
  ): void {
    throw new Error(
      `Cannot move a node using the ModelTree; use Model.*() methods instead`,
    );
  }
})();

export type Source = {
  readonly browser_settings: BrowserSettings.Model;
  readonly options: Options.Model;

  readonly tabs: Tabs.Model;
  readonly containers: Containers.Model;
  readonly bookmarks: Bookmarks.Model;
  readonly deleted_items: DeletedItems.Model;

  readonly favicons: Favicons.Model;
  readonly bookmark_metadata: BookmarkMetadata.Model;
};

/** The One Model To Rule Them All.
 *
 * Almost every bit of Tab Stash state is in here somewhere.  (And eventually,
 * every single bit of state WILL be in here).
 *
 * This is also the place where a lot of Tab Stash-specific logic lives, like
 * how to move tabs/bookmarks back and forth between, well, tabs and bookmarks.
 */
export class Model {
  readonly browser_settings: BrowserSettings.Model;
  readonly options: Options.Model;

  readonly tabs: Tabs.Model;
  readonly containers: Containers.Model;
  readonly bookmarks: Bookmarks.Model;
  readonly deleted_items: DeletedItems.Model;

  readonly favicons: Favicons.Model;
  readonly bookmark_metadata: BookmarkMetadata.Model;

  readonly searchText = ref("");
  readonly filter = new TreeFilter<
    Tabs.Window,
    Bookmarks.Folder | Tabs.TabGroupExtent,
    Bookmarks.Node | Tabs.Tab
  >(
    ModelTree,
    computed(() => {
      const searchText = this.searchText.value;
      if (!searchText) return _ => true;

      const matcher = textMatcher(searchText);
      return node =>
        matcher(titleOf(node) ?? "") || ("url" in node && matcher(node.url));
    }),
  );

  /** This is a bit of volatile metadata that tracks whether children that don't
   * match the filter should be shown in the UI or not.  We need it here because
   * the selection model depends on it for knowing which items in a range are
   * visible when doing a multi-select. */
  readonly showFilteredChildren = new WeakMap<ModelItem, Ref<boolean>>();

  readonly selection = new TreeSelection<
    Tabs.Window,
    Bookmarks.Folder | Tabs.TabGroupExtent,
    Bookmarks.Node | Tabs.Tab
  >(
    ModelTree,
    computed(() =>
      filterMap(
        [this.tabs.targetWindow.value, this.bookmarks.stash_root.value],
        i => i,
      ),
    ),
  );

  constructor(src: Source) {
    this.browser_settings = src.browser_settings;
    this.options = src.options;

    this.tabs = src.tabs;
    this.containers = src.containers;
    this.bookmarks = src.bookmarks;
    this.deleted_items = src.deleted_items;

    this.favicons = src.favicons;
    this.bookmark_metadata = src.bookmark_metadata;

    this.selection.rangeSelectPredicate = item => {
      // This is super ugly because it mimics logic that is spread around
      // various parts of the UI which determines whether a tab is visible or
      // not.  Ugh.

      if (isTab(item)) {
        if (item.pinned || item.hidden) return false;

        if (
          this.options.sync.state.show_open_tabs === "unstashed" &&
          this.bookmarks.isURLLoadedInStash(item.url)
        ) {
          return false;
        }
      }

      if (this.filter.info(item).isMatching) return true;

      if (!isWindow(item)) {
        const parent = ModelTree.positionOf(item)?.parent;
        if (parent && this.showFilteredChildren.get(parent)?.value) return true;
      }

      return false;
    };
  }

  /** Reload model data (where possible) in the event of an unexpected issue.
   * This should be used sparingly as it's quite expensive. */
  readonly reload = backingOff(async () => {
    trace("[pre-reload] dump of tab state", this.tabs.dumpState());
    trace("[pre-reload] dump of bookmark state", this.bookmarks.dumpState());
    await Promise.all([
      this.tabs.reload(),
      this.containers.reload(),
      this.bookmarks.reload(),
      this.browser_settings.reload(),
    ]);
    trace("[post-reload] dump of tab state", this.tabs.dumpState());
    trace("[post-reload] dump of bookmark state", this.bookmarks.dumpState());
  });

  /** Run an async function.  If it throws, reload the model (to try to
   * eliminate any inconsistencies) and log the error for further study. */
  async attempt<R>(fn: () => Promise<R>): Promise<R> {
    try {
      return await fn();
    } catch (e) {
      logError(e);
      if (!(e instanceof UserError)) {
        logErrorsFrom(async () => this.reload());
      }
      throw e;
    }
  }

  //
  // Accessors
  //

  /** Fetch and return an item, regardless of whether it's a bookmark or tab. */
  item(id: string | number): ModelItem | undefined {
    if (typeof id === "string")
      return this.bookmarks.node(id as Bookmarks.NodeID);
    else if (typeof id === "number") return this.tabs.tab(id as Tabs.TabID);
    /* c8 ignore next */ else throw new Error(`Invalid model ID: ${id}`);
  }

  /** Is the passed-in URL one we want to include in the stash?  Excludes
   * things like new-tab pages and Tab Stash pages (so we don't stash
   * ourselves). */
  isURLStashable(url_str?: string): boolean {
    // Things without URLs are not stashable.
    if (!url_str) return false;

    // New-tab URLs, homepages and the like are never stashable.
    if (this.browser_settings.isNewTabURL(url_str)) return false;

    // Invalid URLs are not stashable.
    try {
      new URL(url_str);
    } catch (e) {
      return false;
    }

    // The Tab Stash UI is never stashable.
    return !url_str.startsWith(browser.runtime.getURL("stash-list.html"));
  }

  /** Returns the "default" folder into which newly-stashed tabs should be
   * placed, if one exists.  Used to determine where to place single bookmarks
   * we are trying to stash, if we don't already know where they should go. */
  defaultStashDestFolder(): Bookmarks.Folder | undefined {
    const root = this.bookmarks.stash_root.value;
    if (!root) return undefined;

    const topmost: Bookmarks.Node | undefined = root.children[0];

    // Is there a top-most item under the root folder, and is it a folder?
    if (!topmost || !isFolder(topmost)) return undefined;

    // Does the folder have a name which looks like a default name?
    // NOTE: This should match the default-name logic in createStashFolder().
    if (
      !Bookmarks.getDefaultFolderNameISODate(topmost.title) &&
      !(this.searchText.value && topmost.title === this.searchText.value)
    ) {
      return undefined;
    }

    // Did something create/update this folder recently?
    // #cast dateAdded is always present on folders
    const age_cutoff =
      Date.now() - this.options.sync.state.new_folder_timeout_min * 60 * 1000;
    if (topmost.dateAdded! < age_cutoff) {
      return undefined;
    }

    // If so, we can put new stuff here by default.  (Otherwise we should
    // probably assume this isn't recent enough and a new folder should be
    // created.)
    return topmost;
  }

  /** Returns a list of tabs in a given window which should be stashed.
   *
   * This will exclude things like pinned and hidden tabs, or tabs with
   * privileged URLs.  If a window has multiple selected tabs (i.e. the user
   * has made an explicit choice about what to stash), only the selected tabs
   * will be returned.
   */
  stashableTabsInWindow(window: Tabs.Window): Tabs.Tab[] {
    const tabs = window.flattenedChildren.filter(t => !t.hidden);

    let selected = tabs.filter(t => t.highlighted);
    if (selected.length <= 1) {
      // If the user didn't specifically select a set of tabs to be
      // stashed, we ignore tabs which should not be included in the stash
      // for whatever reason (e.g. the new tab page).  If the user DID
      // explicitly select such tabs, however, we should include them (and
      // they will be restored using the privileged-tabs approach).
      selected = tabs.filter(t => this.isURLStashable(t.url));
    }

    // We filter out pinned tabs AFTER checking how many tabs are selected
    // because otherwise the user might have a pinned tab focused, and highlight
    // a single specific tab they want stashed (in addition to the active
    // pinned tab), and then ALL tabs would unexpectedly get stashed. [#61]
    return selected.filter(t => !t.pinned);
  }

  /** Create a new folder in the stash (creating the stash root itself if it
   * does not exist).  If the name is not specified, a default name will be
   * assigned based on the folder's creation time or the current search term. */
  async createStashFolder(
    name?: string,
    parent?: Bookmarks.Folder,
  ): Promise<Bookmarks.Folder> {
    const stash_root = await this.bookmarks.ensureStashRoot();

    parent ??= stash_root;

    // NOTE: This should match what happens in defaultStashDestFolder().
    name ??= this.searchText.value;
    name ||= Bookmarks.genDefaultFolderName(new Date());

    const bm = await this.bookmarks.create({
      parentId: parent.id,
      title: name,
      index: parent === stash_root ? 0 : parent.children.length,
    });
    return bm as Bookmarks.Folder;
  }

  //
  // Mutators
  //

  /** Garbage-collect various caches and deleted items. */
  async gc() {
    const deleted_exp =
      Date.now() -
      this.options.sync.state.deleted_items_expiration_days *
        24 *
        60 *
        60 *
        1000;

    // Needed so that we can see every URL in the stash. Otherwise we might
    // ignore tabs that can actually be closed, and we might drop
    // metadata/favicons we want to keep.
    await this.bookmarks.loadedStash();

    // Figure out which domains are in the stash so we know which domain-level
    // favicons to keep.
    const urls = await this.bookmarks.urlsInStash();
    const domains_to_keep = new Set();
    for (const u of urls) {
      domains_to_keep.add(Favicons.domainForUrl(urlToOpen(u)));
    }

    await this.deleted_items.dropOlderThan(deleted_exp);
    await this.favicons.gc(
      url =>
        this.bookmarks.loadedBookmarksWithURL(url).size > 0 ||
        this.tabs.tabsWithURL(url).size > 0 ||
        domains_to_keep.has(url),
    );
    await this.bookmark_metadata.gc(
      id =>
        id === BookmarkMetadata.CUR_WINDOW_MD_ID ||
        !!this.bookmarks.node(id as Bookmarks.NodeID),
    );

    await this.closeOrphanedHiddenTabs();
  }

  /** Stashes all eligible tabs in the specified window, leaving the existing
   * tabs open if `copy` is true. */
  async stashAllTabsInWindow(
    window: Tabs.Window,
    options: {
      copy?: boolean;
      parent?: Bookmarks.Folder;
    },
  ) {
    const tabs = this.stashableTabsInWindow(window);
    if (tabs.length === 0) return;

    await this.putItemsInFolder({
      items: copyIf(!!options.copy, tabs),
      toFolder: await this.createStashFolder(undefined, options.parent),
    });
  }

  /** Put the set of currently-selected items in the specified folder
   * when the toFolderId option is set, otherwise the current window.
   *
   * Note: When copying is disabled, the source items will be deselected. */
  async putSelectedIn(options?: {copy?: boolean; toFolder?: Bookmarks.Folder}) {
    const from_items = Array.from(this.selection.selectedItems());
    const items = copyIf(options?.copy === true, from_items);

    let affected_items: StashItem[];
    if (options?.toFolder === undefined) {
      const toParent = this.tabs.targetWindow.value;
      if (!toParent) throw new Error(`No target window`);
      affected_items = await this.putItemsInWindow({
        items,
        toParent,
        toIndex: toParent.children.length,
      });
    } else {
      affected_items = await this.putItemsInFolder({
        items,
        toFolder: options.toFolder,
        allowDuplicates: options?.copy === true,
      });
    }
    if (!options?.copy) {
      for (const i of affected_items) {
        if (isModelItem(i)) this.selection.info(i).isSelected = false;
      }
    }
  }

  /** Put the set of currently-selected items in the current window. */
  async putSelectedInWindow(options: {copy: boolean}) {
    await this.putSelectedIn(options);
  }

  /** Put the set of currently-selected items in the specified folder. */
  async putSelectedInFolder(options: {
    copy: boolean;
    toFolder: Bookmarks.Folder;
  }) {
    await this.putSelectedIn(options);
  }

  /** Hide/discard/close the specified tabs, according to the user's settings
   * for what to do with stashed tabs.  Creates a new tab if necessary to keep
   * the browser window(s) open. */
  async hideOrCloseStashedTabs(tabs: Tabs.Tab[]): Promise<void> {
    if (tabs.length === 0) return;

    // Clear any highlights/selections on tabs we are stashing
    // Chromium rejects un-highlighting the active tab when it's the only
    // highlighted tab in the window; ignore that failure so it doesn't abort
    // the close step.
    await Promise.all(
      tabs.map(t =>
        browser.tabs.update(t.id, {highlighted: false}).catch(() => {}),
      ),
    );
    for (const t of tabs) this.selection.info(t).isSelected = false;

    switch (this.options.local.state.after_stashing_tab) {
      case "hide_discard":
        await this.tabs.hide(tabs, "discard");
        break;
      case "close":
        await this.tabs.remove(tabs);
        break;
      case "hide":
      default:
        await this.tabs.hide(tabs);
        break;
    }
  }

  /** Opens the main Tab Stash UI. Has all the semantics of restoreTabs(), but
   * will also pass along the current selection (if any). */
  openMainUI(
    searchParams: Record<string, string[] | string>,
  ): Promise<Tabs.Tab[]> {
    const url = new URL(browser.runtime.getURL("stash-list.html"));

    for (const [k, vals] of Object.entries(searchParams)) {
      if (vals instanceof Array) {
        for (const v of vals) url.searchParams.append(k, v);
      } else {
        url.searchParams.set(k, vals);
      }
    }

    if (this.searchText.value) {
      url.searchParams.set("q", this.searchText.value);
    }

    for (const item of this.selection.selectedItems()) {
      if (isNode(item)) {
        url.searchParams.append("bm", item.id);
      } else if (isTab(item)) {
        url.searchParams.append("t", item.id.toString());
      } else {
        // Windows should never be selected; ignore them.
      }
    }

    // If there's some state we're carrying over from the current environment,
    // put a random nonce in the hash so that the URL is unique.  This is needed
    // to ensure we ALWAYS open a new tab.  Otherwise, if the user already has a
    // UI open with the same URL, we'll switch to that tab instead of opening a
    // new one, and the UI's state might be wrong (e.g. because the user had
    // previously closed the import dialog, changed the selection, etc.).
    if (url.searchParams.size > 0) url.hash = makeRandomString(8);

    // CAST: We know we're only getting tabs back because we are restoring only
    // a single tab.
    return this.restoreTabs(
      [{title: "Tab Stash", url: url.href}],
      {},
    ) as Promise<Tabs.Tab[]>;
  }

  /** Restores the specified URLs as new tabs in the current window.  Returns
   * the IDs of the restored tabs.
   *
   * Note that if a tab is already open and not hidden, we will do nothing,
   * since we don't want to open duplicate tabs.  Such tabs will not be
   * included in the returned list.
   *
   * After restoring tabs, if the previously-active tab was a blank tab, it will
   * be closed.  Note that this tab may be the Tab Stash tab itself (e.g. if Tab
   * Stash is the homepage or the new-tab page).  In that situation, this
   * function may not return (since the tab running it will be closed). */
  async restoreTabs(
    items: StashItem[],
    options: {
      /** Should the tabs be placed into a new tab group, and if so, what should
       * the group be called? */
      groupTitle?: string;

      /** Should tabs be opened in the background? */
      background?: boolean;

      /** Run this function after restoring tabs, but before closing the active
       * new tab (if any).  This hook exists in case Tab Stash is itself the
       * active new tab--in which case, this function never returns.
       *
       * Note that this function always runs exactly once (even if there is no
       * tab to close.) */
      beforeClosing?: (
        restoredItems: (Tabs.TabGroupExtent | Tabs.Tab)[],
      ) => Promise<void>;
    },
  ): Promise<(Tabs.TabGroupExtent | Tabs.Tab)[]> {
    const toWindow = this.tabs.targetWindow.value;
    if (toWindow === undefined) {
      throw new Error(`No target window; not sure where to restore tabs`);
    }

    // As a special case, if we are restoring just a single tab, first check
    // if we already have the tab open and just switch to it.  (No need to
    // disturb the ordering of tabs in the browser window.)
    if (!options.background && items.length === 1 && "url" in items[0]) {
      const t = Array.from(this.tabs.tabsWithURL(items[0].url)).find(
        t => !t.hidden && t.flattenedPosition?.parent === toWindow,
      );
      if (t) {
        await browser.tabs.update(t.id, {active: true});
        return [t];
      }
    }

    // We want to know what tabs are currently open in the window, so we can
    // avoid opening duplicates.
    const win_tabs = toWindow.flattenedChildren;

    // We want to know which tab the user is currently looking at so we can
    // close it if it's just the new-tab page.
    const active_tab = win_tabs.filter(t => t.active)[0];

    const restored_items =
      options.groupTitle !== undefined
        ? await this.putItemsInNewTabGroup({
            title: options.groupTitle,
            items: copying(items),
            toWindow,
            toIndex: toWindow.children.length,
          })
        : await this.putItemsInWindow({
            items: copying(items),
            toParent: toWindow,
            toIndex: toWindow.children.length,
          });

    if (options.beforeClosing) await options.beforeClosing(restored_items);

    if (!options.background) {
      // Switch to the last tab that we restored (if desired).  We choose
      // the LAST tab to behave similarly to the user having just opened a
      // bunch of tabs.
      if (restored_items.length > 0) {
        const last_item = restored_items[restored_items.length - 1];
        const last_tab =
          last_item.type === "tab"
            ? last_item
            : last_item.children[last_item.children.length - 1];
        await browser.tabs.update(last_tab.id, {active: true});
      }

      // Finally, if we opened at least one tab, AND we were looking at
      // the new-tab page, close the new-tab page in the background.
      if (
        active_tab &&
        restored_items.length > 0 &&
        this.browser_settings.isNewTabURL(active_tab.url ?? "") &&
        active_tab.status === "complete"
      ) {
        browser.tabs.remove([active_tab.id]).catch(console.log);
      }
    }

    return restored_items;
  }

  /** Returns the "default" folder into which newly-stashed tabs should go,
   * creating one at the top of the stash root if necessary. */
  async ensureDefaultStashDestFolder(): Promise<Bookmarks.Folder> {
    const folder = this.defaultStashDestFolder();
    if (folder !== undefined) return folder;
    return await this.createStashFolder();
  }

  /** Moves or copies items (bookmarks, tabs, and/or external items) to a
   * particular location in a particular bookmark folder.
   *
   * If the source item contains an ID and is a bookmark, it will be moved
   * directly (so the ID remains the same).  If it contains an ID and is a
   * tab, the tab will be closed once the bookmark is created.  Items without
   * an ID will always be created as new bookmarks.
   *
   * If a bookmark with the same title/URL already exists in the folder, it
   * will be moved into place instead of creating a new bookmark, so as to
   * avoid creating duplicates. */
  async putItemsInFolder(options: {
    items: StashItem[];
    toFolder: Bookmarks.Folder;
    toIndex?: number;
    allowDuplicates?: boolean;
    task?: TaskMonitor;
  }): Promise<Bookmarks.Node[]> {
    const to_folder = await this.bookmarks.loaded(options.toFolder);
    const items = options.items;

    // Note: We explicitly DON'T check stashability here because the caller
    // has presumably done this for us--and has explicitly chosen what to
    // put in the folder.

    // Check if we're trying to move a parent into itself or one of its children
    const cyclic_sources = BookmarkTree.pathTo(to_folder).map(p => p.parent.id);
    cyclic_sources.push(to_folder.id);
    for (const i of items) {
      if (!isFolder(i)) continue;
      if (cyclic_sources.includes(i.id)) {
        throw new UserError(`Cannot move a group into itself`);
      }
    }

    if (options.task) options.task.max = options.items.length;

    // Keep track of which bookmarks we are moving/have already stolen.  A
    // bookmark can be "stolen" if we have a non-bookmark item with a URL
    // that matches a bookmark in the current folder which we are not
    // already moving--in this case, we "steal" the other bookmark so we
    // don't create a duplicate.
    const dont_steal_bms = new Set<Bookmarks.NodeID>(
      filterMap(items, i => (isNode(i) ? i.id : undefined)),
    );

    // Now, we move everything into the folder.  `to_index` is maintained as
    // the insertion point (i.e. the next inserted item should have index
    // `to_index`).
    const moved_items: Bookmarks.Node[] = [];
    const close_tabs: Tabs.Tab[] = [];

    for (
      let i = 0, to_index = options.toIndex ?? to_folder.children.length;
      i < items.length;
      ++i, ++to_index, options.task && ++options.task.value
    ) {
      const item = items[i];

      // If it's a bookmark node, just move it directly.
      if (isNode(item)) {
        const pos = item.position;
        await this.bookmarks.move(item, to_folder, to_index);
        moved_items.push(item);
        dont_steal_bms.add(item.id);

        if (pos && pos.parent === to_folder && pos.index < to_index) {
          // Because we are moving items which appear in the list
          // before the insertion point, the insertion point shouldn't
          // move--the index of the moved item is actually to_index -
          // 1, so the location of the next item should still be
          // to_index.
          --to_index;
        }
        continue;
      }

      // If it's a tab or group, mark it for closure.
      if (isTab(item)) close_tabs.push(item);
      if (isTabGroupExtent(item)) {
        // The group itself will be implicitly deleted once all its tabs close.
        close_tabs.splice(close_tabs.length, 0, ...item.children);
      }

      // Otherwise, if we're not allowing duplicates, check if there's a
      // duplicate in the current folder which we can steal.  If so, we
      // move it.  Otherwise, we just create a new bookmark.  Unlike
      // putItemsInWindow(), we look at both title and url here since the
      // user might have renamed the bookmark.
      let node;
      const already_there =
        "url" in item && !options.allowDuplicates
          ? to_folder.children.filter(
              bm =>
                !dont_steal_bms.has(bm.id) &&
                isBookmark(bm) &&
                urlToStash(bm.url) === urlToStash(item.url) &&
                (item.title ? item.title === bm.title : true),
            )
          : [];
      if (already_there.length > 0) {
        // We found a duplicate in the folder already; move it into position.
        node = already_there[0];

        const pos = node.position;
        await this.bookmarks.move(node, to_folder, to_index);
        if (pos && pos.parent === to_folder && pos.index < to_index) --to_index;
      } else {
        // There is no duplicate, so we can just create a new one.  We might
        // also make it here if we've been given a folder of bookmarks to copy
        // in (i.e. that wasn't moved from elsewhere).
        const createTree = async (
          item: StashItem,
          parentId: Bookmarks.NodeID,
          index: number,
        ): Promise<Bookmarks.Node> => {
          let title: string = titleOf(item) ?? "";
          if (!title) {
            if ("url" in item) {
              title = item.url;
            } else {
              title = Bookmarks.genDefaultFolderName(new Date());
            }
          }

          const node =
            "url" in item
              ? await this.bookmarks.create({
                  title,
                  url: urlToStash(item.url),
                  parentId,
                  index,
                })
              : await this.bookmarks.create({title, parentId, index});

          if ("children" in item) {
            let idx = 0;
            for (const c of item.children) {
              if (c === undefined) continue;
              if (typeof c === "string") {
                await this.bookmarks.move(c, node as Bookmarks.Folder, idx);
              } else {
                await createTree(c, node.id, idx);
              }
              ++idx;
            }
          }
          return node;
        };
        node = await createTree(item, to_folder.id, to_index);
      }
      moved_items.push(node);
      dont_steal_bms.add(node.id);

      // Update the selection state of the chosen bookmark to match the
      // original item's selection state.
      this.selection.info(node).isSelected =
        isModelItem(item) && this.selection.info(item).isSelected;
    }

    // Hide/close any tabs which were moved from, since they are now
    // (presumably) in the stash.
    await this.hideOrCloseStashedTabs(close_tabs);

    return moved_items;
  }

  /** Move or copy items (bookmarks, tabs, external items) into a new tab
   * group (or set of tab groups) at a particular location in a particular
   * window.  Returns the newly-created tab groups. Otherwise works similarly
   * to putItemsInWindow(). */
  async putItemsInNewTabGroup(options: {
    items: StashItem[];
    toWindow: Tabs.Window;
    toIndex: number;
    task?: TaskMonitor;
    title?: string;
  }): Promise<Tabs.TabGroupExtent[]> {
    const spawn = TaskMonitor.spawner(options.task);

    const tabs = filterMap(options.items, i => (isLeaf(i) ? i : undefined));
    const groups = filterMap(options.items, i => (!isLeaf(i) ? i : undefined));

    const moved_tabs = (await spawn(tm =>
      this.putItemsInWindow({
        items: tabs,
        toParent: options.toWindow,
        toIndex: options.toIndex,
        task: tm,
      }),
    )) as Tabs.Tab[];
    const moved_groups = (await spawn(tm =>
      this.putItemsInWindow({
        items: groups,
        toParent: options.toWindow,
        toIndex: options.toIndex + moved_tabs.length,
        task: tm,
      }),
    )) as Tabs.TabGroupExtent[];

    if (moved_tabs.length > 0) {
      const gid = await browser.tabs.group({
        tabIds: moved_tabs.map(t => t.id),
        createProperties: {windowId: options.toWindow.id},
      });
      await browser.tabGroups.update(gid, {
        title: options.title ?? (this.searchText.value || "Untitled"),
      });
      const extent = await shortPoll(() => {
        // NOTE: We're more relaxed about the target index, because the index
        // may have changed in unpredictable ways due to tabs in the current
        // window being moved into the new group.
        const extent = options.toWindow.children.find(
          c => c.type === "tab-group" && c.group.id === gid,
        ) as Tabs.TabGroupExtent | undefined;
        if (!extent) tryAgain("group extent not found");

        // We also need to wait for all of the tabs to appear in the same extent
        if (extent.children.length !== moved_tabs.length) {
          tryAgain(`group extent doesn't have enough children`);
        }

        // And we need to make sure they're the right tabs
        for (let i = 0; i < moved_tabs.length; ++i) {
          if (moved_tabs[i].position?.parent !== extent) {
            tryAgain(
              `tab ${moved_tabs[i].id} not in group extent ${extent.group.id}`,
            );
          }
        }
        return extent;
      });
      moved_groups.unshift(extent);
    }

    return moved_groups;
  }

  /** Move or copy items (bookmarks, tabs, and/or external items) to a
   * particular location in a particular window.  Returns the affected
   * tabs/groups (either the moved original items, or the new items that were
   * created).  Tabs which are moved/created/restored will NOT be active (i.e.
   * they will always be in the background).
   *
   * If the source item contains an ID and is a tab, it will be moved directly
   * (so the ID remains the same).  If it contains an ID and is a bookmark, a
   * tab will be put into the right place (see below), and the bookmark will
   * be deleted.  External items (without an ID) will simply have tabs put
   * into the right place.
   *
   * A tab is "put into the right place" either by moving an existing tab (and
   * restoring it if it's a hidden tab), or creating a new tab, so as to avoid
   * opening duplicate tabs. */
  async putItemsInWindow(options: {
    items: StashItem[];
    toParent: Tabs.Window | Tabs.TabGroupExtent;
    toIndex: number;
    task?: TaskMonitor;
  }): Promise<(Tabs.TabGroupExtent | Tabs.Tab)[]> {
    const items = options.items;

    if (options.task) options.task.max = items.length + 1;

    // Keep track of which tabs we are moving/have already stolen.  A tab
    // can be "stolen" if we have a non-tab item with a URL that matches a
    // tab which we are not already moving--in this case, we "steal" the
    // already-open tab so we don't have to open a duplicate.
    const dont_steal_tabs = new Set<Tabs.TabID>(
      items.flatMap(i => {
        if (!isModelItem(i)) return [];
        return Array.from(ModelTree.nodesInSubtree(i))
          .filter(isTab)
          .map(t => t.id);
      }),
    );

    // console.log('options', options);
    // console.log('dont_steal_tabs', dont_steal_tabs);

    // Now, we move/restore tabs.
    const moved_items: (Tabs.TabGroupExtent | Tabs.Tab)[] = [];
    const delete_bms: Bookmarks.Node[] = [];

    // Inner helper that moves a single item and updates all the above state.
    // Returns an adjustment to the index to use, in case it decides to steal a
    // tab from the current window (or is asked to move a tab within the same
    // window).
    const moveLeaf = async (
      item: StashLeaf,
      to_parent: Tabs.Window | Tabs.TabGroupExtent,
      to_index: number,
    ): Promise<number> => {
      // Figure out if there's already a tab we can move--maybe we're actually
      // being asked to move a tab, or maybe there's a hidden tab or tab
      // elsewhere in the same window/group we can move into place.
      let tab = isTab(item)
        ? item
        : Array.from(this.tabs.tabsWithURL(item.url))
            .filter(
              t =>
                !dont_steal_tabs.has(t.id) &&
                !t.pinned &&
                (t.hidden || t.position?.parent === to_parent),
            )
            .sort((a, b) => -a.hidden - -b.hidden)[0];

      if (!tab) {
        // There is no tab to move, so create one in the right place.
        tab = await this.tabs.create({
          atParent: to_parent,
          atIndex: to_index,
          active: false,
          discarded: this.options.local.state.load_tabs_on_restore === "lazily",
          title: item.title,
          url: urlToOpen(item.url),
        });
      } else {
        // Move the tab into the right place.
        await this.tabs.move(tab, to_parent, to_index);
      }

      if (tab.hidden) await this.tabs.show(tab);

      moved_items.push(tab);
      dont_steal_tabs.add(tab.id);
      this.selection.info(tab).isSelected =
        isModelItem(item) && this.selection.info(item).isSelected;

      const pos = tab.position;
      if (pos && pos.parent === to_parent && pos.index < to_index) return -1;
      return 0;
    };

    // Create a bookmark/item tree inside the window at the specified position,
    // by creating tabs and tab groups.
    const createTreeInWindow = async (
      tree: StashParent,
      to_parent: Tabs.Window | Tabs.TabGroupExtent,
      to_index: number,
      title: string,
      task?: TaskMonitor,
    ): Promise<void> => {
      const leaves = filterMap(tree.children, c =>
        c && isLeaf(c) ? {...c, url: urlToOpen(c.url)} : undefined,
      );
      const subgroups = filterMap(tree.children, c =>
        c && isParent(c) ? c : undefined,
      );

      if (to_parent.type === "tab-group") {
        // We're moving a folder inside a tab group, but that's not supported;
        // we should just make an adjacent tab group in the parent window.
        to_index = to_parent.position!.index + 1;
        to_parent = to_parent.position!.parent;
      }

      if (leaves.length > 0) {
        const g = await this.tabs.createGroup({
          title,
          atParent: to_parent,
          atIndex: to_index,
          tabs: leaves,
        });
        moved_items.push(g);
        if (isModelItem(tree)) {
          this.selection.info(g).isSelected =
            this.selection.info(tree).isSelected;
        }

        for (let i = 0; i < leaves.length; ++i) {
          const l = leaves[i];
          const n = g.children[i];
          if (!isModelItem(l)) continue;
          if (!n) continue;
          this.selection.info(n).isSelected = this.selection.info(l).isSelected;
        }
      }

      for (const g of subgroups) {
        ++to_index;
        const subtitle = titleOf(g) ?? "Untitled";
        const t = (tm?: TaskMonitor) =>
          createTreeInWindow(
            g,
            to_parent,
            to_index,
            `${title}${GROUP_TITLE_PATH_SEP}${friendlyFolderName(subtitle)}`,
            tm,
          );
        await (task ? task.spawn(t) : t());
      }
    };

    // Tab groups are handled specially because we can move the whole group with
    // a single call. This is better than moving tabs one by one, as
    // moveParent() does.
    const moveTabGroupExtent = async (
      item: Tabs.TabGroupExtent,
      to_parent: Tabs.Window | Tabs.TabGroupExtent,
      to_index: number,
    ): Promise<number> => {
      // We cannot move a group into another group, so adjust our new position
      // to be after the target group instead.
      if (to_parent.type === "tab-group") {
        to_index = to_parent.position!.index + 1;
        to_parent = to_parent.position!.parent;
      }

      const isSelected = this.selection.info(item).isSelected;

      const adjust_index =
        item.position?.parent === to_parent && to_index < item.position?.index
          ? -1
          : 0;
      const new_extent = await this.tabs.moveGroup(item, to_parent, to_index);
      moved_items.push(new_extent); // the old extent will be removed

      // Inherit selection on the new extent
      this.selection.info(new_extent).isSelected = isSelected;

      return adjust_index;
    };

    const moveItem = async (
      item: StashItem,
      to_parent: Tabs.Window | Tabs.TabGroupExtent,
      to_index: number,
      task?: TaskMonitor,
    ): Promise<number> => {
      try {
        if ("url" in item) {
          return await moveLeaf(item, to_parent, to_index);
        } else if (isModelItem(item) && item.type === "separator") {
          // There's no way to represent a separator in the window, so just
          // let it be removed.
        } else if (isTabGroupExtent(item)) {
          return await moveTabGroupExtent(item, to_parent, to_index);
        } else if (isWindow(item)) {
          // There's no way to do this in the UI right now
          throw new Error(`Moving whole windows is not implemented`);
        } else {
          const t = (tm?: TaskMonitor) =>
            createTreeInWindow(
              item,
              to_parent,
              to_index,
              friendlyFolderName(item.title),
              tm,
            );
          await (task ? task.spawn(t) : t());
        }
        return 0;
      } finally {
        if (task) ++task.value;
      }
    };

    for (
      let i = 0, to_index = options.toIndex ?? options.toParent.children.length;
      i < items.length;
      ++i, ++to_index
    ) {
      const item = items[i];
      to_index += await moveItem(
        item,
        options.toParent,
        to_index,
        options.task,
      );

      if (isNode(item)) delete_bms.push(item);
    }

    // Delete bookmarks for all the tabs we restored.  We use the same
    // timestamp for each deleted item so that we can guarantee the deleted
    // items are sorted in the same order they were listed in the stash
    // (which makes it easier for users to find things).
    //
    // We do this at the end so that (a) we never delete anything until all the
    // moves/creations are done, and (b) we can delete just the top-level
    // bookmarks that were moved. If we delete each node individually, we won't
    // save the tree structure in the user's deleted-items DB.
    const now = new Date();
    await Promise.all(
      delete_bms.map(bm => {
        if (bm.type === "bookmark") return this.deleteBookmark(bm, now);
        if (bm.type === "separator") return browser.bookmarks.remove(bm.id);
        return this.deleteBookmarkTree(bm, now);
      }),
    );
    if (options.task) ++options.task.value;

    return moved_items;
  }

  /** Deletes the specified items (bookmark nodes or tabs), saving any deleted
   * bookmarks to the deleted-items model. */
  async deleteItems(items: Iterable<ModelItem>) {
    const now = new Date();
    const tabs: Tabs.Tab[] = [];
    const windows: Tabs.Window[] = [];

    for (const i of items) {
      if (isNode(i)) {
        if (isFolder(i)) {
          await this.deleteBookmarkTree(i, now);
        } else if (isBookmark(i)) {
          await this.deleteBookmark(i, now);
        } else {
          // separator
          await this.bookmarks.remove(i);
        }
      } else if (isTabGroupExtent(i)) {
        // We just push the children into `tabs`, because closing all the
        // selected tabs will automatically destroy the group. And if we happen
        // to be in a weird situation where there are multiple extents for the
        // group, this is safer because it doesn't close unexpected tabs.
        for (const c of i.children) tabs.push(c);
      } else if (isTab(i)) {
        tabs.push(i);
      } else {
        windows.push(i);
      }
    }

    await this.tabs.remove(tabs);
    await this.tabs.removeWindows(windows);
  }

  /** Deletes the specified bookmark subtree, saving it to deleted items.  You
   * should use {@link deleteBookmark()} for individual bookmarks, because it
   * will cleanup the parent folder if the parent folder has a "default" name
   * and would be empty. */
  async deleteBookmarkTree(node: Bookmarks.Node, deleted_at?: Date) {
    const toDelItem = async (
      item: Bookmarks.Node,
    ): Promise<DeletedItems.DeletedItem> => {
      if (isFolder(item)) {
        const lf = await this.bookmarks.loaded(item);
        return {
          title: item.title,
          children: await Promise.all(lf.children.map(i => toDelItem(i))),
        };
      }

      if (isBookmark(item)) {
        return {
          title: item.title,
          url: item.url,
          favIconUrl:
            this.favicons.get(urlToOpen(item.url!)).value?.favIconUrl ||
            undefined,
        };
      }

      return {title: "", url: ""};
    };

    // Make sure the node we're about to delete is fully-loaded in the model, so
    // we can save a complete view of it to deleted items.
    if (isFolder(node)) await this.bookmarks.loadedSubtree(node);

    await this.deleted_items.add(await toDelItem(node), undefined, deleted_at);
    await this.bookmarks.removeTree(node);
  }

  /** Deletes the specified bookmark, saving it to deleted items.  If it was
   * the last bookmark in its parent folder, AND the parent folder has a
   * "default" name, removes the parent folder as well. */
  async deleteBookmark(bm: Bookmarks.Bookmark, deleted_at?: Date) {
    const parent = bm.position?.parent;

    await this.deleted_items.add(
      {
        title: bm.title ?? "<no title>",
        url: bm.url ?? "about:blank",
        favIconUrl:
          this.favicons.get(urlToOpen(bm.url!))?.value?.favIconUrl || undefined,
      },
      parent
        ? {
            folder_id: parent.id,
            title: parent.title!,
          }
        : undefined,
      deleted_at,
    );

    await this.bookmarks.remove(bm);
  }

  /** Un-delete a deleted item, or part of a deleted item if `path' is
   * specified.  Removes it from deleted_items and adds it back to bookmarks,
   * hopefully in approximately the same place it was in before. */
  async undelete(
    deletion: DeletedItems.Deletion,
    path?: number[],
  ): Promise<void> {
    const di = this.deleted_items;

    // We optimistically remove immediately from recentlyDeleted to prevent
    // users from trying to un-delete the same thing multiple times.
    if (
      typeof di.state.recentlyDeleted === "object" &&
      di.state.recentlyDeleted.key === deletion.key
    ) {
      di.state.recentlyDeleted = 0;
    }

    const item = DeletedItems.findChildItem(deletion.item, path).child;

    const stash_root = await this.bookmarks.ensureStashRoot();

    // Try to find where to put the restored bookmark, if relevant.  We only try
    // to find the existing folder IF we're restoring a top-level item.
    let toFolder: Bookmarks.Folder | undefined;
    let toIndex: number | undefined;
    if (deletion.deleted_from && (!path || path.length == 0)) {
      const from = deletion.deleted_from;
      const folder = this.bookmarks.folder(from.folder_id as Bookmarks.NodeID);
      if (folder) {
        // The exact folder we want still exists, use it
        toFolder = folder;
      } else {
        // Search for an existing folder inside the stash root with
        // the same name as the folder it was deleted from.
        const loaded_root = await this.bookmarks.loaded(stash_root);
        const child = loaded_root.children.find(
          c => isFolder(c) && c.title === from.title,
        );
        if (child && isFolder(child)) toFolder = child;
      }
    }

    // If we still don't know where it came from or its prior containing folder
    // was deleted, AND the item we're restoring is not itself a folder, just
    // put it in an unnamed folder.
    if (!toFolder) {
      if (!("children" in item)) {
        toFolder = await this.ensureDefaultStashDestFolder();
      } else {
        // We're restoring a folder, and we don't know where to put it; just put
        // it in the stash root.
        toFolder = stash_root;
        toIndex = 0;
      }
    }

    // Restore the deleted item.
    await this.putItemsInFolder({items: [item], toFolder, toIndex});

    // Restore any favicons.
    const restoreFavicons = (item: DeletedItems.DeletedItem) => {
      if ("url" in item && "favIconUrl" in item) {
        this.favicons.maybeSet(urlToOpen(item.url), item);
      }
      if ("children" in item) {
        for (const c of item.children) restoreFavicons(c);
      }
    };
    restoreFavicons(item);

    // Remove the item we just restored.
    await di.drop(deletion.key, path);
  }

  /** Closes any hidden tabs that were originally hidden by Tab Stash, but are
   * no longer present as bookmarks in the stash. */
  async closeOrphanedHiddenTabs() {
    if (!browser.tabs.hide) return;
    const now = Date.now();
    const tabs = await browser.tabs.query({hidden: true});

    // Required so we actually know which tabs have URLs in the stash.
    await this.bookmarks.loadedStash();

    const our_hidden_tabs = await Promise.allSettled(
      tabs.map(async bt => {
        const mt = this.tabs.tab(bt.id!)!;
        const hidden_by_us = await this.tabs.wasTabHiddenByUs(mt);
        return {tab: mt, atime: bt.lastAccessed, hidden_by_us};
      }),
    );

    const tab_ids_to_close = filterMap(our_hidden_tabs, res => {
      // If we couldn't figure out whether the tab was hidden by us or not, OR
      // if we can tell the tab was NOT hidden by us, leave it alone.
      if (res.status !== "fulfilled") return undefined;
      if (res.value.tab.id === undefined) return undefined;
      if (!res.value.hidden_by_us) return undefined;

      // If the tab was very recently accessed, we should ignore it; we might be
      // in the midst of stashing it right now (and it's possible the bookmark
      // hasn't been created yet).
      if (res.value.atime && res.value.atime > now - 2000) {
        return undefined;
      }

      // If there is a URL in the stash matching the tab's URL, we know this
      // tab is still in the stash and cannot be closed.
      if (this.bookmarks.isURLLoadedInStash(res.value.tab.url!)) {
        return undefined;
      }
      return res.value.tab.id;
    });

    await browser.tabs.remove(tab_ids_to_close);
  }

  //
  // Test-only code
  //

  /* c8 ignore start -- for manual debugging */
  /** Create a bunch of fake(-ish) tabs for benchmarking purposes. This is
   * private because no actual code should call this, but we want it accessible
   * at runtime. */
  async createTabsForBenchmarks_testonly(options: {
    name?: string;
    folder_count: number;
    folder_levels: number;
    tabs_per_folder: number;
  }): Promise<void> {
    const bench_folder = await this.createStashFolder(
      options.name ?? "Fake Tabs",
    );

    const populate_folder = async (
      parent: Bookmarks.Folder,
      levels: number,
      path: string,
    ) => {
      if (levels > 0) {
        for (let i = 0; i < options.folder_count; ++i) {
          const f = await this.createStashFolder(undefined, parent);
          await populate_folder(f, levels - 1, `${path}-${i}`);
        }
      } else {
        for (let i = 0; i < options.tabs_per_folder; ++i) {
          await this.bookmarks.create({
            title: `Fake Tab #${i}`,
            url: `http://localhost/#${path}-${i}`,
            parentId: parent.id,
            index: i,
          });
        }
      }
    };

    await populate_folder(bench_folder, options.folder_levels, "root");
  }
  /* c8 ignore stop */
}

export type BookmarkTabsResult = {
  savedItems: StashItem[];
  bookmarks: Bookmarks.Node[];
  newFolderId?: string;
};

//
// Helpers for working with the mutators
//

/** Apply `copying()` to a set of stash items if `predicate` is true. */
export function copyIf(predicate: boolean, items: StashItem[]): StashItem[] {
  if (predicate) return copying(items);
  return items;
}

/** Given a set of stash items, transform them such that passing them to a
 * put*() model method will copy them instead of moving them, leaving the
 * original sources untouched. */
export function copying(items: StashItem[]): (NewTab | NewFolder)[] {
  return filterMap(items, item => {
    if (!isModelItem(item)) return item;

    if (isWindow(item)) {
      return {title: "", children: copying(item.children)};
    }

    if (isTabGroupExtent(item)) {
      return {title: item.group.title, children: copying(item.children)};
    }

    if (isTab(item)) return {title: item.title, url: item.url};

    if (isNode(item)) {
      if (item.type === "bookmark") {
        return {title: item.title, url: item.url};
      }
      if (isFolder(item)) {
        return {
          title: item.title,
          children: copying(item.children.filter(c => c !== undefined)),
        };
      }
      // Separators are excluded
    }
  });
}

//
// Public helper functions for sorting nodes
//

const sortTextCollator = new Intl.Collator(undefined, {
  usage: "sort",
  sensitivity: "base",
  numeric: true,
});
const sortURLCollator = new Intl.Collator(undefined, {
  usage: "sort",
  sensitivity: "variant",
  numeric: true,
});

export function sortByTitle(a: StashItem, b: StashItem): number {
  return sortTextCollator.compare(titleOf(a) ?? "", titleOf(b) ?? "");
}

export function sortByURL(a: StashItem, b: StashItem): number {
  const urlA = new URL("url" in a ? a.url : "about:blank");
  const urlB = new URL("url" in b ? b.url : "about:blank");

  const host_parts = (u: URL) => u.hostname.split(".").reverse();

  const a_parts = host_parts(urlA);
  const b_parts = host_parts(urlB);

  for (let i = 0; i < Math.min(a_parts.length, b_parts.length); ++i) {
    const cmp = sortURLCollator.compare(a_parts[i], b_parts[i]);
    if (cmp !== 0) return cmp;
  }

  const port_cmp = sortURLCollator.compare(urlA.port || "0", urlB.port || "0");
  if (port_cmp !== 0) return port_cmp;

  const path_cmp = sortURLCollator.compare(urlA.pathname, urlB.pathname);
  if (path_cmp !== 0) return path_cmp;

  const query_cmp = sortURLCollator.compare(urlA.search, urlB.search);
  if (query_cmp !== 0) return query_cmp;

  const hash_cmp = sortURLCollator.compare(urlA.hash, urlB.hash);
  if (hash_cmp !== 0) return hash_cmp;

  const scheme_cmp = sortURLCollator.compare(urlA.protocol, urlB.protocol);
  if (scheme_cmp !== 0) return scheme_cmp;

  return 0;
}

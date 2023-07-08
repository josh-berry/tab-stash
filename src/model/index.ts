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

import {
  backingOff,
  expect,
  filterMap,
  shortPoll,
  TaskMonitor,
  textMatcher,
  tryAgain,
  urlToOpen,
} from "../util";
import {trace_fn} from "../util/debug";
import {logError, logErrorsFrom, UserError} from "../util/oops";

import * as BookmarkMetadata from "./bookmark-metadata";
import * as Bookmarks from "./bookmarks";
import * as BrowserSettings from "./browser-settings";
import * as Containers from "./containers";
import * as DeletedItems from "./deleted-items";
import * as Favicons from "./favicons";
import * as Options from "./options";
import * as Tabs from "./tabs";
import {pathTo} from "./tree";
import {TreeFilter} from "./tree-filter";
import {TreeSelection} from "./tree-selection";

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

/** The StashItem is anything that can be placed in the stash.  It could already
 * be present as a tab (`id: number`), a bookmark (`id: string`), or not present
 * at all (no `id`).  It captures just the essential details of an item, like
 * its title, URL and identity (if it's part of the model). */
export type StashItem = NewTab | NewFolder | ModelItem;

export type StashLeaf = NewTab | Bookmarks.Bookmark | Tabs.Tab;

/** A container (bookmark folder or window) that is part of the model. */
export type ModelParent = Bookmarks.Folder | Tabs.Window;

/** An actual bookmark/tab that is part of the model. */
export type ModelItem = Bookmarks.Node | Tabs.Tab | Tabs.Window;

export type NewTab = {title?: string; url: string};
export type NewFolder = {title: string; children: (NewTab | NewFolder)[]};

export const isModelParent = (
  item: ModelItem | ModelParent,
): item is ModelParent => "children" in item;

export const isModelItem = (item: StashItem): item is ModelItem => "id" in item;

export const isWindow = (item: StashItem): item is Tabs.Window =>
  "id" in item && typeof item.id === "number" && "children" in item;

export const isTab = (item: StashItem): item is Tabs.Tab =>
  "id" in item && typeof item.id === "number" && !("children" in item);

export const isNode = (item: StashItem): item is Bookmarks.Node =>
  "id" in item && typeof item.id === "string";

export const isBookmark = (item: StashItem): item is Bookmarks.Bookmark =>
  isNode(item) && Bookmarks.isBookmark(item);

export const isFolder = (item: StashItem): item is Bookmarks.Folder =>
  isNode(item) && Bookmarks.isFolder(item);

export const isNewItem = (item: StashItem): item is NewTab | NewFolder =>
  !("id" in item);

export const isNewTab = (item: StashItem): item is NewTab =>
  !("id" in item) && "url" in item;

export const isNewFolder = (item: StashItem): item is NewFolder =>
  !("id" in item) && "children" in item;

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
  readonly filter: TreeFilter<
    Tabs.Window | Bookmarks.Folder,
    Bookmarks.Node | Tabs.Tab
  >;

  /** This is a bit of volatile metadata that tracks whether children that don't
   * match the filter should be shown in the UI or not.  We need it here because
   * the selection model depends on it for knowing which items in a range are
   * visible when doing a multi-select. */
  readonly showFilteredChildren = new WeakMap<ModelItem, Ref<boolean>>();

  readonly selection: TreeSelection<ModelParent, ModelItem>;

  constructor(src: Source) {
    this.browser_settings = src.browser_settings;
    this.options = src.options;

    this.tabs = src.tabs;
    this.containers = src.containers;
    this.bookmarks = src.bookmarks;
    this.deleted_items = src.deleted_items;

    this.favicons = src.favicons;
    this.bookmark_metadata = src.bookmark_metadata;

    this.filter = new TreeFilter(
      isModelParent,
      computed(() => {
        const searchText = this.searchText.value;
        if (!searchText) return _ => true;

        const matcher = textMatcher(searchText);
        return node =>
          ("title" in node && matcher(node.title)) ||
          ("url" in node && matcher(node.url));
      }),
    );

    this.selection = new TreeSelection(
      isModelParent,
      computed(() =>
        filterMap(
          [this.tabs.targetWindow.value, this.bookmarks.stash_root.value],
          i => i,
        ),
      ),
    );

    this.selection.rangeSelectPredicate = item => {
      // This is super ugly because it mimics logic that is spread around
      // various parts of the UI which determines whether a tab is visible or
      // not.  Ugh.

      if (isTab(item)) {
        if (item.pinned || item.hidden) return false;

        if (
          this.options.sync.state.show_open_tabs === "unstashed" &&
          this.bookmarks.isURLStashed(item.url)
        ) {
          return false;
        }
      }

      if (this.filter.info(item).isMatching) return true;

      const parent = item.position?.parent;
      if (parent && this.showFilteredChildren.get(parent)?.value) return true;

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
      logErrorsFrom(async () => this.reload());
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
    // istanbul ignore next
    else throw new Error(`Invalid model ID: ${id}`);
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

    // Tab Stash URLs are never stashable.
    return !url_str.startsWith(browser.runtime.getURL(""));
  }

  /** If the topmost folder in the stash root is an unnamed folder which was
   * created recently, return its ID.  Otherwise return `undefined`.  Used to
   * determine where to place single bookmarks we are trying to stash, if we
   * don't already know where they should go. */
  mostRecentUnnamedFolder(): Bookmarks.Folder | undefined {
    const root = this.bookmarks.stash_root.value;
    if (!root) return undefined;

    const topmost: Bookmarks.Node | undefined = root.children[0];

    // Is there a top-most item under the root folder, and is it a folder?
    if (!topmost || !isFolder(topmost)) return undefined;

    // Does the folder have a name which looks like a default name?
    if (!Bookmarks.getDefaultFolderNameISODate(topmost.title)) return undefined;

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
  stashableTabsInWindow(windowId: Tabs.WindowID): Tabs.Tab[] {
    const win = expect(
      this.tabs.window(windowId),
      () => `Trying to stash tabs to unknown window ${windowId}`,
    );
    const tabs = win.children.filter(t => !t.hidden);

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

    await this.deleted_items.dropOlderThan(deleted_exp);
    await this.favicons.gc(
      url =>
        this.bookmarks.bookmarksWithURL(url).size > 0 ||
        this.tabs.tabsWithURL(url).size > 0,
    );
    await this.bookmark_metadata.gc(
      id =>
        id === BookmarkMetadata.CUR_WINDOW_MD_ID ||
        !!this.bookmarks.node(id as Bookmarks.NodeID),
    );
  }

  /** Stashes all eligible tabs in the specified window, leaving the existing
   * tabs open if `copy` is true. */
  async stashAllTabsInWindow(
    window: Tabs.WindowID,
    options: {
      copy?: boolean;
      parent?: Bookmarks.NodeID;
      position?: "top" | "bottom";
    },
  ) {
    const tabs = this.stashableTabsInWindow(window);
    if (tabs.length === 0) return;

    await this.putItemsInFolder({
      items: this.copyIf(!!options.copy, tabs),
      toFolderId: (
        await this.bookmarks.createStashFolder(
          undefined,
          options.parent,
          options.position,
        )
      ).id,
    });
  }

  /** Put the set of currently-selected items in the specified folder
   * when the toFolderId option is set, otherwise the current window.
   *
   * Note: When copying is disabled, the source items will be deselected. */
  async putSelectedIn(options?: {
    copy?: boolean;
    toFolderId?: Bookmarks.NodeID;
  }) {
    const from_items = Array.from(this.selection.selectedItems());
    const items = this.copyIf(options?.copy === true, from_items);

    let affected_items: StashItem[];
    if (options?.toFolderId === undefined) {
      affected_items = await this.putItemsInWindow({items});
    } else {
      affected_items = await this.putItemsInFolder({
        items,
        toFolderId: options.toFolderId,
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
    toFolderId: Bookmarks.NodeID;
  }) {
    await this.putSelectedIn(options);
  }

  /** Hide/discard/close the specified tabs, according to the user's settings
   * for what to do with stashed tabs.  Creates a new tab if necessary to keep
   * the browser window(s) open. */
  async hideOrCloseStashedTabs(tabIds: Tabs.TabID[]): Promise<void> {
    await this.tabs.refocusAwayFromTabs(tabIds);

    // Clear any highlights/selections on tabs we are stashing
    await Promise.all(
      tabIds.map(tid => browser.tabs.update(tid, {highlighted: false})),
    );
    filterMap(tabIds, id => this.tabs.tab(id))
      .map(t => this.selection.info(t))
      .forEach(si => (si.isSelected = false));

    // istanbul ignore else -- hide() is always available in tests
    if (browser.tabs.hide) {
      // If the browser supports hiding tabs, then hide or close them
      // according to the user's preference.
      switch (this.options.local.state.after_stashing_tab) {
        case "hide_discard":
          await browser.tabs.hide(tabIds);
          await browser.tabs.discard(tabIds);
          break;
        case "close":
          await this.tabs.remove(tabIds);
          break;
        case "hide":
        default:
          await browser.tabs.hide(tabIds);
          break;
      }
    } else {
      // The browser does not support hiding tabs, so our only option is
      // to close them.
      await this.tabs.remove(tabIds);
    }
  }

  /** Restores the specified URLs as new tabs in the current window.  Returns
   * the IDs of the restored tabs.
   *
   * Note that if a tab is already open and not hidden, we will do nothing,
   * since we don't want to open duplicate tabs.  Such tabs will not be
   * included in the returned list. */
  async restoreTabs(
    items: StashLeaf[],
    options: {background?: boolean},
  ): Promise<Tabs.Tab[]> {
    const toWindow = this.tabs.targetWindow.value;
    if (toWindow === undefined) {
      throw new Error(`No target window; not sure where to restore tabs`);
    }

    // As a special case, if we are restoring just a single tab, first check
    // if we already have the tab open and just switch to it.  (No need to
    // disturb the ordering of tabs in the browser window.)
    if (!options.background && items.length === 1 && items[0].url) {
      const t = Array.from(this.tabs.tabsWithURL(items[0].url)).find(
        t => !t.hidden && t.position?.parent === toWindow,
      );
      if (t) {
        await browser.tabs.update(t.id, {active: true});
        return [t];
      }
    }

    // We want to know what tabs are currently open in the window, so we can
    // avoid opening duplicates.
    const win_tabs = toWindow.children;

    // We want to know which tab the user is currently looking at so we can
    // close it if it's just the new-tab page.
    const active_tab = win_tabs.filter(t => t.active)[0];

    const tabs = await this.putItemsInWindow({
      items: this.copying(items),
      toWindowId: toWindow.id,
    });

    if (!options.background) {
      // Switch to the last tab that we restored (if desired).  We choose
      // the LAST tab to behave similarly to the user having just opened a
      // bunch of tabs.
      if (tabs.length > 0) {
        await browser.tabs.update(tabs[tabs.length - 1].id, {active: true});
      }

      // Finally, if we opened at least one tab, AND we were looking at
      // the new-tab page, close the new-tab page in the background.
      if (
        active_tab &&
        tabs.length > 0 &&
        this.browser_settings.isNewTabURL(active_tab.url ?? "") &&
        active_tab.status === "complete"
      ) {
        browser.tabs.remove([active_tab.id]).catch(console.log);
      }
    }

    return tabs;
  }

  /** Returns the ID of an unnamed folder at the top of the stash, creating a
   * new one if necessary. */
  async ensureRecentUnnamedFolder(): Promise<Bookmarks.Folder> {
    const folder = this.mostRecentUnnamedFolder();
    if (folder !== undefined) return folder;
    return await this.bookmarks.createStashFolder();
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
    toFolderId: Bookmarks.NodeID;
    toIndex?: number;
    allowDuplicates?: boolean;
    task?: TaskMonitor;
  }): Promise<Bookmarks.Node[]> {
    // First we try to find the folder we're moving to.
    const to_folder = expect(
      this.bookmarks.folder(options.toFolderId),
      () => `Destination folder does not exist: ${options.toFolderId}`,
    );

    const items = options.items;

    // Note: We explicitly DON'T check stashability here because the caller
    // has presumably done this for us--and has explicitly chosen what to
    // put in the folder.

    // Check if we're trying to move a parent into itself or one of its children
    const cyclic_sources = pathTo<Bookmarks.Folder, Bookmarks.Node>(
      to_folder,
    ).map(p => p.parent.id);
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
    const close_tab_ids: Tabs.TabID[] = [];

    for (
      let i = 0, to_index = options.toIndex ?? to_folder.children.length;
      i < items.length;
      ++i, ++to_index, options.task && ++options.task.value
    ) {
      const item = items[i];
      const model_item = isModelItem(item) ? this.item(item.id) : undefined;

      // If it's a bookmark node, just move it directly.
      if (model_item && isNode(model_item)) {
        const pos = model_item.position;
        await this.bookmarks.move(model_item.id, to_folder.id, to_index);
        moved_items.push(model_item);
        dont_steal_bms.add(model_item.id);

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

      // If it's a tab, mark the tab for closure.
      if (isTab(item)) close_tab_ids.push(item.id);

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
                "url" in bm &&
                bm.url === item.url &&
                (item.title ? item.title === bm.title : true),
            )
          : [];
      if (already_there.length > 0) {
        // We found a duplicate in the folder already; move it into position.
        node = already_there[0];

        const pos = node.position;
        await this.bookmarks.move(node.id, to_folder.id, to_index);
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
          const node =
            "url" in item
              ? await this.bookmarks.create({
                  title: item.title || item.url,
                  url: item.url,
                  parentId,
                  index,
                })
              : await this.bookmarks.create({
                  title:
                    ("title" in item && item.title) ||
                    Bookmarks.genDefaultFolderName(new Date()),
                  parentId,
                  index,
                });

          if ("children" in item) {
            let idx = 0;
            for (const c of item.children) {
              if (typeof c === "string") {
                await this.bookmarks.move(c, node.id, idx);
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
    await this.hideOrCloseStashedTabs(close_tab_ids);

    return moved_items;
  }

  /** Move or copy items (bookmarks, tabs, and/or external items) to a
   * particular location in a particular window.  Tabs which are
   * moved/created/restored will NOT be active (i.e. they will always be in
   * the background).
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
    toWindowId?: Tabs.WindowID;
    toIndex?: number;
    task?: TaskMonitor;
  }): Promise<Tabs.Tab[]> {
    const to_win_id = options.toWindowId ?? this.tabs.targetWindow.value?.id;
    if (to_win_id === undefined) {
      throw new Error(`No target window available: ${to_win_id}`);
    }
    const win = expect(
      this.tabs.window(to_win_id),
      () => `Trying to put items in unknown window ${to_win_id}`,
    );

    const items = options.items;

    // We want to know what tabs were recently closed, so we can
    // restore/un-hide tabs as appropriate.
    //
    // TODO Unit tests don't support sessions yet
    //
    // TODO Known to be buggy on some Firefoxen, see #188.  If nobody
    // complains, probably this whole path should just be removed.
    //
    // istanbul ignore if -- as above
    const closed_tabs =
      !!browser.sessions?.getRecentlyClosed &&
      this.options.local.state.ff_restore_closed_tabs
        ? await browser.sessions.getRecentlyClosed()
        : [];

    if (options.task) options.task.max = items.length + 1;

    // Keep track of which tabs we are moving/have already stolen.  A tab
    // can be "stolen" if we have a non-tab item with a URL that matches a
    // tab which we are not already moving--in this case, we "steal" the
    // already-open tab so we don't have to open a duplicate.
    const dont_steal_tabs = new Set<Tabs.TabID>(
      filterMap(items, i => {
        if (!isTab(i)) return undefined;
        return i.id;
      }),
    );

    // console.log('options', options);
    // console.log('dont_steal_tabs', dont_steal_tabs);

    // Now, we move/restore tabs.
    const moved_items: Tabs.Tab[] = [];
    const delete_bm_ids: Bookmarks.Bookmark[] = [];

    for (
      let i = 0, to_index = options.toIndex ?? win.children.length;
      i < items.length;
      ++i, ++to_index, options.task && ++options.task.value
    ) {
      const item = items[i];
      const model_item = "id" in item ? this.item(item.id) : undefined;

      // console.log('processing', item);

      // If the item we're moving is a tab, just move it into place.
      if (model_item && isTab(model_item)) {
        const pos = model_item.position;
        await this.tabs.move(model_item.id, to_win_id, to_index);
        moved_items.push(model_item);
        dont_steal_tabs.add(model_item.id);

        if (pos && pos.parent === win && pos.index < to_index) {
          // This is a rotation in the same window; since move() first
          // removes and then adds the tab, we need to decrement
          // toIndex so the moved tab ends up in the right place.
          --to_index;
        }
        // console.log('moved tab', model_item, 'to position', {to_win_id, to_index});
        continue;
      }

      // If we're "moving" a bookmark into a window, mark the bookmark
      // for deletion later.
      if (model_item && isBookmark(model_item)) delete_bm_ids.push(model_item);

      // If the item we're moving is not a tab, we need to create a
      // new tab or restore an old one from somewhere else.

      if (!("url" in item)) {
        // No URL? Don't bother restoring anything.  This means we will skip
        // over nested folders entirely.  We do this because there's no way to
        // represent a tree of tabs in the UI.
        --to_index;
        // console.log('item has no URL', item);
        continue;
      }
      const url = item.url;

      // First let's see if we have another tab we can just "steal"--that
      // is, move into place to represent the source item (which,
      // remember, is NOT ITSELF A TAB).
      //
      // There is a dual purpose here--we want to reuse hidden tabs where
      // possible, but we also try to move other tabs from the current
      // window so that we don't end up creating duplicates for the user.
      const already_open = Array.from(this.tabs.tabsWithURL(url))
        .filter(
          t =>
            !dont_steal_tabs.has(t.id) &&
            !t.pinned &&
            (t.hidden || t.position?.parent.id === to_win_id),
        )
        .sort((a, b) => -a.hidden - -b.hidden); // prefer hidden tabs
      if (already_open.length > 0) {
        const t = already_open[0];
        const pos = t.position;
        // console.log('already-open tab: ', t, pos);
        // console.log('existing layout:', this.tabs.window(t.windowId)?.tabs);

        // First move the tab into place, and then show it (if hidden).
        // If we show and then move, it will briefly appear in a random
        // location before moving to the desired location, so doing the
        // move first reduces flickering in the UI.
        await this.tabs.move(t.id, to_win_id, to_index);
        if (t.hidden && !!browser.tabs.show) await browser.tabs.show(t.id);

        // console.log('new layout:', this.tabs.window(t.windowId)?.tabs);

        if (pos && pos.parent === win && pos.index < to_index) --to_index;
        moved_items.push(t);
        dont_steal_tabs.add(t.id);
        this.selection.info(t).isSelected =
          isModelItem(item) && this.selection.info(item).isSelected;
        // console.log('moved already-open tab', t);
        continue;
      }

      // If we don't have a tab to move, let's see if a tab was recently
      // closed that we can restore.
      const closed = filterMap(closed_tabs, s => s.tab).find(
        tabLookingAtP(url),
      );
      // istanbul ignore next - per Firefox bug noted above, see #188
      if (closed) {
        console.log(`Restoring recently-closed tab for URL: ${url}`, closed);
        // Remember the active tab in this window (if any), because
        // restoring a recently-closed tab will disturb the focus.
        const active_tab = win.children.find(t => t.active);

        const t = (await browser.sessions.restore(closed.sessionId!)).tab!;
        await browser.tabs.move(t.id!, {windowId: to_win_id, index: to_index});

        // Reset the focus to the previously-active tab. (We do this
        // immediately, inside the loop, so as to minimize any
        // flickering the user might see.)
        if (active_tab) {
          await browser.tabs.update(active_tab.id, {active: true});
        }

        const tab = await shortPoll(
          () => this.tabs.tab(t.id as Tabs.TabID) || tryAgain(),
        );
        moved_items.push(tab);
        dont_steal_tabs.add(tab.id);
        this.selection.info(tab).isSelected =
          isModelItem(item) && this.selection.info(item).isSelected;
        // console.log('restored recently-closed tab', tab);
        continue;
      }

      // Else we just need to create a completely new tab.
      const tab = await this.tabs.create({
        active: false,
        discarded: this.options.local.state.load_tabs_on_restore === "lazily",
        title: item.title,
        url: urlToOpen(url),
        windowId: to_win_id,
        index: to_index,
      });
      moved_items.push(tab);
      dont_steal_tabs.add(tab.id);
      this.selection.info(tab).isSelected =
        isModelItem(item) && this.selection.info(item).isSelected;
      // console.log('created new tab', tab);
    }

    // Delete bookmarks for all the tabs we restored.  We use the same
    // timestamp for each deleted item so that we can guarantee the deleted
    // items are sorted in the same order they were listed in the stash
    // (which makes it easier for users to find things).
    const now = new Date();
    await Promise.all(delete_bm_ids.map(bm => this.deleteBookmark(bm, now)));
    if (options.task) ++options.task.value;

    return moved_items;
  }

  /** Deletes the specified items (bookmark nodes or tabs), saving any deleted
   * bookmarks to the deleted-items model. */
  async deleteItems(items: Iterable<ModelItem>) {
    const now = new Date();
    const tabs = [];
    const windows = [];

    for (const i of items) {
      if (isNode(i)) {
        if (isFolder(i)) {
          await this.deleteBookmarkTree(i.id, now);
        } else if (isBookmark(i)) {
          await this.deleteBookmark(i, now);
        } else {
          // separator
          await this.bookmarks.remove(i.id);
        }
      } else if (isTab(i)) {
        tabs.push(i.id);
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
  async deleteBookmarkTree(id: Bookmarks.NodeID, deleted_at?: Date) {
    const bm = this.bookmarks.node(id);
    if (!bm) return; // Already deleted?

    const toDelItem = (item: Bookmarks.Node): DeletedItems.DeletedItem => {
      if (isFolder(item)) {
        return {
          title: item.title,
          children: item.children.map(i => toDelItem(i)),
        };
      }

      if (isBookmark(item)) {
        return {
          title: item.title,
          url: item.url,
          favIconUrl:
            this.favicons.get(item.url!).value?.favIconUrl || undefined,
        };
      }

      return {title: "", url: ""};
    };

    await this.deleted_items.add(toDelItem(bm), undefined, deleted_at);
    await this.bookmarks.removeTree(bm.id);
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
        favIconUrl: this.favicons.get(bm.url!)?.value?.favIconUrl || undefined,
      },
      parent
        ? {
            folder_id: parent.id,
            title: parent.title!,
          }
        : undefined,
      deleted_at,
    );

    await this.bookmarks.remove(bm.id);
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
    let toFolderId: Bookmarks.NodeID | undefined;
    let toIndex: number | undefined;
    if (deletion.deleted_from && (!path || path.length == 0)) {
      const from = deletion.deleted_from;
      const folder = this.bookmarks.folder(from.folder_id as Bookmarks.NodeID);
      if (folder) {
        // The exact folder we want still exists, use it
        toFolderId = from.folder_id as Bookmarks.NodeID;
      } else {
        // Search for an existing folder inside the stash root with
        // the same name as the folder it was deleted from.
        const child = stash_root.children.find(
          c => "children" in c && c.title === from.title,
        );
        if (child) toFolderId = child.id;
      }
    }

    // If we still don't know where it came from or its prior containing folder
    // was deleted, AND the item we're restoring is not itself a folder, just
    // put it in an unnamed folder.
    if (!toFolderId) {
      if (!("children" in item)) {
        toFolderId = (await this.ensureRecentUnnamedFolder()).id;
      } else {
        // We're restoring a folder, and we don't know where to put it; just put
        // it in the stash root.
        toFolderId = stash_root.id;
        toIndex = 0;
      }
    }

    // Restore the deleted item.
    await this.putItemsInFolder({items: [item], toFolderId, toIndex});

    // Restore any favicons.
    const restoreFavicons = (item: DeletedItems.DeletedItem) => {
      if ("url" in item && "favIconUrl" in item) {
        this.favicons.maybeSet(item.url, item);
      }
      if ("children" in item) {
        for (const c of item.children) restoreFavicons(c);
      }
    };
    restoreFavicons(item);

    // Remove the item we just restored.
    await di.drop(deletion.key, path);
  }

  //
  // Helpers for working with the mutators
  //

  /** Apply `copying()` to a set of stash items if `predicate` is true. */
  copyIf(predicate: boolean, items: StashItem[]): StashItem[] {
    if (predicate) return this.copying(items);
    return items;
  }

  /** Given a set of stash items, transform them such that passing them to a
   * put*() model method will copy them instead of moving them, leaving the
   * original sources untouched. */
  copying(items: StashItem[]): (NewTab | NewFolder)[] {
    return filterMap(items, item => {
      if (isNewItem(item)) return item;

      if (isWindow(item)) {
        return {title: "", children: this.copying(item.children)};
      }

      if (isTab(item)) return {title: item.title, url: item.url};

      if (isNode(item)) {
        if (Bookmarks.isBookmark(item)) {
          return {title: item.title, url: item.url};
        }
        if (isFolder(item)) {
          return {
            title: item.title,
            children: this.copying(item.children),
          };
        }
        // Separators are excluded
      }
    });
  }
}

export type BookmarkTabsResult = {
  savedItems: StashItem[];
  bookmarks: Bookmarks.Node[];
  newFolderId?: string;
};

//
// Private helper functions
//

/** Returns a function which returns true if a tab is looking at a particular
 * URL, taking into account any transformations done by urlToOpen(). */
function tabLookingAtP(url: string): (t?: {url?: string}) => boolean {
  const open_url = urlToOpen(url);
  return (t?: {url?: string}) => {
    if (!t || !t.url) return false;
    const to_url = urlToOpen(t.url);
    return (
      t.url === url ||
      t.url === open_url ||
      to_url === url ||
      to_url === open_url
    );
  };
}

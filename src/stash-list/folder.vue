<template>
  <div
    :class="{
      'forest-item': true,
      selectable: true,
      folder: true,
      'action-container': true,
      'has-open-tabs': openTabsCount > 0,
      collapsed: collapsed,
      selected: selectionInfo.isSelected,
      'no-match': !filterInfo.isMatching,
      'has-matching-children': filterInfo.hasMatchInSubtree,
    }"
  >
    <item-icon
      v-if="!isToplevel"
      :class="{
        'forest-icon': true,
        action: true,
        select: true,
      }"
      default-icon="folder"
      selectable
      :selected="selectionInfo.isSelected"
      @click.prevent.stop="select"
    />

    <a
      :class="{
        'forest-collapse': true,
        action: true,
        collapse: !collapsed,
        expand: collapsed,
      }"
      :title="`Hide the tabs for this group (hold ${altKey} to hide tabs for child groups)`"
      @click.prevent.stop="toggleCollapsed"
    />
    <ButtonBox v-if="!isRenaming && selectedCount === 0" class="forest-toolbar">
      <a
        class="action stash here"
        :title="`Stash all (or highlighted) open tabs to this group (hold ${altKey} to keep tabs open)`"
        @click.prevent.stop="stash"
      />
      <a
        class="action stash one here"
        :title="
          `Stash the active tab to this group ` +
          `(hold ${altKey} to keep tabs open)`
        "
        @click.prevent.stop="stashOne"
      />
      <a
        class="action restore"
        :title="
          `Open all tabs in this group ` +
          `(hold ${bgKey} to open in background)`
        "
        @click.prevent.stop="restoreAll"
      />
      <a
        class="action restore-remove"
        :title="
          (folder.$stats.folderCount === 0
            ? `Open all tabs and delete this group`
            : `Open all tabs and remove them from this group`) +
          ` (hold ${bgKey} to open in background)`
        "
        @click.prevent.stop="restoreAndRemove"
      />
      <Menu
        summaryClass="action neutral icon-item-menu last-toolbar-button"
        h-position="right"
      >
        <button
          @click.prevent="newChildFolder"
          :title="`Create a new sub-group within this group`"
        >
          <span class="menu-icon icon icon-new-empty-group"></span>
          <span>New Child Group</span>
        </button>

        <button
          @click.prevent="stashToNewChildFolder"
          title="Stash all open tabs to a new child group"
        >
          <span class="menu-icon icon icon-stash" />
          <span>Stash Tabs to New Child Group</span>
        </button>

        <hr />

        <button
          v-if="isToplevel"
          @click.prevent="moveSelfToChild"
          title="Move this group inside a new top-level group"
        >
          <span class="menu-icon icon icon-pop-in" />
          <span>Convert to Child Group</span>
        </button>
        <button
          v-else
          @click.prevent="moveSelfToTopLevel"
          title="Move this group up to the top level"
        >
          <span class="menu-icon icon icon-pop-out" />
          <span>Convert to Top-Level Group</span>
        </button>

        <template v-if="unstashedOrOpenTabs.length > 0">
          <hr />
          <div class="menu-item disabled status-text">
            <span>Stash to "{{ title }}":</span>
          </div>
          <ul class="menu-scrollable-list">
            <li v-for="t of unstashedOrOpenTabs" :key="t.tab.id">
              <a
                :href="t.tab.url"
                :title="`Stash tab to this group (hold ${altKey} to keep tab open)`"
                @click.prevent.stop="stashSpecificTab($event, t.tab)"
              >
                <item-icon
                  class="menu-icon"
                  default-icon="tab"
                  :src="t.tab.favIconUrl"
                />
                <span>{{ t.tab.title }}</span>
                <span
                  v-if="t.stashedIn.length > 0"
                  class="menu-icon icon icon-stashed status-text"
                  :title="
                    ['This tab is stashed in:', ...t.stashedIn].join('\n')
                  "
                />
              </a>
            </li>
          </ul>
        </template>

        <hr />
        <button
          @click.prevent="closeStashedTabs"
          :title="`Close any open tabs that are stashed in this group`"
        >
          <span class="menu-icon icon icon-delete-stashed" />
          <span>Close Stashed Tabs</span>
        </button>
        <hr />
        <button
          title="Delete the whole group and all its tabs and child groups"
          @click.prevent="remove"
        >
          <span class="menu-icon icon icon-delete"></span>
          <span>Delete Group</span>
        </button>
      </Menu>
    </ButtonBox>

    <ButtonBox
      v-else-if="!isRenaming && canMoveIntoFolder"
      class="forest-toolbar"
    >
      <a
        class="action stash here"
        :title="`Move ${selectedCount} selected item(s) to this group (hold ${altKey} to copy)`"
        @click.prevent.stop="move"
      />
      <a
        class="action stash newgroup"
        :title="`Move ${selectedCount} selected item(s) to a new child group (hold ${altKey} to copy)`"
        @click.prevent.stop="moveToChild"
      />
    </ButtonBox>

    <span
      v-if="!isRenaming"
      class="forest-title editable"
      :title="tooltip"
      @click.stop="isRenaming = true"
      >{{ title }}</span
    >
    <async-text-input
      v-else
      class="forest-title editable"
      :title="tooltip"
      :value="nonDefaultTitle"
      :defaultValue="defaultTitle"
      :save="rename"
      @done="isRenaming = false"
    />
  </div>

  <load-more
    v-if="!isVisible || !folder.isLoaded"
    :load="loadMore"
    :is-fully-loaded="false"
  />

  <dnd-list
    v-else
    :class="{'forest-children': true, collapsed}"
    v-model="children"
    :item-key="(item: Node) => item.id"
    :item-accepts-drop-inside="childAcceptsDropInside"
    parent-accepts-drop="end"
    :accepts="accepts"
    :drag="drag"
    :drop="drop"
    orientation="vertical"
  >
    <template #item="{item}: {item: Node}">
      <template v-if="isChildVisible(item)">
        <child-folder v-if="isFolder(item)" :folder="item" />
        <bookmark v-else-if="isBookmark(item)" :bookmark="item" />
      </template>
    </template>
  </dnd-list>

  <ul
    v-if="filterInfo.nonMatchingCount > 0"
    :class="{'forest-children': true, collapsed}"
  >
    <li>
      <show-filtered-item
        v-model:visible="showFiltered"
        :count="filterInfo.nonMatchingCount"
      />
    </li>
  </ul>
</template>

<script lang="ts">
import {defineComponent, ref, type PropType} from "vue";

import {
  altKeyName,
  bgKeyName,
  bgKeyPressed,
  filterMap,
  required,
} from "../util/index.js";

import the from "../globals-ui.js";
import type {BookmarkMetadataEntry} from "../model/bookmark-metadata.js";
import {
  friendlyFolderName,
  genDefaultFolderName,
  getDefaultFolderNameISODate,
  isBookmark,
  isFolder,
  type Bookmark,
  type Folder,
  type Node,
} from "../model/bookmarks.js";
import {copyIf} from "../model/index.js";
import type {Tab, Window} from "../model/tabs.js";
import {pathTo} from "../model/tree.js";

import AsyncTextInput from "../components/async-text-input.vue";
import ButtonBox from "../components/button-box.vue";
import DndList from "../components/dnd-list.vue";
import ItemIcon from "../components/item-icon.vue";
import Menu from "../components/menu.vue";
import ShowFilteredItem from "../components/show-filtered-item.vue";
import BookmarkVue from "./bookmark.vue";
import LoadMore from "../components/load-more.vue";

import type {DragAction, DropAction} from "../components/dnd.js";
import {ACCEPTS, recvDragData, sendDragData} from "./dnd-proto.js";

type NodeWithTabs = {
  node: Node;
  tabs: Tab[];
};

export default defineComponent({
  name: "child-folder",

  components: {
    AsyncTextInput,
    ButtonBox,
    DndList: DndList<Node>,
    Bookmark: BookmarkVue,
    ItemIcon,
    Menu,
    ShowFilteredItem,
    LoadMore,
  },

  props: {
    folder: required(Object as PropType<Folder>),
    isToplevel: Boolean,
  },

  data: () => ({
    isRenaming: false,
    isVisible: false,
  }),

  computed: {
    altKey: altKeyName,
    bgKey: bgKeyName,

    accepts() {
      return ACCEPTS;
    },

    filterInfo() {
      return the.model.filter.info(this.folder);
    },
    selectionInfo() {
      return the.model.selection.info(this.folder);
    },

    showFiltered: {
      get(): boolean {
        let f = the.model.showFilteredChildren.get(this.folder);
        if (!f) {
          f = ref(false);
          the.model.showFilteredChildren.set(this.folder, f);
        }
        return f.value;
      },
      set(v: boolean) {
        let f = the.model.showFilteredChildren.get(this.folder);
        if (!f) {
          f = ref(false);
          the.model.showFilteredChildren.set(this.folder, f);
        }
        f.value = v;
      },
    },

    metadata(): BookmarkMetadataEntry {
      return the.model.bookmark_metadata.get(this.folder.id);
    },

    targetWindow(): Window | undefined {
      return the.model.tabs.targetWindow.value;
    },

    childrenWithTabs(): readonly NodeWithTabs[] {
      const tab_model = the.model.tabs;
      return this.children.map(n => ({
        node: n,
        tabs:
          isBookmark(n) && n.url
            ? Array.from(tab_model.tabsWithURL(n.url)).filter(
                t => t.position?.parent === this.targetWindow,
              )
            : [],
      }));
    },

    childTabStats(): {open: number; discarded: number; hidden: number} {
      let open = 0,
        discarded = 0,
        hidden = 0;
      for (const nwt of this.childrenWithTabs) {
        for (const tab of nwt.tabs) {
          if (tab.position?.parent !== this.targetWindow) {
            continue;
          }
          if (tab.hidden) {
            hidden += 1;
          } else if (tab.discarded) {
            discarded += 1;
          } else {
            open += 1;
          }
        }
      }
      return {open, discarded, hidden};
    },

    openTabsCount(): number {
      return this.childTabStats.open + this.childTabStats.discarded;
    },

    collapsed: {
      get(): boolean {
        if (this.metadata.value === undefined) {
          return the.model.options.sync.state.show_new_folders === "collapsed";
        }

        return !!this.metadata.value.collapsed;
      },
      set(collapsed: boolean) {
        the.model.bookmark_metadata.setCollapsed(this.metadata.key, collapsed);
      },
    },

    // Used to populate a menu of tabs to select for stashing here
    unstashedOrOpenTabs(): {tab: Tab; stashedIn: string[]}[] {
      const target_win = the.model.tabs.targetWindow.value;
      if (!target_win) return [];

      return target_win.children
        .filter(
          t =>
            !t.pinned &&
            !t.hidden &&
            the.model.isURLStashable(t.url) &&
            (!the.model.bookmarks.isURLLoadedInStash(t.url) ||
              the.model.options.sync.state.show_open_tabs !== "unstashed"),
        )
        .map(tab => ({
          tab,
          stashedIn: the.model.bookmarks
            .loadedFoldersInStashWithURL(tab.url)
            .map(f => friendlyFolderName(f.title)),
        }));
    },

    /** Returns a "default" name to use if no explicit name is set.  This
     * default is typically a timestamp with one of two sources--if the
     * folder has a title that looks like a "default" title, we use that.
     * Otherwise we generate the default name from the folder's creation
     * time.
     *
     * This approach handles unnamed folders which were synced from
     * elsewhere and thus have a creation time that isn't their actual
     * creation time. */
    defaultTitle(): string {
      const unfiltered = this.folder;
      if (getDefaultFolderNameISODate(unfiltered.title) !== null) {
        return friendlyFolderName(unfiltered.title);
      } else {
        return `Saved ${new Date(unfiltered.dateAdded || 0).toLocaleString()}`;
      }
    },
    nonDefaultTitle(): string {
      return getDefaultFolderNameISODate(this.folder.title) !== null
        ? ""
        : this.folder.title;
    },
    title(): string {
      return friendlyFolderName(this.folder.title);
    },
    tooltip(): string {
      const bm_stats = this.folder.$stats;
      const st = this.childTabStats;
      const statstip = `${bm_stats.folderCount} child group${
        bm_stats.folderCount !== 1 ? "s" : ""
      }, ${bm_stats.bookmarkCount} stashed tab${
        bm_stats.bookmarkCount != 1 ? "s" : ""
      } (${st.open} open, ${st.discarded} unloaded, ${st.hidden} hidden)`;
      return `${this.title}\n${statstip}`;
    },

    children(): Node[] {
      if (this.folder.isLoaded) return this.folder.children as Node[];
      return [];
    },

    leafChildren(): Bookmark[] {
      return filterMap(this.children, c => (isBookmark(c) ? c : undefined));
    },

    selectedCount(): number {
      return the.model.selection.selectedCount.value;
    },

    canMoveIntoFolder(): boolean {
      return !the.model.selection.isSelfOrParentSelected(this.folder);
    },
  },

  methods: {
    attempt(fn: () => Promise<void>): Promise<void> {
      return the.model.attempt(fn);
    },

    async loadMore(): Promise<void> {
      // A very cursed hack: the model should be fully-loaded eagerly at
      // startup, but most of the page load time is actually just creating DOM
      // elements. So instead, we hide our children by default, and if the
      // folder actually comes into view, then we actually populate the DOM.
      this.isVisible = true;

      // The folder should be fully-loaded already, but just in case, we trigger
      // loading again anyway.
      await the.model.bookmarks.loaded(this.folder);
    },

    isFolder,
    isBookmark,

    toggleCollapsed(ev: MouseEvent) {
      if (!ev.altKey) {
        // We're just toggling ourself.
        this.collapsed = !this.collapsed;
        return;
      }

      // Toggle the collapsed state of all the child folders
      const folders = filterMap(this.children, c =>
        "children" in c ? c : undefined,
      );
      if (folders.length === 0) return;

      // We just snoop on the collapsed state of the first folder because it's
      // easier
      const collapsed =
        the.model.bookmark_metadata.get(folders[0].id).value?.collapsed ||
        false;
      for (const f of folders) {
        the.model.bookmark_metadata.setCollapsed(f.id, !collapsed);
      }
    },

    select(ev: MouseEvent) {
      the.model.attempt(async () => {
        the.model.selection.toggleSelectFromEvent(ev, this.folder);
      });
    },

    isChildVisible(node: Node): boolean {
      const fi = the.model.filter.info(node);
      const si = the.model.selection.info(node);
      return (
        this.isValidChild(node) &&
        (this.showFiltered ||
          fi.hasMatchInSubtree ||
          si.isSelected ||
          si.hasSelectionInSubtree)
      );
    },

    isValidChild(node: Node): node is Folder | Bookmark {
      return "url" in node || "children" in node;
    },

    childAcceptsDropInside(node: Node): boolean {
      if (!isFolder(node)) return false;
      return the.model.bookmark_metadata.get(node.id).value?.collapsed || false;
    },

    stash(ev: MouseEvent | KeyboardEvent) {
      const win = the.model.tabs.targetWindow.value;
      if (!win) return;

      the.model.attempt(
        async () =>
          await the.model.putItemsInFolder({
            items: copyIf(ev.altKey, the.model.stashableTabsInWindow(win)),
            toFolder: this.folder,
          }),
      );
    },

    stashOne(ev: MouseEvent | KeyboardEvent) {
      const tab = the.model.tabs.activeTab();
      if (!tab) return;
      this.stashSpecificTab(ev, tab);
    },

    stashSpecificTab(ev: MouseEvent | KeyboardEvent, tab: Tab) {
      this.attempt(async () => {
        await the.model.putItemsInFolder({
          items: copyIf(ev.altKey, [tab]),
          toFolder: this.folder,
        });
      });
    },

    moveSelfToTopLevel() {
      this.attempt(async () => {
        const model = the.model.bookmarks;
        const root = model.stash_root.value!;

        // We put it directly above its parent in the stash root, so it's easy
        // to find and continue interacting with.
        const rootPos = pathTo<Folder, Node>(this.folder).find(
          p => p.parent === root,
        );

        await model.move(this.folder, root, rootPos?.index ?? 0);
      });
    },

    moveSelfToChild() {
      this.attempt(async () => {
        const model = the.model.bookmarks;
        const pos = this.folder.position!;

        // Create a new parent first, positioned at our current index
        const newParent = await model.createFolder({
          // We give the parent a default name so it will go away automatically
          // when emptied.
          title: genDefaultFolderName(new Date()),
          parent: model.stash_root.value!,
          index: pos.index,
        });

        // Then move ourselves into the parent
        await model.move(this.folder, newParent, 0);
      });
    },

    move(ev: MouseEvent | KeyboardEvent) {
      const win_id = the.model.tabs.targetWindow.value;
      if (!win_id) return;

      the.model.attempt(() =>
        the.model.putSelectedInFolder({copy: ev.altKey, toFolder: this.folder}),
      );
    },

    moveToChild(ev: MouseEvent | KeyboardEvent) {
      const win_id = the.model.tabs.targetWindow.value;
      if (!win_id) return;

      the.model.attempt(async () => {
        const f = await the.model.bookmarks.createFolder({
          parent: this.folder,
          title: genDefaultFolderName(new Date()),
        });
        await the.model.putSelectedInFolder({copy: ev.altKey, toFolder: f});
      });
    },

    restoreAll(ev: MouseEvent | KeyboardEvent) {
      this.attempt(async () => {
        await the.model.restoreTabs(this.leafChildren, {
          background: bgKeyPressed(ev),
        });
      });
    },

    remove() {
      this.attempt(async () => {
        await the.model.deleteBookmarkTree(this.folder);
      });
    },

    restoreAndRemove(ev: MouseEvent | KeyboardEvent) {
      this.attempt(async () => {
        const bg = bgKeyPressed(ev);

        await the.model.restoreTabs(this.leafChildren, {
          background: bg,
          beforeClosing: () =>
            this.leafChildren.length === this.folder.children.length
              ? the.model.deleteBookmarkTree(this.folder)
              : the.model.deleteItems(this.leafChildren),
        });
      });
    },

    rename(title: string) {
      return this.attempt(async () => {
        if (title === "") {
          if (getDefaultFolderNameISODate(this.folder.title) !== null) {
            // It already has a default name; leave it alone so we don't
            // lose track of when the folder was actually created.
            return;
          }

          // Else give it a default name based on the creation time
          title = genDefaultFolderName(new Date(this.folder.dateAdded || 0));
        }

        await the.model.bookmarks.rename(this.folder, title);
      });
    },

    newChildFolder() {
      return this.attempt(async () => {
        await the.model.bookmarks.create({
          parentId: this.folder.id,
          title: genDefaultFolderName(new Date()),
        });
      });
    },

    stashToNewChildFolder(ev: KeyboardEvent | MouseEvent) {
      this.attempt(async () => {
        if (the.model.tabs.targetWindow.value === undefined) return;
        await the.model.stashAllTabsInWindow(
          the.model.tabs.targetWindow.value,
          {copy: ev.altKey, parent: this.folder, position: "bottom"},
        );
      });
    },

    closeStashedTabs() {
      return this.attempt(async () => {
        const openTabs = this.childrenWithTabs
          .flatMap(c => c.tabs)
          .filter(t => !t.hidden && !t.pinned);
        await the.model.hideOrCloseStashedTabs(openTabs);
      });
    },

    drag(ev: DragAction<Node>) {
      const items = the.model.selection.info(ev.value).isSelected
        ? Array.from(the.model.selection.selectedItems())
        : [ev.value];
      sendDragData(ev.dataTransfer, items);
    },

    async drop(ev: DropAction) {
      const items = recvDragData(ev.dataTransfer, the.model);

      if (ev.dropInside) {
        const child = this.folder.children[ev.toIndex];
        if (!child || !isFolder(child)) {
          throw new Error(
            `Attempt to drop inside non-folder node: ${child?.title} [${child?.id}]`,
          );
        }
        await the.model.attempt(() =>
          the.model.putItemsInFolder({
            items,
            toFolder: child,
            toIndex: child.children.length,
            allowDuplicates: true,
          }),
        );
      } else {
        await the.model.attempt(() =>
          the.model.putItemsInFolder({
            items,
            toFolder: this.folder,
            toIndex: ev.toIndex,
            allowDuplicates: true,
          }),
        );
      }
    },
  },
});
</script>

<style></style>

<template>
  <li
    v-droppable="{
      orientation: () => 'vertical',
      accepts: (data: DataTransfer) => (listAccepts(data) ? 'inside' : null),
      drop: parentDrop,
    }"
    :class="{collapsed}"
  >
    <div
      :class="{
        'action-container': true,
        'forest-item': true,
        selectable: true,
        collapsed,
      }"
    >
      <a
        :class="{
          action: true,
          'forest-collapse': true,
          collapse: !collapsed,
          expand: collapsed,
        }"
        title="Hide the tabs for this group"
        @click.prevent.stop="collapsed = !collapsed"
      />
      <nav v-if="selectedCount === 0" class="action-group forest-toolbar">
        <a
          class="action stash"
          :title="`Stash all ${
            showStashedTabs ? 'open tabs' : 'unstashed tabs'
          } to a new group (hold ${altKey} to keep tabs open)`"
          @click.prevent.stop="stash"
        />
        <a
          class="action stash newtabgroup"
          title="Create a new empty tab group"
          @click.prevent.stop="newTabGroup"
        />
        <a
          class="action stash newgroup"
          title="Create a new empty group in the stash"
          @click.prevent.stop="newGroup"
        />

        <Menu
          summaryClass="action neutral icon-item-menu last-toolbar-button"
          h-position="right"
        >
          <button
            title="Show only unstashed tabs"
            @click.prevent="setMode('unstashed')"
            :disabled="!showStashedTabs"
          >
            <span
              :class="{
                'menu-icon': true,
                icon: true,
                'icon-select': showStashedTabs,
                'icon-select-selected': !showStashedTabs,
              }"
            />
            <span>Show Unstashed Tabs Only</span>
          </button>
          <button
            title="Show all open tabs in the window (excluding pinned tabs)"
            @click.prevent="setMode('all')"
            :disabled="showStashedTabs"
          >
            <span
              :class="{
                'menu-icon': true,
                icon: true,
                'icon-select': !showStashedTabs,
                'icon-select-selected': showStashedTabs,
              }"
            />
            <span>Show All Open Tabs</span>
          </button>

          <hr />

          <button
            :title="`Close all unstashed tabs (except pinned and hidden)`"
            @click.prevent="removeUnstashed"
          >
            <span class="menu-icon icon icon-delete" />
            <span>Close Unstashed Tabs</span>
          </button>
          <button
            :title="`Close all stashed tabs (except pinned and hidden)`"
            @click.prevent="removeStashed"
          >
            <span class="menu-icon icon icon-delete-stashed" />
            <span>Close Stashed Tabs</span>
          </button>
          <button
            :title="`Close all open tabs (except pinned and hidden)`"
            @click.prevent="removeOpen"
          >
            <span class="menu-icon icon icon-delete-opened" />
            <span>Close All Open Tabs</span>
          </button>

          <hr />

          <button
            :title="`Close any stashed tabs that are hidden (may reclaim memory)`"
            @click.prevent="removeHidden"
          >
            <span class="menu-icon icon icon-delete-opened" />
            <span>Close Hidden Tabs</span>
          </button>
        </Menu>
      </nav>

      <nav v-else class="action-group forest-toolbar">
        <a
          class="action stash newgroup"
          :title="`Move ${selectedCount} item(s) to a new group (hold ${altKey} to copy)`"
          @click.prevent.stop="moveToNewGroup"
        />
        <a
          v-if="selectedCount > 0"
          class="action restore newtabgroup"
          :title="`Restore ${selectedCount} item(s) to a new group (hold ${altKey} to copy)`"
          @click.prevent.stop="putInNewTabGroup"
        />
        <a
          v-if="selectedCount > 0"
          class="action restore"
          :title="`Open ${selectedCount} item(s)`"
          @click.prevent.stop="copyToWindow"
        />
        <a
          v-if="selectedCount > 0"
          class="action restore-remove"
          :title="`Unstash ${selectedCount} item(s)`"
          @click.prevent.stop="moveToWindow"
        />
      </nav>

      <span class="forest-title disabled" :title="tooltip">{{ title }}</span>
    </div>

    <dnd-list
      :class="{'forest-children': true, collapsed}"
      orientation="vertical"
      v-model="targetWindow.children"
      :item-key="
        (item: TabGroupExtent | Tab) =>
          item.type === 'tab' ? item.id : `g-${item.group.id}`
      "
      :item-accepts="itemAccepts"
      :list-accepts="_ => false"
      @drag="drag"
      @drop="drop"
      @drop-inside="dropInside"
    >
      <template #item="{item}: {item: TabGroupExtent | Tab}">
        <template v-if="isVisible(item)">
          <tab v-if="item.type === 'tab'" :tab="item" />
          <tab-group v-else :group="item" @close="closeTabs" />
        </template>
      </template>
    </dnd-list>

    <ul v-if="filteredCount > 0" :class="{'forest-children': true, collapsed}">
      <li>
        <show-filtered-item
          v-model:visible="showFiltered"
          :count="filteredCount"
        />
      </li>
    </ul>

    <confirm-dialog
      v-if="confirmCloseTabs > 0"
      :confirm="`Close ${confirmCloseTabs} tabs`"
      cancel="Cancel"
      @answer="confirmCloseTabsThen($event)"
    >
      <p>You're about to close {{ confirmCloseTabs }} tabs at once.</p>

      <p>
        Your browser may not keep this many tabs in its recent history, so THIS
        IS IRREVERSIBLE. Are you sure?
      </p>
    </confirm-dialog>
  </li>
</template>

<script lang="ts">
import {defineComponent, ref, type PropType, type Directive} from "vue";
import browser from "webextension-polyfill";

import {altKeyName, required} from "../util/index.js";

import the from "../globals-ui.js";
import type {BookmarkMetadataEntry} from "../model/bookmark-metadata.js";
import {copyIf} from "../model/index.js";
import type {SyncState} from "../model/options.js";
import type {Tab, TabGroupExtent, Window} from "../model/tabs.js";

import ConfirmDialog, {
  type ConfirmDialogEvent,
} from "../components/confirm-dialog.vue";
import DndList, {
  type ListDragEvent,
  type ListDropEvent,
  type ListDropInsideEvent,
} from "../components/dnd-list.vue";
import ShowFilteredItem from "../components/show-filtered-item.vue";
import Menu from "../components/menu.vue";
import Bookmark from "./bookmark.vue";
import TabGroup from "./tab-group.vue";
import TabVue from "./tab.vue";

import type {FilterInfo} from "../model/tree-filter.js";
import {dragDataType, recvDragData, sendDragData} from "./dnd-proto.js";
import type {
  DNDAcceptedDropPositions,
  DropEvent,
  DroppableOptions,
} from "../components/dnd.js";
import {vDroppable} from "../components/dnd-directives.js";

export default defineComponent({
  components: {
    ConfirmDialog,
    DndList: DndList<TabGroupExtent | Tab>,
    Menu,
    TabGroup,
    Tab: TabVue,
    Bookmark,
    ShowFilteredItem,
  },

  directives: {
    // Cast needed 'cause options-based components have trouble with
    // explicitly-disabled modifiers and args.
    droppable: vDroppable as Directive<HTMLElement, DroppableOptions>,
  },

  props: {
    // Window contents
    targetWindow: required(Object as PropType<Window>),

    // Metadata (for collapsed state)
    metadata: required(Object as PropType<BookmarkMetadataEntry>),
  },

  data: () => ({
    confirmCloseTabs: 0,
    confirmCloseTabsThen: (id: ConfirmDialogEvent): void => {},
  }),

  computed: {
    altKey: altKeyName,

    filterInfo(): FilterInfo {
      return the.model.filter.info(this.targetWindow);
    },

    showFiltered: {
      get(): boolean {
        let f = the.model.showFilteredChildren.get(this.targetWindow);
        if (!f) {
          f = ref(false);
          the.model.showFilteredChildren.set(this.targetWindow, f);
        }
        return f.value;
      },
      set(v: boolean) {
        let f = the.model.showFilteredChildren.get(this.targetWindow);
        if (!f) {
          f = ref(false);
          the.model.showFilteredChildren.set(this.targetWindow, f);
        }
        f.value = v;
      },
    },

    showStashedTabs(): boolean {
      return the.model.options.sync.state.show_open_tabs === "all";
    },

    title(): string {
      if (this.showStashedTabs) return "Open Tabs";
      return "Unstashed Tabs";
    },

    tooltip(): string {
      return `${this.displayCount} ${this.title}`;
    },

    collapsed: {
      get(): boolean {
        return !!this.metadata.value?.collapsed;
      },
      set(collapsed: boolean) {
        the.model.bookmark_metadata.setCollapsed(this.metadata.key, collapsed);
      },
    },

    // How many tabs are visible in the list, ignoring the filter?
    displayCount(): number {
      let count = 0;
      for (const c of this.targetWindow.flattenedChildren) {
        if (this.isValidChild(c)) ++count;
      }
      return count;
    },

    // We ignore the built-in filteredCount because it includes invalid things
    // like hidden tabs
    filteredCount(): number {
      let count = 0;
      for (const c of this.targetWindow.children) {
        const i = the.model.filter.info(c);
        if (this.isValidChild(c) && !i.isMatching) ++count;
      }
      return count;
    },

    selectedCount(): number {
      return the.model.selection.selectedCount.value;
    },

    shouldConfirmCloseOpenTabs: {
      get(): boolean {
        return the.model.options.local.state.confirm_close_open_tabs;
      },

      set(v: boolean) {
        the.model.attempt(() =>
          the.model.options.local.set({confirm_close_open_tabs: v}),
        );
      },
    },
  },

  methods: {
    attempt(fn: () => Promise<void>) {
      the.model.attempt(fn);
    },

    setMode(mode: SyncState["show_open_tabs"]) {
      this.attempt(async () => {
        const options = the.model.options;
        await options.sync.set({show_open_tabs: mode});
      });
    },

    isVisible(t: TabGroupExtent | Tab): boolean {
      if (!this.isValidChild(t)) return false;
      if (this.showFiltered) return true;

      const f = the.model.filter.info(t);
      if (f.isMatching) return true;
      if (f.hasMatchInSubtree) return true;

      const s = the.model.selection.info(t);
      if (s.isSelected) return true;
      if (s.hasSelectionInSubtree) return true;

      return false;
    },

    isValidChild(t: TabGroupExtent | Tab): boolean {
      if (t.type === "tab-group") return true;
      if (t.hidden || t.pinned) return false;
      return (
        this.showStashedTabs ||
        (the.model.isURLStashable(t.url) &&
          !the.model.bookmarks.isURLLoadedInStash(t.url))
      );
    },

    async newGroup() {
      this.attempt(async () => {
        await the.model.createStashFolder();
      });
    },

    newTabGroup() {
      this.attempt(async () => {
        const tab = await browser.tabs.create({active: true});
        const gid = await browser.tabs.group({tabIds: [tab.id!]});
        await browser.tabGroups.update(gid, {
          title: the.model.searchText.value || "Untitled",
        });
      });
    },

    async stash(ev: MouseEvent | KeyboardEvent) {
      this.attempt(async () => {
        // NOTE: isValidChild() is slightly different from
        // stashableTabsInWindow()--we need to check both, because
        // isValidChild() will exclude already-stashed tabs if the user is in
        // "Unstashed Tabs" mode (i.e. ! this.showStashedTabs).
        const stashable_children = the.model
          .stashableTabsInWindow(this.targetWindow)
          .filter(t => this.isValidChild(t));

        if (stashable_children.length === 0) return;
        await the.model.putItemsInFolder({
          items: copyIf(ev.altKey, stashable_children),
          toFolder: await the.model.createStashFolder(),
        });
      });
    },

    async removeUnstashed() {
      this.closeTabs(
        this.targetWindow.flattenedChildren.filter(
          t =>
            !t.hidden &&
            !t.pinned &&
            // Keep the active tab if it's the Tab Stash tab
            (!t.active || the.model.isURLStashable(t.url)) &&
            !the.model.bookmarks.isURLLoadedInStash(t.url),
        ),
      );
    },

    async removeStashed() {
      this.closeTabs(
        this.targetWindow.flattenedChildren.filter(
          t =>
            !t.hidden &&
            !t.pinned &&
            the.model.bookmarks.isURLLoadedInStash(t.url),
        ),
      );
    },

    removeOpen() {
      this.closeTabs(
        this.targetWindow.flattenedChildren.filter(
          t =>
            (!t.active || the.model.isURLStashable(t.url)) &&
            !t.hidden &&
            !t.pinned,
        ),
      );
    },

    removeHidden() {
      this.attempt(async () => {
        const tabs = this.targetWindow.flattenedChildren.filter(
          t => t.hidden && the.model.bookmarks.isURLLoadedInStash(t.url),
        );
        await the.model.tabs.remove(tabs);
      });
    },

    closeTabs(tabs: Tab[]) {
      this.attempt(async () => {
        if (!(await this.confirmRemove(tabs.length))) return;

        const hide_tabs = tabs.filter(t =>
          the.model.bookmarks.isURLLoadedInStash(t.url),
        );
        const close_tabs = tabs
          .filter(t => !the.model.bookmarks.isURLLoadedInStash(t.url))
          .map(t => t.id);

        await the.model.tabs.refocusAwayFromTabs(tabs);

        the.model.hideOrCloseStashedTabs(hide_tabs).catch(console.log);
        browser.tabs.remove(close_tabs).catch(console.log);
      });
    },

    confirmRemove(nr_tabs: number): Promise<boolean> {
      if (nr_tabs <= 10) return Promise.resolve(true);
      if (!this.shouldConfirmCloseOpenTabs) return Promise.resolve(true);

      return new Promise(resolve => {
        this.confirmCloseTabs = nr_tabs;
        this.confirmCloseTabsThen = ev => {
          this.confirmCloseTabs = 0;
          this.shouldConfirmCloseOpenTabs = ev.confirmNextTime;
          resolve(ev.confirmed);
        };
      });
    },

    copyToWindow() {
      this.attempt(() => the.model.putSelectedInWindow({copy: true}));
    },

    putInNewTabGroup(ev: MouseEvent | KeyboardEvent) {
      this.attempt(async () => {
        const items = copyIf(
          ev.altKey,
          Array.from(the.model.selection.selectedItems()),
        );
        console.log(items);
        await the.model.putItemsInNewTabGroup({
          items,
          toWindow: this.targetWindow,
          toIndex: this.targetWindow.children.length,
        });
      });
    },

    moveToWindow() {
      this.attempt(() => the.model.putSelectedInWindow({copy: false}));
    },

    moveToNewGroup(ev: MouseEvent | KeyboardEvent) {
      this.attempt(async () => {
        const folder = await the.model.createStashFolder();
        await the.model.putSelectedInFolder({
          copy: ev.altKey,
          toFolder: folder,
        });
      });
    },

    itemAccepts(
      data: DataTransfer,
      item: TabGroupExtent | Tab,
      index: number,
    ): DNDAcceptedDropPositions {
      const type = dragDataType(data);
      switch (type) {
        case undefined:
          return null;
        case "items":
          if (item.type === "tab-group") return "before-inside-after";
          return "before-after";
        default:
          return "before-after";
      }
    },

    listAccepts(data: DataTransfer): boolean {
      return dragDataType(data) !== null;
    },

    drag(ev: ListDragEvent<TabGroupExtent | Tab>) {
      const items = the.model.selection.info(ev.item).isSelected
        ? Array.from(the.model.selection.selectedItems())
        : [ev.item];
      sendDragData(ev.data, items);
    },

    parentDrop({data}: DropEvent) {
      this.drop({data, insertBeforeIndex: this.targetWindow.children.length});
    },

    drop(ev: ListDropEvent) {
      const items = recvDragData(ev.data, the.model);

      the.model.attempt(() =>
        the.model.putItemsInWindow({
          items,
          toParent: this.targetWindow,
          toIndex: ev.insertBeforeIndex,
        }),
      );
    },

    dropInside(ev: ListDropInsideEvent<TabGroupExtent | Tab>) {
      const parent = ev.insertInParent;
      if (parent.type === "tab") {
        console.warn(`Attempt to drop items inside a tab`, parent);
        return;
      }

      const items = recvDragData(ev.data, the.model);
      the.model.attempt(() =>
        the.model.putItemsInWindow({
          items,
          toParent: parent,
          toIndex: parent.children.length,
        }),
      );
    },
  },
});
</script>

<style></style>

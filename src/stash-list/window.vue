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
          class="action stash newgroup"
          title="Create a new empty group"
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
          :title="`Move ${selectedCount} tab(s) to a new group (hold ${altKey} to copy)`"
          @click.prevent.stop="moveToNewGroup"
        />
        <a
          v-if="selectedCount > 0"
          class="action restore"
          :title="`Open ${selectedCount} tab(s)`"
          @click.prevent.stop="copyToWindow"
        />
        <a
          v-if="selectedCount > 0"
          class="action restore-remove"
          :title="`Unstash ${selectedCount} tab(s)`"
          @click.prevent.stop="moveToWindow"
        />
      </nav>

      <span class="forest-title disabled" :title="tooltip">{{ title }}</span>
    </div>

    <dnd-list
      :class="{'forest-children': true, collapsed}"
      orientation="vertical"
      v-model="targetWindow.children"
      :item-key="(item: Tab) => item.id"
      :item-accepts="itemAccepts"
      :list-accepts="_ => false"
      @drag="drag"
      @drop="drop"
    >
      <template #item="{item}: {item: Tab}">
        <tab v-if="isVisible(item)" :tab="item" />
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
import type {Tab, Window} from "../model/tabs.js";

import ConfirmDialog, {
  type ConfirmDialogEvent,
} from "../components/confirm-dialog.vue";
import DndList, {
  type ListDragEvent,
  type ListDropEvent,
} from "../components/dnd-list.vue";
import ShowFilteredItem from "../components/show-filtered-item.vue";
import Menu from "../components/menu.vue";
import Bookmark from "./bookmark.vue";
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
    DndList: DndList<Tab>,
    Menu,
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

    tabs(): Tab[] {
      return this.targetWindow.children;
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
      for (const c of this.targetWindow.children) {
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

    isVisible(t: Tab): boolean {
      const f = the.model.filter.info(t);
      const s = the.model.selection.info(t);
      return (
        this.isValidChild(t) &&
        (this.showFiltered || f.isMatching || s.isSelected)
      );
    },

    isValidChild(t: Tab): boolean {
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
      this.attempt(async () => {
        const to_remove = this.tabs.filter(
          t =>
            !t.hidden &&
            !t.pinned &&
            // Keep the active tab if it's the Tab Stash tab
            (!t.active || the.model.isURLStashable(t.url)) &&
            !the.model.bookmarks.isURLLoadedInStash(t.url),
        );
        if (!(await this.confirmRemove(to_remove.length))) return;
        await the.model.tabs.remove(to_remove);
      });
    },

    async removeStashed() {
      this.attempt(async () => {
        const to_remove = this.tabs.filter(
          t =>
            !t.hidden &&
            !t.pinned &&
            the.model.bookmarks.isURLLoadedInStash(t.url),
        );
        if (!(await this.confirmRemove(to_remove.length))) return;
        await the.model.hideOrCloseStashedTabs(to_remove);
      });
    },

    removeOpen() {
      this.attempt(async () => {
        // Closes ALL open tabs (stashed and unstashed).
        //
        // For performance, we will try to identify stashed tabs the
        // user might want to keep, and hide instead of close them.
        //
        // (Just as in remove(), we keep the active tab if it's a
        // new-tab page or the Tab Stash page.)
        const tabs = this.tabs.filter(
          t =>
            (!t.active || the.model.isURLStashable(t.url)) &&
            !t.hidden &&
            !t.pinned,
        );
        const hide_tabs = tabs.filter(t =>
          the.model.bookmarks.isURLLoadedInStash(t.url),
        );
        const close_tabs = tabs
          .filter(t => !the.model.bookmarks.isURLLoadedInStash(t.url))
          .map(t => t.id);

        if (!(await this.confirmRemove(tabs.length))) return;

        await the.model.tabs.refocusAwayFromTabs(tabs);

        the.model.hideOrCloseStashedTabs(hide_tabs).catch(console.log);
        browser.tabs.remove(close_tabs).catch(console.log);
      });
    },

    removeHidden() {
      this.attempt(async () => {
        const tabs = this.tabs.filter(
          t => t.hidden && the.model.bookmarks.isURLLoadedInStash(t.url),
        );
        await the.model.tabs.remove(tabs);
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
      item: Tab,
      index: number,
    ): DNDAcceptedDropPositions {
      return this.listAccepts(data) ? "before-after" : null;
    },

    listAccepts(data: DataTransfer): boolean {
      return dragDataType(data) === "items";
    },

    drag(ev: ListDragEvent<Tab>) {
      const items = the.model.selection.info(ev.item).isSelected
        ? Array.from(the.model.selection.selectedItems())
        : [ev.item];
      sendDragData(ev.data, items);
    },

    parentDrop({data}: DropEvent) {
      this.drop({data, insertBeforeIndex: this.tabs.length});
    },

    drop(ev: ListDropEvent) {
      const items = recvDragData(ev.data, the.model);

      the.model.attempt(() =>
        the.model.putItemsInWindow({
          items,
          toIndex: ev.insertBeforeIndex,
        }),
      );
    },
  },
});
</script>

<style></style>

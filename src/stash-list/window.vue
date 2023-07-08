<template>
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
      <a
        class="action remove"
        :title="`Close all unstashed tabs`"
        @click.prevent.stop="remove"
      />
      <a
        class="action remove stashed"
        :title="`Close all stashed tabs`"
        @click.prevent.stop="removeStashed"
      />
      <a
        class="action remove opened"
        :title="`Click: Close all open tabs
${altKey}+Click: Close any hidden/stashed tabs (reclaims memory)`"
        @click.prevent.stop="removeOpen"
      />
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

    <span
      :class="{'forest-title': true, editable: true, disabled: true}"
      :title="tooltip"
      @click.prevent.stop="toggleMode"
      >{{ title }}</span
    >
  </div>

  <dnd-list
    :class="{'forest-children': true, collapsed}"
    v-model="targetWindow.children"
    :item-key="(item: Tab) => item.id"
    :item-class="childClasses"
    :accepts="accepts"
    :drag="drag"
    :drop="drop"
  >
    <template #item="{item}: {item: Tab}">
      <tab v-if="isValidChild(item)" :tab="item" />
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
      Your browser may not keep this many tabs in its recent history, so THIS IS
      IRREVERSIBLE. Are you sure?
    </p>
  </confirm-dialog>
</template>

<script lang="ts">
import {defineComponent, ref, type PropType} from "vue";
import browser from "webextension-polyfill";

import {altKeyName, filterMap, required} from "../util";

import type {DragAction, DropAction} from "../components/dnd-list";

import the from "@/globals-ui";
import type {BookmarkMetadataEntry} from "../model/bookmark-metadata";
import type {SyncState} from "../model/options";
import type {Tab, Window} from "../model/tabs";

import ConfirmDialog, {
  type ConfirmDialogEvent,
} from "../components/confirm-dialog.vue";
import DndList from "../components/dnd-list.vue";
import ShowFilteredItem from "../components/show-filtered-item.vue";
import Bookmark from "./bookmark.vue";
import TabVue from "./tab.vue";

import type {FilterInfo} from "@/model/tree-filter";
import {ACCEPTS, recvDragData, sendDragData} from "./dnd-proto";

const NEXT_SHOW_OPEN_TAB_STATE: Record<
  SyncState["show_open_tabs"],
  SyncState["show_open_tabs"]
> = {
  all: "unstashed",
  unstashed: "all",
};

export default defineComponent({
  components: {
    ConfirmDialog,
    DndList,
    Tab: TabVue,
    Bookmark,
    ShowFilteredItem,
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

    accepts() {
      return ACCEPTS;
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
      return (
        `${
          this.targetWindow.children.length - this.filterInfo.nonMatchingCount
        } ${this.title}\n` + `Click to change which tabs are shown.`
      );
    },

    collapsed: {
      get(): boolean {
        return !!this.metadata.value?.collapsed;
      },
      set(collapsed: boolean) {
        the.model.bookmark_metadata.setCollapsed(this.metadata.key, collapsed);
      },
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

    toggleMode() {
      this.attempt(async () => {
        const options = the.model.options;
        await options.sync.set({
          show_open_tabs:
            NEXT_SHOW_OPEN_TAB_STATE[options.sync.state.show_open_tabs],
        });
      });
    },

    childClasses(t: Tab): Record<string, boolean> {
      const f = the.model.filter.info(t);
      const s = the.model.selection.info(t);
      return {
        hidden: !(
          this.isValidChild(t) &&
          (this.showFiltered || f.isMatching || s.isSelected)
        ),
      };
    },

    isValidChild(t: Tab): boolean {
      if (t.hidden || t.pinned) return false;
      return (
        this.showStashedTabs ||
        (the.model.isURLStashable(t.url) &&
          !the.model.bookmarks.isURLStashed(t.url))
      );
    },

    async newGroup() {
      this.attempt(async () => {
        await the.model.bookmarks.createStashFolder();
      });
    },

    async stash(ev: MouseEvent | KeyboardEvent) {
      this.attempt(async () => {
        // NOTE: isValidChild() is slightly different from
        // stashableTabsInWindow()--we need to check both, because
        // isValidChild() will exclude already-stashed tabs if the user is in
        // "Unstashed Tabs" mode (i.e. ! this.showStashedTabs).
        const stashable_children = the.model
          .stashableTabsInWindow(this.targetWindow.id)
          .filter(t => this.isValidChild(t));

        if (stashable_children.length === 0) return;
        await the.model.putItemsInFolder({
          items: the.model.copyIf(ev.altKey, stashable_children),
          toFolderId: (await the.model.bookmarks.createStashFolder()).id,
        });
      });
    },

    async remove() {
      this.attempt(async () => {
        // This filter keeps the active tab if it's the Tab Stash tab, or a
        // new tab (so we can avoid creating new tabs unnecessarily).
        const to_remove = this.tabs
          .filter(t => !t.active || the.model.isURLStashable(t.url))
          .filter(t => !the.model.bookmarks.isURLStashed(t.url));
        if (!(await this.confirmRemove(to_remove.length))) return;
        await the.model.tabs.remove(to_remove.map(t => t.id));
      });
    },

    async removeStashed() {
      this.attempt(async () => {
        const tabIds = this.tabs
          .filter(
            t =>
              !t.hidden && !t.pinned && the.model.bookmarks.isURLStashed(t.url),
          )
          .map(t => t.id);
        if (!(await this.confirmRemove(tabIds.length))) return;
        await the.model.hideOrCloseStashedTabs(tabIds);
      });
    },

    async removeOpen(ev: MouseEvent | KeyboardEvent) {
      this.attempt(async () => {
        if (ev.altKey) {
          // Discard hidden/stashed tabs to free memory.
          const tabs = this.tabs.filter(
            t => t.hidden && the.model.bookmarks.isURLStashed(t.url),
          );
          await the.model.tabs.remove(filterMap(tabs, t => t?.id));
        } else {
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
          const hide_tabs = tabs
            .filter(t => the.model.bookmarks.isURLStashed(t.url))
            .map(t => t.id);
          const close_tabs = tabs
            .filter(t => !the.model.bookmarks.isURLStashed(t.url))
            .map(t => t.id);

          if (!(await this.confirmRemove(tabs.length))) return;

          await the.model.tabs.refocusAwayFromTabs(tabs.map(t => t.id));

          the.model.hideOrCloseStashedTabs(hide_tabs).catch(console.log);
          browser.tabs.remove(close_tabs).catch(console.log);
        }
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
        const folder = await the.model.bookmarks.createStashFolder();
        await the.model.putSelectedInFolder({
          copy: ev.altKey,
          toFolderId: folder.id,
        });
      });
    },

    drag(ev: DragAction<Tab>) {
      const items = the.model.selection.info(ev.value).isSelected
        ? Array.from(the.model.selection.selectedItems())
        : [ev.value];
      sendDragData(ev.dataTransfer, items);
    },

    async drop(ev: DropAction) {
      const items = recvDragData(ev.dataTransfer, the.model);

      await the.model.attempt(() =>
        the.model.putItemsInWindow({
          items,
          toIndex: ev.toIndex,
        }),
      );
    },
  },
});
</script>

<style></style>

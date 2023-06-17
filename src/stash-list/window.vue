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
    :item-key="(item: FilteredChild<Window, Tab>) => item.unfiltered.id"
    :item-class="childClasses"
    :accepts="accepts"
    :drag="drag"
    :drop="drop"
  >
    <template #item="{item}: {item: FilteredChild<Window, Tab>}">
      <tab v-if="isValidChild(item.unfiltered)" :tab="item" />
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
import {defineComponent, type PropType} from "vue";
import browser from "webextension-polyfill";

import {altKeyName, filterMap, required} from "../util";

import type {DragAction, DropAction} from "../components/dnd-list";

import type {Model} from "../model";
import type {BookmarkMetadataEntry} from "../model/bookmark-metadata";
import type {FilteredChild, FilteredParent} from "../model/filtered-tree";
import type {SyncState} from "../model/options";
import type {Tab, Window} from "../model/tabs";

import ConfirmDialog, {
  type ConfirmDialogEvent,
} from "../components/confirm-dialog.vue";
import DndList from "../components/dnd-list.vue";
import ShowFilteredItem from "../components/show-filtered-item.vue";
import Bookmark from "./bookmark.vue";
import TabVue from "./tab.vue";

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

  inject: ["$model"],

  props: {
    // Window contents
    targetWindow: required(Object as PropType<FilteredParent<Window, Tab>>),

    // Metadata (for collapsed state)
    metadata: required(Object as PropType<BookmarkMetadataEntry>),
  },

  data: () => ({
    showFiltered: false,
    confirmCloseTabs: 0,
    confirmCloseTabsThen: (id: ConfirmDialogEvent): void => {},
  }),

  computed: {
    altKey: altKeyName,

    accepts() {
      return ACCEPTS;
    },

    tabs(): Tab[] {
      return this.targetWindow.children.map(t => t.unfiltered as Tab);
    },

    showStashedTabs(): boolean {
      return this.model().options.sync.state.show_open_tabs === "all";
    },

    title(): string {
      if (this.showStashedTabs) return "Open Tabs";
      return "Unstashed Tabs";
    },

    tooltip(): string {
      return (
        `${
          this.targetWindow.children.length - this.targetWindow.filteredCount
        } ${this.title}\n` + `Click to change which tabs are shown.`
      );
    },

    collapsed: {
      get(): boolean {
        return !!this.metadata.value?.collapsed;
      },
      set(collapsed: boolean) {
        this.model().bookmark_metadata.setCollapsed(
          this.metadata.key,
          collapsed,
        );
      },
    },

    // We ignore the built-in filteredCount because it includes invalid things
    // like hidden tabs
    filteredCount(): number {
      return this.targetWindow.children.reduce(
        (count, t) =>
          !("children" in t) && !t.isMatching && this.isValidChild(t.unfiltered)
            ? count + 1
            : count,
        0,
      );
    },

    selectedCount(): number {
      return this.model().selection.selectedCount.value;
    },

    shouldConfirmCloseOpenTabs: {
      get(): boolean {
        return this.model().options.local.state.confirm_close_open_tabs;
      },

      set(v: boolean) {
        this.model().attempt(() =>
          this.model().options.local.set({confirm_close_open_tabs: v}),
        );
      },
    },
  },

  methods: {
    // TODO make Vue injection play nice with TypeScript typing...
    model() {
      return (<any>this).$model as Model;
    },
    attempt(fn: () => Promise<void>) {
      this.model().attempt(fn);
    },

    toggleMode() {
      this.attempt(async () => {
        const options = this.model().options;
        await options.sync.set({
          show_open_tabs:
            NEXT_SHOW_OPEN_TAB_STATE[options.sync.state.show_open_tabs],
        });
      });
    },

    childClasses(t: FilteredChild<Window, Tab>): Record<string, boolean> {
      return {
        hidden: !(
          this.isValidChild(t.unfiltered) &&
          (this.showFiltered || t.isMatching || t.unfiltered.$selected)
        ),
      };
    },

    isValidChild(t: Tab): boolean {
      const model = this.model();
      if (t.hidden || t.pinned) return false;
      return (
        this.showStashedTabs ||
        (model.isURLStashable(t.url) && !model.bookmarks.isURLStashed(t.url))
      );
    },

    async newGroup() {
      this.attempt(async () => {
        await this.model().bookmarks.createStashFolder();
      });
    },

    async stash(ev: MouseEvent | KeyboardEvent) {
      this.attempt(async () => {
        const model = this.model();
        // NOTE: isValidChild() is slightly different from
        // stashableTabsInWindow()--we need to check both, because
        // isValidChild() will exclude already-stashed tabs if the user is in
        // "Unstashed Tabs" mode (i.e. ! this.showStashedTabs).
        const stashable_children = model
          .stashableTabsInWindow(this.targetWindow.unfiltered.id)
          .filter(t => this.isValidChild(t));

        if (stashable_children.length === 0) return;
        await model.putItemsInFolder({
          items: model.copyIf(ev.altKey, stashable_children),
          toFolderId: (await model.bookmarks.createStashFolder()).id,
        });
      });
    },

    async remove() {
      this.attempt(async () => {
        const model = this.model();
        // This filter keeps the active tab if it's the Tab Stash tab, or a
        // new tab (so we can avoid creating new tabs unnecessarily).
        const to_remove = this.tabs
          .filter(t => !t.active || model.isURLStashable(t.url))
          .filter(t => !model.bookmarks.isURLStashed(t.url));
        if (!(await this.confirmRemove(to_remove.length))) return;
        await model.tabs.remove(to_remove.map(t => t.id));
      });
    },

    async removeStashed() {
      this.attempt(async () => {
        const model = this.model();
        const tabIds = this.tabs
          .filter(
            t => !t.hidden && !t.pinned && model.bookmarks.isURLStashed(t.url),
          )
          .map(t => t.id);
        if (!(await this.confirmRemove(tabIds.length))) return;
        await model.hideOrCloseStashedTabs(tabIds);
      });
    },

    async removeOpen(ev: MouseEvent | KeyboardEvent) {
      this.attempt(async () => {
        const model = this.model();

        if (ev.altKey) {
          // Discard hidden/stashed tabs to free memory.
          const tabs = this.tabs.filter(
            t => t.hidden && model.bookmarks.isURLStashed(t.url),
          );
          await model.tabs.remove(filterMap(tabs, t => t?.id));
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
              (!t.active || model.isURLStashable(t.url)) &&
              !t.hidden &&
              !t.pinned,
          );
          const hide_tabs = tabs
            .filter(t => model.bookmarks.isURLStashed(t.url))
            .map(t => t.id);
          const close_tabs = tabs
            .filter(t => !model.bookmarks.isURLStashed(t.url))
            .map(t => t.id);

          if (!(await this.confirmRemove(tabs.length))) return;

          await model.tabs.refocusAwayFromTabs(tabs.map(t => t.id));

          model.hideOrCloseStashedTabs(hide_tabs).catch(console.log);
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
      this.attempt(() => this.model().putSelectedInWindow({copy: true}));
    },

    moveToWindow() {
      this.attempt(() => this.model().putSelectedInWindow({copy: false}));
    },

    moveToNewGroup(ev: MouseEvent | KeyboardEvent) {
      this.attempt(async () => {
        const folder = await this.model().bookmarks.createStashFolder();
        await this.model().putSelectedInFolder({
          copy: ev.altKey,
          toFolderId: folder.id,
        });
      });
    },

    drag(ev: DragAction<FilteredChild<Window, Tab>>) {
      const items = ev.value.unfiltered.$selected
        ? Array.from(this.model().selectedItems())
        : [ev.value.unfiltered];
      sendDragData(ev.dataTransfer, items);
    },

    async drop(ev: DropAction) {
      const model = this.model();
      const items = recvDragData(ev.dataTransfer, model);

      await model.attempt(() =>
        model.putItemsInWindow({
          items,
          toIndex: ev.toIndex,
        }),
      );
    },
  },
});
</script>

<style></style>

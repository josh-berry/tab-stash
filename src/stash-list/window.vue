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
        :title="$t('hideTabsForGroup')"
        @click.prevent.stop="collapsed = !collapsed"
      />
      <nav v-if="selectedCount === 0" class="action-group forest-toolbar">
        <a
          class="action stash"
          :title="$t('stashAllOpenTabsTooltip', [altKey])"
          @click.prevent.stop="stash"
        />
        <a
          class="action stash newtab"
          :title="$t('newTabTooltip')"
          @click.prevent.stop="newTab"
        />
        <a
          class="action stash newtabgroup"
          :title="$t('newTabGroupTooltip')"
          @click.prevent.stop="newTabGroup"
        />
        <a
          class="action stash newgroup"
          :title="$t('createNewEmptyGroupTooltip')"
          @click.prevent.stop="newGroup"
        />

        <Menu
          summaryClass="action neutral icon-item-menu last-toolbar-button"
          h-position="right"
        >
          <button
            :title="$t('showOnlyUnstashedTabsTooltip')"
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
            <span>{{ $t("showUnstashedTabsOnlyMenu") }}</span>
          </button>
          <button
            :title="$t('showAllOpenTabsTooltip')"
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
            <span>{{ $t("showAllOpenTabsMenu") }}</span>
          </button>

          <hr />

          <button
            :title="$t('closeUnstashedTabsTooltip')"
            @click.prevent="removeUnstashed"
          >
            <span class="menu-icon icon icon-delete" />
            <span>{{ $t("closeUnstashedTabsMenu") }}</span>
          </button>
          <button
            :title="$t('closeStashedTabsTooltip')"
            @click.prevent="removeStashed"
          >
            <span class="menu-icon icon icon-delete-stashed" />
            <span>{{ $t("closeStashedTabsMenu") }}</span>
          </button>
          <button
            :title="$t('closeAllOpenTabsTooltip')"
            @click.prevent="removeOpen"
          >
            <span class="menu-icon icon icon-delete-opened" />
            <span>{{ $t("closeAllOpenTabsMenu") }}</span>
          </button>

          <hr />

          <button
            :title="$t('closeHiddenTabsTooltip')"
            @click.prevent="removeHidden"
          >
            <span class="menu-icon icon icon-delete-opened" />
            <span>{{ $t("closeHiddenTabsMenu") }}</span>
          </button>
        </Menu>
      </nav>

      <nav v-else class="action-group forest-toolbar">
        <a
          class="action stash newgroup"
          :title="$ts(selectedCount, 'moveItemsToNewGroup', [altKey])"
          @click.prevent.stop="moveToNewGroup"
        />
        <a
          v-if="selectedCount > 0"
          class="action restore newtabgroup"
          :title="
            $ts(selectedCount, 'openSelectedIntoNewTabGroupTooltip', [altKey])
          "
          @click.prevent.stop="putInNewTabGroup"
        />
        <a
          v-if="selectedCount > 0"
          class="action restore"
          :title="$ts(selectedCount, 'openSelectedItems')"
          @click.prevent.stop="copyToWindow"
        />
        <a
          v-if="selectedCount > 0"
          class="action restore-remove"
          :title="$ts(selectedCount, 'unstashSelectedItems')"
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

    <ul
      v-if="hiddenStashedCount > 0"
      :class="{'forest-children': true, collapsed}"
    >
      <li>
        <show-filtered-item
          v-model:visible="showStashedTabs"
          :count="hiddenStashedCount"
          label="stashedCountBadge"
        />
      </li>
    </ul>

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
      :confirm="$ts(confirmCloseTabs, 'closeTabsConfirm')"
      :cancel="$t('cancelButton')"
      @answer="confirmCloseTabsThen($event)"
    >
      <p>{{ $ts(confirmCloseTabs, "closeTabsWarn") }}</p>

      <p>
        {{ $t("closeTabsIrreversible") }}
      </p>
    </confirm-dialog>
  </li>
</template>

<script lang="ts">
import {defineComponent, ref, type PropType, type Directive} from "vue";
import browser from "webextension-polyfill";

import {altKeyName, required, $t, $ts} from "../util/index.js";

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

    showStashedTabs: {
      get(): boolean {
        return the.model.options.sync.state.show_open_tabs !== "unstashed";
      },
      set(v: boolean) {
        the.model.options.sync.set({show_open_tabs: v ? "all" : "unstashed"});
      },
    },

    title(): string {
      if (this.showStashedTabs) return this.$t("openTabsTitle");
      return this.$t("unstashedTabsTitle");
    },

    tooltip(): string {
      return this.$ts(
        this.displayCount,
        this.showStashedTabs ? "open_tabs" : "unstashed_tabs",
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

    hiddenStashedCount(): number {
      if (this.showStashedTabs) return 0;
      let count = 0;
      for (const c of this.targetWindow.children) {
        if (c.type === "tab" && the.model.isTabVisibleAndStashed(c)) {
          ++count;
        }
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
    $t,
    $ts,
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

    newTab() {
      this.attempt(async () => {
        await browser.tabs.create({
          windowId: the.model.tabs.targetWindow.value!.id,
          active: true,
        });
      });
    },

    newTabGroup() {
      this.attempt(async () => {
        const win = the.model.tabs.targetWindow.value;
        if (!win) return;

        await the.model.putItemsInNewTabGroup({
          title: the.model.searchText.value || "Untitled",
          items: [{url: ""}],
          toWindow: win,
          toIndex: win.children.length,
        });
      });
    },

    async stash(ev: MouseEvent | KeyboardEvent) {
      this.attempt(async () => {
        let to_stash = this.targetWindow.children;
        if (!the.model.options.sync.state.stash_include_pinned) {
          to_stash = to_stash.filter(t => t.type !== "tab" || !t.pinned);
        }

        if (to_stash.length === 0) return;
        await the.model.putItemsInFolder({
          items: copyIf(ev.altKey, to_stash),
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
        this.targetWindow.flattenedChildren.filter(t =>
          the.model.isTabVisibleAndStashed(t),
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

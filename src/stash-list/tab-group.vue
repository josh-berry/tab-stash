<template>
  <div
    :class="{
      'forest-item': true,
      selectable: true,
      folder: true,
      'action-container': true,
      collapsed: props.group.group.collapsed,
      selected: selectionInfo.isSelected,
      'no-match': !filterInfo.isMatching,
      'has-matching-children':
        filterInfo.isMatching || filterInfo.hasMatchInSubtree,
    }"
  >
    <item-icon
      :class="{
        'forest-icon': true,
        action: true,
        select: true,
      }"
      default-icon="tab-group"
      selectable
      :selected="selectionInfo.isSelected"
      @click.prevent.stop="toggleSelected"
    />

    <a
      :class="{
        'forest-collapse': true,
        action: true,
        collapse: !props.group.group.collapsed,
        expand: props.group.group.collapsed,
      }"
      :title="$t('toggleCollapsedTabGroupTooltip')"
      @click.prevent.stop="toggleCollapsed"
    />

    <span
      v-if="!isRenaming"
      class="forest-title editable"
      :title="tooltip"
      @click.stop="isRenaming = true"
      >{{ props.group.group.title }}</span
    >
    <async-text-input
      v-else
      class="forest-title editable"
      :title="tooltip"
      :value="props.group.group.title"
      :defaultValue="props.group.group.title"
      :save="rename"
      @done="isRenaming = false"
    />

    <template v-if="!isRenaming">
      <nav v-if="selectedCount === 0" class="action-group forest-toolbar">
        <a
          class="action stash many"
          :title="$t('stashTabGroup', [altKeyName()])"
          @click.prevent.stop="stash"
        />

        <a
          class="action stash newtab"
          :title="$t('openTabInGroup')"
          @click.prevent.stop="newTab"
        />

        <Menu
          summary-class="action neutral icon-item-menu last-toolbar-button"
          h-position="right"
        >
          <button @click.prevent="ungroup" :title="$t('moveTabsOutOfGroup')">
            <span class="menu-icon icon icon-restore" />
            <span>{{ $t("ungroup") }}</span>
          </button>

          <hr />

          <button
            @click.prevent="isShowingExportDialog = true"
            :title="$t('exportFromGroupTooltip')"
          >
            <span class="menu-icon icon icon-export" />
            <span>{{ $t("exportMenu") }}</span>
          </button>

          <hr />

          <button @click.prevent="sort(sortByTitle)">
            <span class="menu-icon icon icon-sort" />
            <span>{{ $t("sortByTitleMenu") }}</span>
          </button>

          <button @click.prevent="sort(sortByURL)">
            <span class="menu-icon icon icon-sort" />
            <span>{{ $t("sortByUrlMenu") }}</span>
          </button>

          <hr />

          <button
            @click.prevent="closeUnstashed"
            :title="$t('closeUnstashedTabsInGroupTooltip')"
          >
            <span class="menu-icon icon icon-delete-opened" />
            <span>{{ $t("closeUnstashedTabsMenu") }}</span>
          </button>

          <button
            @click.prevent="closeStashed"
            :title="$t('closeStashedTabsInGroupTooltip')"
          >
            <span class="menu-icon icon icon-delete-stashed" />
            <span>{{ $t("closeStashedTabsMenu") }}</span>
          </button>

          <hr />

          <button @click.prevent="close" :title="$t('closeTabGroupTooltip')">
            <span class="menu-icon icon icon-delete" />
            <span>{{ $t("closeTabGroupMenu") }}</span>
          </button>
        </Menu>
      </nav>

      <nav
        v-else-if="!selectionInfo.isSelected"
        class="action-group forest-toolbar"
      >
        <a
          class="action restore"
          :title="
            $ts(selectedCount, 'openSelectedIntoTabGroupTooltip', [
              `${selectedCount}`,
            ])
          "
          @click.prevent.stop="copySelectedItemsHere"
        />
        <a
          class="action restore-remove"
          :title="
            $ts(selectedCount, 'unstashSelectedIntoTabGroupTooltip', [
              `${selectedCount}`,
            ])
          "
          @click.prevent.stop="moveSelectedItemsHere"
        />
      </nav>
    </template>
  </div>

  <dnd-list
    :class="{'forest-children': true, collapsed: props.group.group.collapsed}"
    orientation="vertical"
    v-model="props.group.children"
    :item-key="(item: Tab) => item.id"
    :item-accepts="itemAccepts"
    :list-accepts="listAccepts"
    @drag="drag"
    @drop="drop"
    @drop-inside="dropInside"
  >
    <template #item="{item}: {item: Tab}">
      <template v-if="isVisible(item)">
        <tab-view :tab="item" />
      </template>
    </template>
  </dnd-list>

  <ul
    v-if="hiddenStashedCount > 0"
    :class="{'forest-children': true, collapsed: props.group.group.collapsed}"
  >
    <li>
      <show-filtered-item
        v-model:visible="showStashedChildren"
        :count="hiddenStashedCount"
        label="stashedCountBadge"
      />
    </li>
  </ul>

  <ul
    v-if="filteredCount > 0"
    :class="{'forest-children': true, collapsed: props.group.group.collapsed}"
  >
    <li>
      <show-filtered-item
        v-model:visible="showFilteredChildren"
        :count="filteredCount"
      />
    </li>
  </ul>

  <export-dialog
    v-if="isShowingExportDialog"
    :items="[props.group]"
    @close="isShowingExportDialog = false"
  />
</template>

<script lang="ts">
import browser from "webextension-polyfill";
import {computed, ref} from "vue";

import type {Tab, TabGroupExtent} from "../model/tabs.js";
import the from "../globals-ui.js";
import {dragDataType, recvDragData, sendDragData} from "./dnd-proto.js";
import type {DNDAcceptedDropPositions} from "../components/dnd.js";
import {$t, $ts, altKeyName} from "../util/index.js";
import {copyIf, copying, sortByTitle, sortByURL} from "../model/index.js";

import ItemIcon from "../components/item-icon.vue";
import AsyncTextInput from "../components/async-text-input.vue";
import DndList, {
  type ListDragEvent,
  type ListDropEvent,
  type ListDropInsideEvent,
} from "../components/dnd-list.vue";
import ExportDialog from "../tasks/export.vue";
import Menu from "../components/menu.vue";
import TabView from "./tab.vue";
import ShowFilteredItem from "../components/show-filtered-item.vue";
</script>

<script setup lang="ts">
const props = defineProps<{
  group: TabGroupExtent;
}>();

const emit = defineEmits<{
  (e: "close", tabs: Tab[]): void;
}>();

const selectedCount = computed(() => the.model.selection.selectedCount.value);

const selectionInfo = computed(() => the.model.selection.info(props.group));
const filterInfo = computed(() => the.model.filter.info(props.group));

const showStashedChildren = computed({
  get: () => the.model.options.sync.state.show_open_tabs !== "unstashed",
  set: v => {
    the.model.options.sync.set({show_open_tabs: v ? "all" : "unstashed"});
  },
});

const hiddenStashedCount = computed(() => {
  if (showStashedChildren.value) return 0;

  let count = 0;
  for (const c of props.group.children) {
    if (the.model.isTabVisibleAndStashed(c)) {
      ++count;
    }
  }
  return count;
});

const nonHiddenChildren = computed(() => {
  let children = props.group.children.filter(t => !t.hidden);
  if (!showStashedChildren.value) {
    children = children.filter(
      t =>
        the.model.isURLStashable(t.url) &&
        !the.model.bookmarks.isURLLoadedInStash(t.url),
    );
  }
  return children;
});

const filteredCount = computed(() => {
  // We can't use nonMatchingCount because it ignores whether tabs are visible
  let count = 0;
  for (const c of nonHiddenChildren.value) {
    const i = the.model.filter.info(c);
    if (!i.isMatching) ++count;
  }
  return count;
});

const showFilteredChildren = ref(false);

const tooltip = computed(
  () =>
    `${props.group.group.title}\n${nonHiddenChildren.value.length} tab${nonHiddenChildren.value.length === 1 ? "" : "s"}`,
);

const isRenaming = ref(false);
const isShowingExportDialog = ref(false);

//
// Accessors for various UI things
//

function isVisible(tab: Tab): boolean {
  if (tab.hidden) return false;
  if (!showStashedChildren.value) {
    if (!the.model.isURLStashable(tab.url)) return false;
    if (the.model.bookmarks.isURLLoadedInStash(tab.url)) return false;
  }
  if (showFilteredChildren.value) return true;
  const f = the.model.filter.info(tab);
  if (f.isMatching) return true;
  const s = the.model.selection.info(tab);
  if (s.isSelected) return true;
  return false;
}

//
// Operations on the group itself
//

function toggleSelected() {
  selectionInfo.value.isSelected = !selectionInfo.value.isSelected;
}

function toggleCollapsed() {
  the.model.attempt(async () =>
    browser.tabGroups.update(props.group.group.id, {
      collapsed: !props.group.group.collapsed,
    }),
  );
}

function rename(title: string): Promise<void> {
  return the.model.attempt(async () => {
    // If the user asks for the default name, don't rename at all.
    if (title === "") return;
    await browser.tabGroups.update(props.group.group.id, {title});
  });
}

function sort(sorter: (a: Tab, b: Tab) => number) {
  the.model.attempt(async () => {
    // We deliberately pick up hidden children here as well, so that if they're
    // ever un-hidden by another extension, they're still sorted correctly.
    const sorted = [...props.group.children].sort(sorter);
    await the.model.putItemsInWindow({
      items: sorted,
      toParent: props.group,
      toIndex: 0,
    });
  });
}

function stash(ev: MouseEvent) {
  the.model.attempt(async () => {
    await the.model.putItemsInFolder({
      items: copyIf(ev.altKey, stashableTabsIn(props.group.children)),
      toFolder: await the.model.createStashFolder(props.group.group.title),
    });
  });
}

function newTab() {
  the.model.attempt(async () => {
    const t = await browser.tabs.create({
      windowId: the.model.tabs.targetWindow.value!.id,
      active: true,
    });
    await browser.tabs.group({groupId: props.group.group.id, tabIds: [t.id!]});
  });
}

function ungroup() {
  the.model.attempt(async () => {
    await browser.tabs.ungroup(props.group.children.map(t => t.id));
  });
}

function closeUnstashed() {
  // We push the close event up to the window, because only the window can show
  // a confirmation dialog.
  emit(
    "close",
    closableTabsIn(props.group.children).filter(t => !isInStash(t)),
  );
}

function closeStashed() {
  emit("close", closableTabsIn(props.group.children).filter(isInStash));
}

function close() {
  emit("close", closableTabsIn(props.group.children));
}

//
// Selection operations
//

function copySelectedItemsHere() {
  the.model.attempt(async () => {
    await the.model.putItemsInWindow({
      items: copying(Array.from(the.model.selection.selectedItems())),
      toParent: props.group,
      toIndex: props.group.children.length,
    });
  });
}

function moveSelectedItemsHere() {
  the.model.attempt(async () => {
    await the.model.putItemsInWindow({
      items: Array.from(the.model.selection.selectedItems()),
      toParent: props.group,
      toIndex: props.group.children.length,
    });
  });
}

//
// Drag-and-Drop
//

function itemAccepts(
  data: DataTransfer,
  item: Tab,
  index: number,
): DNDAcceptedDropPositions {
  const type = dragDataType(data);
  if (type === "items") return "before-after";
  return null;
}

function listAccepts(data: DataTransfer): boolean {
  // The parent is supposed to handle dropping inside the group
  return false;
}

function drag(ev: ListDragEvent<Tab>) {
  const items = the.model.selection.info(ev.item).isSelected
    ? Array.from(the.model.selection.selectedItems())
    : [ev.item];
  sendDragData(ev.data, items);
}

function drop(ev: ListDropEvent) {
  the.model.attempt(async () => {
    const items = recvDragData(ev.data, the.model);
    await the.model.putItemsInWindow({
      items,
      toParent: props.group,
      toIndex: ev.insertBeforeIndex,
    });
  });
}

function dropInside(ev: ListDropInsideEvent<Tab>) {
  // No-op since we never accept inside drops; tab groups cannot have sub-groups
  console.warn(`Attempt to drop inside a tab`, ev);
}

//
// Helpers
//

function stashableTabsIn(tabs: Tab[]): Tab[] {
  // TODO: Matches code in window.vue
  return tabs.filter(
    t => !t.hidden && !t.pinned && the.model.isURLStashable(t.url),
  );
}

function closableTabsIn(tabs: Tab[]): Tab[] {
  return tabs.filter(
    t =>
      !t.hidden &&
      !t.pinned &&
      !t.url.startsWith(browser.runtime.getURL("stash-list.html")),
  );
}

function isInStash(t: Tab): boolean {
  return the.model.bookmarks.loadedFoldersInStashWithURL(t.url).length > 0;
}
</script>

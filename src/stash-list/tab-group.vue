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
      default-icon="folder"
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
      :title="`Hide the tabs for this group`"
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
</template>

<script lang="ts">
import browser from "webextension-polyfill";
import {computed, ref} from "vue";

import type {Tab, TabGroupExtent} from "../model/tabs.js";
import the from "../globals-ui.js";
import {dragDataType, recvDragData, sendDragData} from "./dnd-proto.js";
import type {DNDAcceptedDropPositions} from "../components/dnd.js";

import ItemIcon from "../components/item-icon.vue";
import AsyncTextInput from "../components/async-text-input.vue";
import DndList, {
  type ListDragEvent,
  type ListDropEvent,
  type ListDropInsideEvent,
} from "../components/dnd-list.vue";
import TabView from "./tab.vue";
</script>

<script setup lang="ts">
const props = defineProps<{
  group: TabGroupExtent;
}>();

const selectionInfo = computed(() => the.model.selection.info(props.group));
const filterInfo = computed(() => the.model.filter.info(props.group));

const nonHiddenChildren = computed(() =>
  props.group.children.filter(t => !t.hidden),
);

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

//
// Accessors for various UI things
//

function isVisible(tab: Tab): boolean {
  if (tab.hidden) return false;
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
</script>

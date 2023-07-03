<template>
  <div v-if="loading" class="forest-item deleted loading">
    <span class="forest-icon icon spinner size-icon" />
    <span class="forest-title status-text">{{ loading }}...</span>
  </div>

  <div v-else class="forest-item selectable deleted action-container">
    <item-icon
      :class="{
        'forest-icon': true,
      }"
      :defaultIcon="'url' in item ? 'tab' : 'folder'"
      :src="'favIconUrl' in item ? item.favIconUrl : undefined"
    />

    <a
      v-if="'url' in item"
      class="forest-title"
      :href="item.url"
      target="_blank"
      :title="tooltip"
      ><span>{{ item.title }}</span></a
    >
    <span v-else class="forest-title" :title="tooltip">{{
      friendlyTitle
    }}</span>

    <ButtonBox class="forest-toolbar">
      <a
        class="action stash one"
        title="Restore"
        @click.prevent.stop="restore"
      />
      <Menu
        class="menu"
        summaryClass="action remove last-toolbar-button"
        title="Delete Forever"
        inPlace
      >
        <button @click.prevent.stop="remove">
          <span>Delete Forever</span>
        </button>
      </Menu>
    </ButtonBox>
  </div>

  <ul v-if="'children' in item" class="forest-children">
    <li v-for="(_child, index) of item.children" :key="index">
      <Item :deletion="props.deletion" :path="[...props.path, index]" />
    </li>
    <li v-if="item.filtered_count">
      <div class="forest-item disabled">
        <span class="forest-icon icon" />
        <span class="forest-title status-text hidden-count">
          + {{ item.filtered_count }} filtered
        </span>
      </div>
    </li>
  </ul>
</template>

<script lang="ts">
import {computed, ref} from "vue";

import the from "@/globals-ui";
import {friendlyFolderName} from "@/model/bookmarks";
import {findChildItem} from "@/model/deleted-items";

import ButtonBox from "@/components/button-box.vue";
import ItemIcon from "@/components/item-icon.vue";
import Menu from "@/components/menu.vue";
import type {FilteredDeletedItem, FilteredDeletion} from "./schema";
</script>

<script setup lang="ts">
const props = defineProps<{
  /** The deletion record this item belongs to. */
  deletion: FilteredDeletion;

  /** The path of array indexes to follow, starting from `deletion.item`, to
   * reach this item. */
  path: number[];
}>();

const loading = ref("");

const item = computed(
  () =>
    findChildItem(props.deletion.item, props.path).child as FilteredDeletedItem,
);

const friendlyTitle = computed(() => friendlyFolderName(item.value.title));

const deletedAt = computed(() => props.deletion.deleted_at.toLocaleString());

// TODO move me to the top level model
const tooltip = computed(() => {
  const t = `${item.value.title}\n`;
  if (props.deletion.deleted_from) {
    return `${t}Deleted at ${deletedAt.value} from "${props.deletion.deleted_from.title}"`;
  } else {
    return `${t}Deleted at ${deletedAt.value}`;
  }
});

async function run(what: string, f: () => Promise<void>) {
  if (loading.value !== "") return;
  loading.value = what;
  try {
    await the.model.attempt(f);
  } finally {
    loading.value = "";
  }
}

const restore = () =>
  run("Restoring", () => the.model.undelete(props.deletion, props.path));

const remove = () =>
  run("Deleting Forever", () =>
    the.model.deleted_items.drop(props.deletion.key, props.path),
  );
</script>

<template>
  <ul>
    <li v-for="folder of visibleChildFolders">
      <button
        :class="props.buttonClasses(folder)"
        :title="props.tooltips(folder)"
        @click.prevent="emit('select', $event, folder)"
      >
        <span>{{ friendlyFolderName(folder.title) }}</span>
      </button>
      <Self
        :folder="folder"
        :tooltips="props.tooltips"
        :button-classes="props.buttonClasses"
        @select="(ev, folder) => emit('select', ev, folder)"
      />
    </li>
  </ul>
</template>

<script lang="ts">
import {computed, inject} from "vue";

import {filterMap} from "@/util";

import {friendlyFolderName, type Folder, type Node} from "@/model/bookmarks";
import {TreeFilter} from "@/model/tree-filter";

import Self from "./select-folder.vue";
</script>

<script setup lang="ts">
const props = defineProps<{
  folder: Folder;
  tooltips: (f: Folder) => string;
  buttonClasses: (f: Folder) => Record<string, boolean> | string;
}>();

const emit = defineEmits<{
  (e: "select", ev: MouseEvent | KeyboardEvent, folder: Folder): void;
}>();

const bookmark_filter = inject<TreeFilter<Folder, Node>>("bookmark_filter")!;

const visibleChildFolders = computed(() =>
  filterMap(props.folder.children, c =>
    "children" in c && bookmark_filter.info(c).hasMatchInSubtree
      ? c
      : undefined,
  ),
);
</script>

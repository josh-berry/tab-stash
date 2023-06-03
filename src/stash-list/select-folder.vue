<template>
  <ul>
    <li
      v-for="folder of children.filter(
        f => f.isMatching || f.hasMatchingChildren,
      )"
    >
      <button
        :class="props.buttonClasses(folder.unfiltered)"
        :title="props.tooltips(folder.unfiltered)"
        @click.prevent="emit('select', $event, folder.unfiltered)"
      >
        <span>{{ friendlyFolderName(folder.unfiltered.title) }}</span>
      </button>
      <Self
        :tree="props.tree"
        :folder="folder"
        :tooltips="props.tooltips"
        :button-classes="props.buttonClasses"
        @select="(ev, folder) => emit('select', ev, folder)"
      />
    </li>
  </ul>
</template>

<script lang="ts">
import {computed} from "vue";

import {filterMap} from "@/util";

import {friendlyFolderName, type Folder, type Node} from "@/model/bookmarks";
import {
  isFilteredParent,
  type FilteredParent,
  type FilteredTree,
} from "@/model/filtered-tree";

import Self from "./select-folder.vue";
</script>

<script setup lang="ts">
const props = defineProps<{
  tree: FilteredTree<Folder, Node>;
  folder: FilteredParent<Folder, Node>;
  tooltips: (f: Folder) => string;
  buttonClasses: (f: Folder) => Record<string, boolean> | string;
}>();

const emit = defineEmits<{
  (e: "select", ev: MouseEvent | KeyboardEvent, folder: Folder): void;
}>();

const children = computed(() =>
  filterMap(props.folder.children, c => (isFilteredParent(c) ? c : undefined)),
);
</script>

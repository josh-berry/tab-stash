<template>
  <ul>
    <li
      v-for="folder of children.filter(
        f => f.isMatching.value || f.hasMatchingChildren.value,
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

import {
  friendlyFolderName,
  type Bookmark,
  type Folder,
  type Separator,
} from "@/model/bookmarks";
import type {FilteredParent, FilteredTree} from "@/model/filtered-tree";
import {filterMap} from "@/util";

import Self from "./select-folder.vue";
</script>

<script setup lang="ts">
const props = defineProps<{
  tree: FilteredTree<Folder, Bookmark | Separator>;
  folder: FilteredParent<Folder, Bookmark | Separator>;
  tooltips: (f: Folder) => string;
  buttonClasses: (f: Folder) => Record<string, boolean> | string;
}>();

const emit = defineEmits<{
  (e: "select", ev: MouseEvent | KeyboardEvent, folder: Folder): void;
}>();

const children = computed(() =>
  filterMap(props.tree.childrenOf(props.folder), c =>
    props.tree.isParent(c) ? c : undefined,
  ),
);
</script>

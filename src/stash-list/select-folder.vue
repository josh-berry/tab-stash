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
        :filter="filter"
        :tooltips="props.tooltips"
        :button-classes="props.buttonClasses"
        @select="(ev, folder) => emit('select', ev, folder)"
      />
    </li>
  </ul>
</template>

<script lang="ts">
import {computed} from "vue";

import {filterMap} from "../util/index.js";

import the from "../globals-ui.js";
import {friendlyFolderName, type Folder} from "../model/bookmarks.js";

import Self from "./select-folder.vue";
</script>

<script setup lang="ts">
const props = defineProps<{
  folder: Folder;
  tooltips: (f: Folder) => string;
  buttonClasses: (f: Folder) => Record<string, boolean> | string;
  filter: (f: Folder) => boolean;
}>();

const emit = defineEmits<{
  (e: "select", ev: MouseEvent | KeyboardEvent, folder: Folder): void;
}>();

const selection = the.model.selection;

const visibleChildFolders = computed(() =>
  filterMap(props.folder.children, c =>
    c && "children" in c && props.filter(c) && !selection.info(c).isSelected
      ? c
      : undefined,
  ),
);
</script>

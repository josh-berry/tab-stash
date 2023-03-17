<template>
  <dnd-list
    class="forest"
    v-model="parentFolder.children.value"
    item-key="id"
    :item-class="itemClasses"
    :accepts="accepts"
    :drag="drag"
    :drop="drop"
    ghost-displaces-items
    ghost-mimics-height
  >
    <template #item="{item: f}">
      <Folder v-if="'children' in f" ref="folders" :folder="f" />
    </template>
  </dnd-list>
</template>

<script lang="ts">
import {defineComponent, type PropType} from "vue";

import {required} from "../util";

import type {DragAction, DropAction} from "../components/dnd-list";
import type {Model} from "../model";
import type {Bookmark, Folder, NodeID, Separator} from "../model/bookmarks";
import type {FilteredItem, FilteredParent} from "../model/filtered-tree";

import DndList from "../components/dnd-list.vue";
import FolderVue from "./folder.vue";

const DROP_FORMAT = "application/x-tab-stash-folder-id";

export default defineComponent({
  components: {DndList, Folder: FolderVue},

  inject: ["$model"],

  props: {
    parentFolder: required(
      Object as PropType<FilteredParent<Folder, Bookmark | Separator>>,
    ),
  },

  computed: {
    accepts() {
      return DROP_FORMAT;
    },
  },

  methods: {
    model(): Model {
      return (<any>this).$model as Model;
    },

    itemClasses(
      f: FilteredItem<Folder, Bookmark | Separator>,
    ): Record<string, boolean> {
      return {
        hidden:
          !("children" in f) ||
          !(
            f.isMatching.value ||
            f.hasMatchingChildren.value ||
            f.unfiltered.$recursiveStats.selectedCount > 0
          ),
      };
    },

    drag(ev: DragAction<Folder>) {
      ev.dataTransfer.setData(DROP_FORMAT, ev.value.id);
    },

    async drop(ev: DropAction) {
      const id = ev.dataTransfer.getData(DROP_FORMAT);
      await this.model().bookmarks.move(
        id as NodeID,
        this.parentFolder.unfiltered.id,
        ev.toIndex,
      );
    },
    setCollapsed(c: boolean) {
      for (const f of <any>this.$refs.folders) f.collapsed = c;
    },
  },
});
</script>

<style></style>

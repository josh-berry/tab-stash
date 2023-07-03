<template>
  <dnd-list
    class="forest"
    v-model="parentFolder.children"
    :item-key="(item: FilteredItem<Folder, Node>) => item.unfiltered.id"
    :item-class="itemClasses"
    :accepts="accepts"
    :drag="drag"
    :drop="drop"
    ghost-displaces-items
    ghost-mimics-height
  >
    <template #item="{item}: {item: FilteredItem<Folder, Node>}">
      <Folder
        v-if="'children' in item"
        ref="folders"
        :folder="item"
        is-toplevel
      />
    </template>
  </dnd-list>
</template>

<script lang="ts">
import {defineComponent, type PropType} from "vue";

import {required} from "../util";

import the from "@/globals-ui";
import type {Folder, Node, NodeID} from "../model/bookmarks";
import type {FilteredItem, FilteredParent} from "../model/filtered-tree";

import type {DragAction, DropAction} from "../components/dnd-list";
import DndList from "../components/dnd-list.vue";
import FolderVue from "./folder.vue";

const DROP_FORMAT = "application/x-tab-stash-folder-id";

export default defineComponent({
  components: {DndList, Folder: FolderVue},

  props: {
    parentFolder: required(Object as PropType<FilteredParent<Folder, Node>>),
  },

  computed: {
    accepts() {
      return DROP_FORMAT;
    },
  },

  methods: {
    itemClasses(f: FilteredItem<Folder, Node>): Record<string, boolean> {
      return {
        hidden:
          !("children" in f) ||
          !(
            f.isMatching ||
            f.hasMatchingChildren ||
            f.unfiltered.$recursiveStats.selectedCount > 0
          ),
      };
    },

    drag(ev: DragAction<FilteredItem<Folder, Node>>) {
      ev.dataTransfer.setData(DROP_FORMAT, ev.value.unfiltered.id);
    },

    async drop(ev: DropAction) {
      const id = ev.dataTransfer.getData(DROP_FORMAT);
      await the.model.bookmarks.move(
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

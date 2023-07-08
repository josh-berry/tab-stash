<template>
  <dnd-list
    class="forest"
    v-model="parentFolder.children"
    :item-key="(item: Node) => item.id"
    :item-class="itemClasses"
    :accepts="accepts"
    :drag="drag"
    :drop="drop"
    ghost-displaces-items
    ghost-mimics-height
  >
    <template #item="{item}: {item: Node}">
      <Folder v-if="isFolder(item)" ref="folders" :folder="item" is-toplevel />
    </template>
  </dnd-list>
</template>

<script lang="ts">
import {defineComponent, type PropType} from "vue";

import {required} from "../util";

import the from "@/globals-ui";
import {
  isFolder,
  type Folder,
  type Node,
  type NodeID,
} from "../model/bookmarks";

import type {DragAction, DropAction} from "../components/dnd-list";
import DndList from "../components/dnd-list.vue";
import FolderVue from "./folder.vue";

const DROP_FORMAT = "application/x-tab-stash-folder-id";

export default defineComponent({
  components: {DndList, Folder: FolderVue},

  props: {
    parentFolder: required(Object as PropType<Folder>),
  },

  computed: {
    accepts() {
      return DROP_FORMAT;
    },
  },

  methods: {
    isFolder,

    itemClasses(f: Node): Record<string, boolean> {
      const fi = the.model.filter.info(f);
      const si = the.model.selection.info(f);
      return {
        hidden:
          !isFolder(f) || !(fi.hasMatchInSubtree || si.hasSelectionInSubtree),
      };
    },

    drag(ev: DragAction<Node>) {
      ev.dataTransfer.setData(DROP_FORMAT, ev.value.id);
    },

    async drop(ev: DropAction) {
      const id = ev.dataTransfer.getData(DROP_FORMAT);
      await the.model.bookmarks.move(
        id as NodeID,
        this.parentFolder.id,
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

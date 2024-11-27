<template>
  <load-more
    v-if="!parentFolder.isLoaded"
    :load="loadMore"
    :is-fully-loaded="false"
  />

  <dnd-list
    v-else
    class="forest"
    v-model="parentFolder.children as Node[]"
    :item-key="(item: Node) => item.id"
    :accepts="accepts"
    :drag="drag"
    :drop="drop"
    orientation="grid"
  >
    <template #item="{item}: {item: Node}">
      <Folder v-if="isVisible(item)" ref="folders" :folder="item" is-toplevel />
    </template>
  </dnd-list>
</template>

<script lang="ts">
import {defineComponent, type PropType} from "vue";

import {required} from "../util/index.js";

import the from "../globals-ui.js";
import {isFolder, type Folder, type Node} from "../model/bookmarks.js";

import type {DragAction, DropAction} from "../components/dnd-list.js";
import DndList from "../components/dnd-list.vue";
import FolderVue from "./folder.vue";
import LoadMore from "../components/load-more.vue";

const DROP_FORMAT = "application/x-tab-stash-folder-id";

export default defineComponent({
  components: {DndList: DndList<Node>, Folder: FolderVue, LoadMore},

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

    isVisible(f: Node): f is Folder {
      const fi = the.model.filter.info(f);
      const si = the.model.selection.info(f);
      return isFolder(f) && (fi.hasMatchInSubtree || si.hasSelectionInSubtree);
    },

    async loadMore() {
      await the.model.bookmarks.loaded(this.parentFolder);
    },

    drag(ev: DragAction<Node>) {
      ev.dataTransfer.setData(DROP_FORMAT, ev.value.id);
    },

    async drop(ev: DropAction) {
      const id = ev.dataTransfer.getData(DROP_FORMAT);
      const node = the.model.bookmarks.node(id);
      if (!node) throw new Error(`${id}: No such bookmark node`);

      await the.model.bookmarks.move(node, this.parentFolder, ev.toIndex);
    },
    setCollapsed(c: boolean) {
      for (const f of <any>this.$refs.folders) f.collapsed = c;
    },
  },
});
</script>

<style></style>

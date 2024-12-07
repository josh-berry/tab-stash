<template>
  <load-more
    v-if="!parentFolder.isLoaded"
    :load="loadMore"
    :is-fully-loaded="false"
  />

  <dnd-list
    v-else
    class="forest"
    orientation="grid"
    v-model="parentFolder.children as Node[]"
    :item-key="(item: Node) => item.id"
    :item-accepts="itemAccepts"
    :list-accepts="_ => false"
    @drag="drag"
    @drop="drop"
  >
    <template #item="{item}: {item: Node}">
      <Folder v-if="isVisible(item)" :folder="item" is-toplevel />
    </template>
  </dnd-list>
</template>

<script lang="ts">
import {defineComponent, type PropType} from "vue";

import {required} from "../util/index.js";

import the from "../globals-ui.js";
import {isFolder, type Folder, type Node} from "../model/bookmarks.js";

import DndList, {
  type ListDragEvent,
  type ListDropEvent,
} from "../components/dnd-list.vue";
import FolderVue from "./folder.vue";
import LoadMore from "../components/load-more.vue";
import type {DNDAcceptedDropPositions} from "../components/dnd.js";
import {logErrorsFrom} from "../util/oops.js";

const DROP_FORMAT = "application/x-tab-stash-folder-id";

export default defineComponent({
  components: {DndList: DndList<Node>, Folder: FolderVue, LoadMore},

  props: {
    parentFolder: required(Object as PropType<Folder>),
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

    itemAccepts(
      data: DataTransfer,
      item: Node,
      index: number,
    ): DNDAcceptedDropPositions {
      if (!data.types.includes(DROP_FORMAT)) return null;
      return "before-after";
    },

    drag(ev: ListDragEvent<Node>) {
      ev.data.setData(DROP_FORMAT, ev.item.id);
    },

    drop(ev: ListDropEvent) {
      logErrorsFrom(() =>
        the.model.attempt(async () => {
          const id = ev.data.getData(DROP_FORMAT);
          const node = the.model.bookmarks.node(id);
          if (!node) throw new Error(`${id}: No such bookmark node`);

          await the.model.bookmarks.move(
            node,
            this.parentFolder,
            ev.insertBeforeIndex,
          );
        }),
      );
    },

    setCollapsed(c: boolean) {
      for (const f of <any>this.$refs.folders) f.collapsed = c;
    },
  },
});
</script>

<style></style>

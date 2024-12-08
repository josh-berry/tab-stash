<template>
  <load-more
    v-if="!parentFolder.isLoaded"
    :load="loadMore"
    :is-fully-loaded="false"
  />

  <dnd-list
    v-else
    class="forest"
    :orientation="orientation"
    v-model="parentFolder.children as Node[]"
    :item-key="(item: Node) => item.id"
    :item-class="itemClass"
    :item-accepts="itemAccepts"
    :list-accepts="_ => false"
    @drag="drag"
    @drop="drop"
    @drop-inside="dropInside"
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
  type ListDropInsideEvent,
} from "../components/dnd-list.vue";
import FolderVue from "./folder.vue";
import LoadMore from "../components/load-more.vue";
import type {DNDAcceptedDropPositions} from "../components/dnd.js";
import {dragDataType, recvDragData, sendDragData} from "./dnd-proto.js";

export default defineComponent({
  components: {DndList: DndList<Node>, Folder: FolderVue, LoadMore},

  props: {
    parentFolder: required(Object as PropType<Folder>),
  },

  computed: {
    orientation() {
      if (document.documentElement.dataset.view === "tab") return "horizontal";
      return "vertical";
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

    itemClass(item: Node, index: number): Record<string, boolean> {
      if (the.model.bookmark_metadata.get(item.id).value?.collapsed) {
        return {collapsed: true};
      } else {
        return {};
      }
    },

    itemAccepts(
      data: DataTransfer,
      item: Node,
      index: number,
    ): DNDAcceptedDropPositions {
      const type = dragDataType(data);
      if (type === "folders") return "before-inside-after";
      if (type !== undefined) return "inside";
      return null;
    },

    drag(ev: ListDragEvent<Node>) {
      sendDragData(ev.data, [ev.item]);
    },

    drop(ev: ListDropEvent) {
      the.model.attempt(async () => {
        const items = recvDragData(ev.data, the.model);

        await the.model.putItemsInFolder({
          items,
          toFolder: this.parentFolder,
          toIndex: ev.insertBeforeIndex,
          allowDuplicates: true,
        });
      });
    },

    dropInside(ev: ListDropInsideEvent<Node>) {
      the.model.attempt(async () => {
        const items = recvDragData(ev.data, the.model);

        const folder = ev.insertInParent;
        if (!isFolder(folder)) {
          throw new Error(`${folder.title}: Not a folder [${folder.id}]`);
        }

        await the.model.putItemsInFolder({
          items,
          toFolder: folder,
          allowDuplicates: true,
        });
      });
    },
  },
});
</script>

<style></style>

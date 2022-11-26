<template>
  <dnd-list
    class="folder-list"
    v-model="children"
    item-key="id"
    :item-class="(f: Node) => ({hidden: ! ('children' in f) || ! f.$visible})"
    :accepts="accepts"
    :drag="drag"
    :drop="drop"
    :mimic-height="true"
  >
    <template #item="{item: f}">
      <Folder
        v-if="'children' in f"
        ref="folders"
        :folder="f"
        :metadata="model().bookmark_metadata.get(f.id)"
      />
    </template>
  </dnd-list>
</template>

<script lang="ts">
import type {PropType} from "vue";
import {defineComponent} from "vue";

import {required} from "../util";

import type {Model} from "../model";
import type {Folder, Node, NodeID} from "../model/bookmarks";
import type {DragAction, DropAction} from "../components/dnd-list";

import DndList from "../components/dnd-list.vue";
import FolderVue from "./folder.vue";

const DROP_FORMAT = "application/x-tab-stash-folder-id";

export default defineComponent({
  components: {DndList, Folder: FolderVue},

  inject: ["$model"],

  props: {
    parentFolder: required(Object as PropType<Folder>),
  },

  computed: {
    accepts() {
      return DROP_FORMAT;
    },
    children(): readonly Node[] {
      return this.model().bookmarks.childrenOf(this.parentFolder);
    },
  },

  methods: {
    model(): Model {
      return (<any>this).$model as Model;
    },

    drag(ev: DragAction<Folder>) {
      ev.dataTransfer.setData(DROP_FORMAT, ev.value.id);
    },

    async drop(ev: DropAction) {
      const id = ev.dataTransfer.getData(DROP_FORMAT);
      await this.model().bookmarks.move(
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

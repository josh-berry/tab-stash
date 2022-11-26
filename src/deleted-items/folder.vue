<template>
  <div v-if="loading" class="folder-item deleted loading">
    <span class="item-icon icon spinner size-icon" />
    <span class="text status-text">{{ loading }}...</span>
  </div>

  <div v-else>
    <div class="folder-item deleted action-container">
      <span class="item-icon icon icon-folder" />
      <span class="text" :title="tooltip">{{ friendlyTitle }}</span>
      <ButtonBox>
        <Button class="stash" tooltip="Restore" @action="restore" />
        <Menu
          class="menu"
          summaryClass="action remove last-toolbar-button"
          title="Delete Forever"
          inPlace
        >
          <button @click.prevent.stop="remove">Delete Forever</button>
        </Menu>
      </ButtonBox>
    </div>

    <ul class="folder-item-nesting">
      <Bookmark
        v-for="(child, index) of leafChildren"
        :key="index"
        :parent="deletion"
        :child="child"
        :childIndex="index"
      >
        <span class="indent"></span>
      </Bookmark>
      <li v-if="item.filtered_count" class="folder-item disabled">
        <span class="indent" />
        <span class="icon" />
        <span class="text status-text hidden-count">
          + {{ item.filtered_count }} filtered
        </span>
      </li>
    </ul>
  </div>
</template>

<script lang="ts">
import {type PropType, defineComponent} from "vue";

import {filterMap, required} from "../util";
import type {Model} from "../model";
import type {DeletedBookmark, DeletedFolder} from "../model/deleted-items";
import {friendlyFolderName} from "../model/bookmarks";
import type {FilteredDeletion, FilteredCount} from "./schema";

import Button from "../components/button.vue";
import ButtonBox from "../components/button-box.vue";
import Menu from "../components/menu.vue";
import Bookmark from "./bookmark.vue";

export default defineComponent({
  components: {Button, ButtonBox, Menu, Bookmark},
  inject: ["$model"],

  props: {
    deletion: required(Object as PropType<FilteredDeletion>),
  },

  data: () => ({
    loading: "",
  }),

  computed: {
    friendlyTitle(): string {
      return friendlyFolderName(this.item.title);
    },
    item(): FilteredCount<DeletedFolder> {
      return this.deletion.item as DeletedFolder;
    },
    deletedAt(): string {
      return this.deletion.deleted_at.toLocaleString();
    },
    leafChildren(): DeletedBookmark[] {
      return filterMap(this.item.children, i =>
        !("children" in i) ? i : undefined,
      );
    },
    tooltip(): string {
      return `${this.item.title}\nDeleted ${this.deletedAt}`;
    },
  },

  methods: {
    model(): Model {
      return (<any>this).$model;
    },

    run(what: string, f: () => Promise<void>) {
      if (this.loading != "") return;
      this.loading = what;
      const p = this.model().attempt(f);
      p.finally(() => {
        this.loading = "";
      });
    },

    restore() {
      this.run("Restoring", async () => {
        await this.model().undelete(this.deletion);
      });
    },

    remove() {
      this.run("Deleting Forever", async () => {
        await this.model().deleted_items.drop(this.deletion.key);
      });
    },
  },
});
</script>

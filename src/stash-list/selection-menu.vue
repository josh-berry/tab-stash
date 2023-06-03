<template>
  <Menu
    ref="menu"
    class="menu selection-menu"
    modalClass="action-container"
    @open="onOpenMenu"
  >
    <template #summary>
      <div class="count">{{ selectedCount }}</div>
      <div class="icon icon-move-menu-inverse"></div>
    </template>

    <button
      tabindex="0"
      title="Open stashed tabs"
      @click.prevent="copyToWindow"
    >
      <span class="menu-icon icon icon-restore"></span>
      <span>Open</span>
    </button>
    <button
      tabindex="0"
      title="Open tabs and delete them from the stash"
      @click.prevent="moveToWindow"
    >
      <span class="menu-icon icon icon-restore-del"></span>
      <span>Unstash</span>
    </button>

    <hr />

    <search-input
      ref="search"
      placeholder="Search or create group"
      v-model="searchText"
      @click.stop=""
      @keypress.enter.prevent.stop="
        create($event);
        closeMenu();
      "
    />

    <button :title="createTooltip" @click.prevent="create">
      <span class="menu-icon icon icon-new-empty-group"></span>
      <span>{{ createTitle }}</span>
    </button>

    <hr />

    <select-folder
      v-if="model().bookmarks.stash_root.value"
      class="menu-scrollable-list"
      :tree="filteredTree"
      :folder="filteredTree.wrappedParent(model().bookmarks.stash_root.value!)"
      :tooltips="
        f =>
          `Move to &quot;${friendlyFolderName(
            f.title,
          )}&quot; (hold ${altKey} to copy)`
      "
      :button-classes="f => ({}) /* TODO selection */"
      @select="moveTo"
    />

    <hr />

    <button
      title="Delete stashed tabs and close unstashed tabs"
      @click.prevent="remove"
    >
      <span class="menu-icon icon icon-delete"></span>
      <span>Delete or Close</span>
    </button>
  </Menu>
</template>

<script lang="ts">
import {defineComponent} from "vue";

import {altKeyName, textMatcher} from "../util";

import type {Model} from "../model";
import {
  friendlyFolderName,
  isFolder,
  type Folder,
  type Node,
} from "../model/bookmarks";
import {FilteredTree} from "../model/filtered-tree";

import Menu from "../components/menu.vue";
import SearchInput from "../components/search-input.vue";
import SelectFolder from "./select-folder.vue";

export default defineComponent({
  components: {Menu, SearchInput, SelectFolder},

  // If `props` is an empty object, Vue thinks the props of the component are of
  // type `unknown` rather than `{}`. See:
  // https://github.com/vuejs/core/issues/4051
  //
  // props: {},

  data: () => ({
    searchText: "",
  }),

  inject: ["$model"],

  computed: {
    altKey: altKeyName,

    filteredTree(): FilteredTree<Folder, Node> {
      const self = this;
      return new FilteredTree<Folder, Node>({
        isParent(node): node is Folder {
          return isFolder(node);
        },
        predicate(node) {
          return isFolder(node) && self.filter(friendlyFolderName(node.title));
        },
      });
    },

    selectedCount(): number {
      return this.model().selection.selectedCount.value;
    },

    filter(): (text: string) => boolean {
      return textMatcher(this.searchText);
    },

    createTitle(): string {
      if (this.searchText === "") return "Move to New Group";
      return `Move to "${this.searchText}"`;
    },

    createTooltip(): string {
      const copy = `(hold ${this.altKey} to copy)`;
      if (this.searchText === "") return `Move to a new group ${copy}`;
      return `Move to new group "${this.searchText}" ${copy}`;
    },
  },

  methods: {
    model(): Model {
      return (<any>this).$model as Model;
    },
    attempt(fn: () => Promise<void>) {
      this.model().attempt(fn);
    },

    friendlyFolderName,

    closeMenu() {
      (<any>this.$refs.menu).close();
    },

    onOpenMenu() {
      this.searchText = "";
      (<any>this.$refs.search).focus();
    },

    create(ev: MouseEvent | KeyboardEvent) {
      this.attempt(async () => {
        const model = this.model();
        let folder: Folder;
        if (!this.searchText) {
          folder = await model.bookmarks.createStashFolder();
        } else {
          const stash_root = await model.bookmarks.ensureStashRoot();
          folder = (await model.bookmarks.create({
            parentId: stash_root.id,
            title: this.searchText,
            index: 0,
          })) as Folder;
        }
        this.moveTo(ev, folder);
      });
    },

    moveTo(ev: MouseEvent | KeyboardEvent, folder: Folder) {
      this.attempt(() =>
        this.model().putSelectedInFolder({
          copy: ev.altKey,
          toFolderId: folder.id,
        }),
      );
    },

    copyToWindow() {
      this.attempt(() => this.model().putSelectedInWindow({copy: true}));
    },

    moveToWindow() {
      this.attempt(() => this.model().putSelectedInWindow({copy: false}));
    },

    remove() {
      this.attempt(async () => {
        const model = this.model();
        const ids = Array.from(model.selectedItems()).map(i => i.id);
        await model.deleteItems(ids);
      });
    },
  },
});
</script>

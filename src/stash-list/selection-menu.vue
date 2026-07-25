<template>
  <Menu
    ref="menu"
    class="selection-menu"
    modalClass="action-container"
    @open="onOpenMenu"
  >
    <template #summary>
      <div class="count">{{ selectedCount }}</div>
      <div class="icon icon-move-menu-inverse"></div>
    </template>

    <button
      tabindex="0"
      :title="$t('openSelectedTooltip')"
      @click.prevent="copyToWindow"
    >
      <span class="menu-icon icon icon-restore"></span>
      <span>{{ $t("openSelectedButton") }}</span>
    </button>
    <button
      tabindex="0"
      :title="$t('unstashSelectedTooltip')"
      @click.prevent="moveToWindow"
    >
      <span class="menu-icon icon icon-restore-del"></span>
      <span>{{ $t("unstashSelectedButton") }}</span>
    </button>

    <hr />

    <button
      @click.prevent="showExportDialog"
      :title="$t('exportSelectedTooltip')"
    >
      <span class="menu-icon icon icon-export" />
      <span>{{ $t("exportMenu") }}</span>
    </button>
    <hr />

    <search-input
      ref="search"
      :placeholder="$t('searchOrCreateGroupPlaceholder')"
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
      v-if="stashRoot"
      class="menu-scrollable-list"
      :folder="stashRoot"
      :filter="nodeFilterFn"
      :tooltips="
        f => $t('moveToFolderTooltip', [friendlyFolderName(f.title), altKey])
      "
      :button-classes="f => ({}) /* TODO selection */"
      @select="moveTo"
    />

    <hr />

    <button :title="$t('deleteSelectedTooltip')" @click.prevent="remove">
      <span class="menu-icon icon icon-delete"></span>
      <span>{{ $t("deleteSelectedButton") }}</span>
    </button>
  </Menu>

  <export-dialog
    v-if="selectedItemsToExport.length > 0"
    :items="selectedItemsToExport"
    @close="selectedItemsToExport = []"
  />
</template>

<script lang="ts">
import {computed, defineComponent} from "vue";

import {altKeyName, textMatcher, $t} from "../util/index.js";

import the from "../globals-ui.js";
import {
  friendlyFolderName,
  isFolder,
  type Folder,
  type Node,
} from "../model/bookmarks.js";
import {TreeFilter} from "../model/tree-filter.js";

import Menu from "../components/menu.vue";
import SearchInput from "../components/search-input.vue";
import SelectFolder from "./select-folder.vue";
import ExportDialog from "../tasks/export.vue";
import type {StashItem} from "../model/index.js";

export default defineComponent({
  components: {Menu, SearchInput, SelectFolder, ExportDialog},

  // If `props` is an empty object, Vue thinks the props of the component are of
  // type `unknown` rather than `{}`. See:
  // https://github.com/vuejs/core/issues/4051
  //
  // props: {},

  data: () => ({
    searchText: "",
    selectedItemsToExport: [] as StashItem[],
  }),

  computed: {
    altKey: altKeyName,

    stashRoot(): Folder | undefined {
      return the.model.bookmarks.stash_root.value;
    },

    selectedCount(): number {
      return the.model.selection.selectedCount.value;
    },

    filter(): (node: Folder | Node) => boolean {
      const matcher = textMatcher(this.searchText);
      return node => isFolder(node) && matcher(friendlyFolderName(node.title));
    },

    nodeFilterFn() {
      const tree = new TreeFilter<Folder, Node>(
        isFolder,
        computed(() => this.filter),
      );

      return (node: Node) => {
        const i = tree.info(node);
        return i.isMatching || i.hasMatchInSubtree;
      };
    },

    createTitle(): string {
      if (this.searchText === "") return $t("moveToNewGroupMenu");
      return $t("moveToGroupSearchMenu", [this.searchText]);
    },

    createTooltip(): string {
      if (this.searchText === "")
        return $t("moveToNewGroupTooltip", [this.altKey]);
      return $t("moveToGroupSearchTooltip", [this.searchText, this.altKey]);
    },
  },

  methods: {
    $t,
    attempt(fn: () => Promise<void>) {
      the.model.attempt(fn);
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
        let folder: Folder;
        if (!this.searchText) {
          folder = await the.model.createStashFolder();
        } else {
          const stash_root = await the.model.bookmarks.ensureStashRoot();
          folder = (await the.model.bookmarks.create({
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
        the.model.putSelectedInFolder({
          copy: ev.altKey,
          toFolder: folder,
        }),
      );
    },

    copyToWindow() {
      this.attempt(() => the.model.putSelectedInWindow({copy: true}));
    },

    moveToWindow() {
      this.attempt(() => the.model.putSelectedInWindow({copy: false}));
    },

    showExportDialog() {
      this.selectedItemsToExport = Array.from(
        the.model.selection.selectedItems(),
      );
    },

    remove() {
      this.attempt(async () => {
        await the.model.deleteItems(
          Array.from(the.model.selection.selectedItems()),
        );
      });
    },
  },
});
</script>

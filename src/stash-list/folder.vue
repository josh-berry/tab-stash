<template>
  <div
    :class="{
      'forest-item': true,
      selectable: true,
      folder: true,
      'action-container': true,
      'has-open-tabs': openTabsCount > 0,
      collapsed: collapsed,
      selected: folder.$selected,
      'no-match': !folder.$visible,
    }"
    :data-id="folder.id"
  >
    <item-icon
      :class="{
        'forest-icon': true,
        action: true,
        select: true,
        'icon-folder': !folder.$selected,
        'icon-folder-selected-inverse': folder.$selected,
      }"
      @click.prevent.stop="select"
    />

    <Button
      :class="{
        'forest-collapse': true,
        action: true,
        collapse: !collapsed,
        expand: collapsed,
      }"
      :tooltip="`Hide the tabs for this group (hold ${altKey} to hide tabs for child folders)`"
      @action="toggleCollapsed"
    />
    <ButtonBox v-if="!isRenaming && selectedCount === 0" class="forest-toolbar">
      <Button
        class="stash here"
        @action="stash"
        :tooltip="`Stash all (or highlighted) open tabs to this group (hold ${altKey} to keep tabs open)`"
      />
      <Button
        class="stash one here"
        @action="stashOne"
        :tooltip="
          `Stash the active tab to this group ` +
          `(hold ${altKey} to keep tabs open)`
        "
      />
      <Button
        class="restore"
        @action="restoreAll"
        :tooltip="
          `Open all tabs in this group ` +
          `(hold ${bgKey} to open in background)`
        "
      />
      <Button
        class="restore-remove"
        @action="restoreAndRemove"
        :tooltip="
          `Open all tabs in the group and delete the group ` +
          `(hold ${bgKey} to open in background)`
        "
      />
      <Menu
        class="menu"
        summaryClass="action neutral icon-item-menu last-toolbar-button"
        inPlace
        h-position="right"
      >
        <button
          @click.prevent="newChildFolder"
          :title="`Create a new sub-group within this group`"
        >
          <span class="icon icon-new-empty-group"></span>
          <span>New Child Group</span>
        </button>
        <hr />
        <div class="menu-item disabled status-text">Stash here:</div>
        <ul class="menu-scrollable-list">
          <li v-for="tab of unstashedTabs" :key="tab.id">
            <a
              :href="tab.url"
              :title="`Stash tab to this group (hold ${altKey} to keep tab open)`"
              @click.prevent.stop="stashSpecificTab($event, tab)"
            >
              <item-icon is="span" :src="tab.favIconUrl" />
              <span>{{ tab.title }}</span>
            </a>
          </li>
        </ul>
        <hr />
        <button
          @click.prevent="closeStashedTabs"
          :title="`Close any open tabs that are stashed in this group`"
        >
          <span class="icon icon-delete-stashed" />
          <span>Close Stashed Tabs</span>
        </button>
        <hr />
        <button
          title="Delete the whole group and all its sub-groups"
          @click.prevent="remove"
        >
          <span class="icon icon-delete"></span>
          <span>Delete Group</span>
        </button>
      </Menu>
    </ButtonBox>

    <ButtonBox
      v-else-if="!isRenaming && canMoveIntoFolder"
      class="forest-toolbar"
    >
      <Button
        class="stash here"
        @action="move"
        :tooltip="`Move ${selectedCount} selected tab(s) to this group (hold ${altKey} to copy)`"
      />
      <Button
        class="stash newgroup"
        @action="moveToChild"
        :tooltip="`Move ${selectedCount} selected tab(s) to a new sub-group (hold ${altKey} to copy)`"
      />
    </ButtonBox>

    <span
      v-if="!isRenaming"
      class="forest-title editable"
      :title="tooltip"
      @click.stop="isRenaming = true"
      >{{ title }}</span
    >
    <async-text-input
      v-else
      class="forest-title editable"
      :title="tooltip"
      :value="nonDefaultTitle"
      :defaultValue="defaultTitle"
      :save="rename"
      @done="isRenaming = false"
    />
  </div>

  <dnd-list
    :class="{'forest-children': true, collapsed}"
    v-model="childrenWithTabs"
    item-key="id"
    :item-class="childClasses"
    :accepts="accepts"
    :drag="drag"
    :drop="drop"
  >
    <template #item="{item}">
      <bookmark
        v-if="'url' in item.node"
        :bookmark="item.node"
        :relatedTabs="item.tabs"
      />
      <child-folder
        v-else-if="'children' in item.node"
        :folder="item.node"
        :metadata="model().bookmark_metadata.get(item.id)"
      />
    </template>
  </dnd-list>

  <ul v-if="filterCount > 0" :class="{'forest-children': true, collapsed}">
    <li>
      <div
        class="forest-item selectable"
        @click.prevent.stop="showFiltered = !showFiltered"
      >
        <span class="forest-title status-text">
          {{ showFiltered ? "-" : "+" }} {{ filterCount }} filtered
        </span>
      </div>
    </li>
  </ul>
</template>

<script lang="ts">
import {defineComponent, type PropType} from "vue";

import type {DragAction, DropAction} from "../components/dnd-list";
import {
  altKeyName,
  bgKeyName,
  bgKeyPressed,
  filterMap,
  required,
} from "../util";

import type {Model, StashItem} from "../model";
import type {BookmarkMetadataEntry} from "../model/bookmark-metadata";
import type {Bookmark, Folder, Node, NodeID} from "../model/bookmarks";
import {
  friendlyFolderName,
  genDefaultFolderName,
  getDefaultFolderNameISODate,
} from "../model/bookmarks";
import type {Tab} from "../model/tabs";

import AsyncTextInput from "../components/async-text-input.vue";
import ButtonBox from "../components/button-box.vue";
import Button from "../components/button.vue";
import DndList from "../components/dnd-list.vue";
import ItemIcon from "../components/item-icon.vue";
import Menu from "../components/menu.vue";
import BookmarkVue from "./bookmark.vue";

type NodeWithTabs = {node: Node; id: NodeID; tabs: Tab[]};

const DROP_FORMATS = ["application/x-tab-stash-items"];

export default defineComponent({
  name: "child-folder",

  components: {
    AsyncTextInput,
    ButtonBox,
    Button,
    DndList,
    Bookmark: BookmarkVue,
    ItemIcon,
    Menu,
  },

  inject: ["$model"],

  props: {
    // Bookmark folder
    folder: required(Object as PropType<Folder>),

    metadata: required(Object as PropType<BookmarkMetadataEntry>),
  },

  data: () => ({
    isRenaming: false,
    showFiltered: false,
  }),

  computed: {
    altKey: altKeyName,
    bgKey: bgKeyName,

    accepts() {
      return DROP_FORMATS;
    },

    targetWindow(): number | undefined {
      return this.model().tabs.targetWindow.value;
    },

    childrenWithTabs(): readonly NodeWithTabs[] {
      const mtabs = this.model().tabs;
      return this.children.map(n => ({
        id: n.id,
        node: n,
        tabs:
          "url" in n && n.url
            ? Array.from(mtabs.tabsWithURL(n.url)).filter(
                t => t.windowId === this.targetWindow,
              )
            : [],
      }));
    },

    childTabStats(): {open: number; discarded: number; hidden: number} {
      let open = 0,
        discarded = 0,
        hidden = 0;
      for (const nwt of this.childrenWithTabs) {
        for (const tab of nwt.tabs) {
          if (tab.windowId !== this.targetWindow) {
            continue;
          }
          if (tab.hidden) {
            hidden += 1;
          } else if (tab.discarded) {
            discarded += 1;
          } else {
            open += 1;
          }
        }
      }
      return {open, discarded, hidden};
    },

    openTabsCount(): number {
      return this.childTabStats.open + this.childTabStats.discarded;
    },

    children(): readonly Node[] {
      return this.model().bookmarks.childrenOf(this.folder);
    },

    collapsed: {
      get(): boolean {
        return !!this.metadata.value?.collapsed;
      },
      set(collapsed: boolean) {
        this.model().bookmark_metadata.setCollapsed(
          this.metadata.key,
          collapsed,
        );
      },
    },

    // Used to populate a menu of tabs to select for stashing here
    unstashedTabs(): Tab[] {
      const model = this.model();
      const target_win = model.tabs.targetWindow.value;
      if (!target_win) return [];
      const win = model.tabs.window(target_win);
      if (!win) return [];

      return filterMap(win.tabs, id => model.tabs.tab(id)).filter(
        t =>
          !t.pinned &&
          !t.hidden &&
          model.isURLStashable(t.url) &&
          !model.bookmarks.isURLStashed(t.url),
      );
    },

    /** Returns a "default" name to use if no explicit name is set.  This
     * default is typically a timestamp with one of two sources--if the
     * folder has a title that looks like a "default" title, we use that.
     * Otherwise we generate the default name from the folder's creation
     * time.
     *
     * This approach handles unnamed folders which were synced from
     * elsewhere and thus have a creation time that isn't their actual
     * creation time. */
    defaultTitle(): string {
      if (getDefaultFolderNameISODate(this.folder.title) !== null) {
        return friendlyFolderName(this.folder.title);
      } else {
        return `Saved ${new Date(this.folder.dateAdded || 0).toLocaleString()}`;
      }
    },
    nonDefaultTitle(): string {
      return getDefaultFolderNameISODate(this.folder.title) !== null
        ? ""
        : this.folder.title;
    },
    title(): string {
      return friendlyFolderName(this.folder.title);
    },
    tooltip(): string {
      const bm_stats = this.folder.$stats;
      const st = this.childTabStats;
      const statstip = `${bm_stats.folderCount} sub-group${
        bm_stats.folderCount !== 1 ? "s" : ""
      }, ${bm_stats.bookmarkCount} stashed tab${
        bm_stats.bookmarkCount != 1 ? "s" : ""
      } (${st.open} open, ${st.discarded} unloaded, ${st.hidden} hidden)`;
      return `${this.title}\n${statstip}`;
    },

    validChildren(): (Bookmark | Folder)[] {
      return filterMap(this.children, c =>
        this.isValidChild(c) ? c : undefined,
      );
    },
    visibleChildren(): (Bookmark | Folder)[] {
      return this.validChildren.filter(c => c.$visible);
    },
    filterCount(): number {
      return this.validChildren.length - this.visibleChildren.length;
    },

    leafChildren(): Bookmark[] {
      return filterMap(this.children, c => ("url" in c ? c : undefined));
    },

    selectedCount(): number {
      return this.model().selection.selectedCount.value;
    },

    canMoveIntoFolder(): boolean {
      // This loop is open-coded instead of using pathTo() for performance
      let f: Folder | undefined = this.folder;
      while (f) {
        if (f.$selected) return false;
        f = this.model().bookmarks.folder(f.parentId);
      }
      return true;
    },
  },

  methods: {
    // TODO make Vue injection play nice with TypeScript typing...
    model() {
      return (<any>this).$model as Model;
    },
    attempt(fn: () => Promise<void>): Promise<void> {
      return this.model().attempt(fn);
    },

    toggleCollapsed(ev: MouseEvent) {
      if (!ev.altKey) {
        // We're just toggling ourself.
        this.collapsed = !this.collapsed;
        return;
      }

      // Toggle the collapsed state of all the child folders
      const folders = filterMap(this.validChildren, c =>
        "children" in c ? c : undefined,
      );
      if (folders.length === 0) return;

      // We just snoop on the collapsed state of the first folder because it's
      // easier
      const collapsed =
        this.model().bookmark_metadata.get(folders[0].id).value?.collapsed ||
        false;
      for (const f of folders) {
        this.model().bookmark_metadata.setCollapsed(f.id, !collapsed);
      }
    },

    select(ev: MouseEvent) {
      this.model().attempt(async () => {
        await this.model().selection.toggleSelectFromEvent(
          ev,
          this.model().bookmarks,
          this.folder,
        );
      });
    },

    childClasses(nodet: NodeWithTabs): Record<string, boolean> {
      const node = nodet.node;
      return {
        hidden: !(
          this.isValidChild(node) &&
          (this.showFiltered ||
            node.$visible ||
            node.$selected ||
            ("$recursiveStats" in node && node.$recursiveStats.selectedCount))
        ),
      };
    },

    isValidChild(node: Node): node is Folder | Bookmark {
      return "url" in node || "children" in node;
    },

    stash(ev: MouseEvent | KeyboardEvent) {
      const model = this.model();
      const win_id = model.tabs.targetWindow.value;
      if (!win_id) return;

      model.attempt(
        async () =>
          await model.putItemsInFolder({
            items: model.copyIf(ev.altKey, model.stashableTabsInWindow(win_id)),
            toFolderId: this.folder.id,
          }),
      );
    },

    stashOne(ev: MouseEvent | KeyboardEvent) {
      const tab = this.model().tabs.activeTab();
      if (!tab) return;
      this.stashSpecificTab(ev, tab);
    },

    stashSpecificTab(ev: MouseEvent | KeyboardEvent, tab: Tab) {
      this.attempt(async () => {
        await this.model().putItemsInFolder({
          items: this.model().copyIf(ev.altKey, [tab]),
          toFolderId: this.folder.id,
        });
      });
    },

    move(ev: MouseEvent | KeyboardEvent) {
      const model = this.model();
      const win_id = model.tabs.targetWindow.value;
      if (!win_id) return;

      model.attempt(() =>
        model.putSelectedInFolder({
          copy: ev.altKey,
          toFolderId: this.folder.id,
        }),
      );
    },

    moveToChild(ev: MouseEvent | KeyboardEvent) {
      const model = this.model();
      const win_id = model.tabs.targetWindow.value;
      if (!win_id) return;

      model.attempt(async () => {
        const f = await model.bookmarks.create({
          parentId: this.folder.id,
          title: genDefaultFolderName(new Date()),
        });
        await model.putSelectedInFolder({
          copy: ev.altKey,
          toFolderId: f.id,
        });
      });
    },

    restoreAll(ev: MouseEvent | KeyboardEvent) {
      this.attempt(async () => {
        await this.model().restoreTabs(this.leafChildren, {
          background: bgKeyPressed(ev),
        });
      });
    },

    remove() {
      this.attempt(async () => {
        await this.model().deleteBookmarkTree(this.folder.id);
      });
    },

    restoreAndRemove(ev: MouseEvent | KeyboardEvent) {
      this.attempt(async () => {
        const bg = bgKeyPressed(ev);

        await this.model().restoreTabs(this.leafChildren, {background: bg});

        if (this.leafChildren.length === this.children.length) {
          await this.model().deleteBookmarkTree(this.folder.id);
        } else {
          const children = this.leafChildren.map(c => c.id);
          await this.model().deleteItems(children);
        }
      });
    },

    rename(title: string) {
      return this.attempt(async () => {
        if (title === "") {
          if (getDefaultFolderNameISODate(this.folder.title) !== null) {
            // It already has a default name; leave it alone so we don't
            // lose track of when the folder was actually created.
            return;
          }

          // Else give it a default name based on the creation time
          title = genDefaultFolderName(new Date(this.folder.dateAdded || 0));
        }

        await this.model().bookmarks.rename(this.folder, title);
      });
    },

    newChildFolder() {
      return this.attempt(async () => {
        await this.model().bookmarks.create({
          parentId: this.folder.id,
          title: genDefaultFolderName(new Date()),
        });
      });
    },

    closeStashedTabs() {
      return this.attempt(async () => {
        const model = this.model();
        const openTabs = this.childrenWithTabs
          .flatMap(c => c.tabs)
          .filter(t => !t.hidden && !t.pinned);
        await model.hideOrCloseStashedTabs(openTabs.map(t => t.id));
      });
    },

    drag(ev: DragAction<NodeWithTabs>) {
      const items = ev.value.node.$selected
        ? Array.from(this.model().selectedItems())
        : [ev.value.node];
      ev.dataTransfer.setData(
        "application/x-tab-stash-items",
        JSON.stringify(items),
      );
    },

    async drop(ev: DropAction) {
      const data = ev.dataTransfer.getData("application/x-tab-stash-items");
      const items = JSON.parse(data) as StashItem[];

      const model = this.model();
      await model.attempt(() =>
        this.model().putItemsInFolder({
          items,
          toFolderId: this.folder.id,
          toIndex: ev.toIndex,
        }),
      );
    },
  },
});
</script>

<style></style>

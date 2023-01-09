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
    }"
    :data-id="folder.id"
  >
    <item-icon
      :class="{
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
      tooltip="Hide the tabs for this group"
      @action="collapsed = !collapsed"
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
      <Button class="remove" @action="remove" tooltip="Delete this group" />
    </ButtonBox>

    <ButtonBox v-else-if="!isRenaming" class="forest-toolbar">
      <Button
        class="stash here"
        @action="move"
        :tooltip="`Move ${selectedCount} selected tab(s) to this group (hold ${altKey} to copy)`"
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
        :class="{'folder-item': true, 'no-match': !item.node.$visible}"
      />
      <child-folder
        v-else-if="'children' in item.node"
        :folder="item.node"
        :metadata="model().bookmark_metadata.get(item.id)"
        :class="{
          hidden: !item.node.$visible && !item.node.$visibleChildren,
        }"
      />
    </template>
  </dnd-list>

  <ul :class="{'forest-children': true, collapsed}">
    <li>
      <div class="forest-item" @click.prevent.stop="newChildFolder">
        <span class="forest-title status-text">+ New Folder</span>
      </div>
    </li>
    <li v-if="filterCount > 0">
      <div
        class="forest-item"
        @click.prevent.stop="showFiltered = !showFiltered"
      >
        <span class="forest-title status-text hidden-count">
          {{ showFiltered ? "-" : "+" }} {{ filterCount }} filtered
        </span>
      </div>
    </li>
  </ul>
</template>

<script lang="ts">
import {defineComponent, type PropType} from "vue";

import type {DragAction, DropAction} from "../components/dnd-list";
import {altKeyName, bgKeyName, bgKeyPressed, required} from "../util";

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
      const st = this.childTabStats;
      const child_count = this.validChildren.length;
      const statstip = `${child_count} stashed tab${
        child_count != 1 ? "s" : ""
      } (${st.open} open, ${st.discarded} unloaded, ${st.hidden} hidden)`;
      return `${this.title}\n${statstip}`;
    },

    validChildren(): Bookmark[] {
      return this.children.filter(c => this.isValidChild(c)) as Bookmark[];
    },
    visibleChildren(): Bookmark[] {
      return this.validChildren.filter(c => c.$visible);
    },
    filterCount(): number {
      return this.validChildren.length - this.visibleChildren.length;
    },

    selectedCount(): number {
      return this.model().selection.selectedCount.value;
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
          (this.showFiltered || node.$visible)
        ),
      };
    },

    isValidChild(node: Node): boolean {
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
      this.attempt(async () => {
        const tab = this.model().tabs.activeTab();
        if (!tab) return;
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

    restoreAll(ev: MouseEvent | KeyboardEvent) {
      this.attempt(async () => {
        await this.model().restoreTabs(this.validChildren, {
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

        await this.model().restoreTabs(this.validChildren, {background: bg});
        await this.model().deleteBookmarkTree(this.folder.id);
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
          title: "Untitled",
        });
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

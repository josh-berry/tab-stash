<!--
  NOTE: This is the single most widely-used component in Tab Stash, so it's
  important to keep it as simple and fast to render as possible.  There are
  several situations (e.g. searching) where we will re-render every single
  bookmark in the tree, and we need to do so very quickly.
-->

<template>
  <div
    :class="{
      'action-container': true,
      'forest-item': true,
      selectable: true,
      discarded: tabState.discarded,
      open: tabState.open,
      active: tabState.active,
      loading: tabState.loading,
      selected: bookmark.unfiltered.$selected,
      'no-match': !bookmark.isMatching,
    }"
    :title="bookmark.unfiltered.title"
    :data-container-color="related_container_color"
  >
    <item-icon
      :class="{
        'forest-icon': true,
        action: true,
        select: true,
      }"
      default-icon="tab"
      :src="
        !bookmark.unfiltered.$selected ? favicon?.value?.favIconUrl || '' : ''
      "
      selectable
      :selected="bookmark.unfiltered.$selected"
      @click.prevent.stop="select"
    />

    <a
      v-if="!isRenaming"
      class="forest-title"
      :href="bookmark.unfiltered.url"
      target="_blank"
      draggable="false"
      ref="link"
      @click.left.prevent.stop="open"
      @auxclick.middle.exact.prevent.stop="closeOrHideOrOpen"
    >
      {{ bookmark.unfiltered.title }}
    </a>
    <async-text-input
      v-else
      class="forest-title editable"
      :value="bookmark.unfiltered.title"
      :defaultValue="defaultTitle"
      :save="rename"
      @done="isRenaming = false"
    />

    <nav
      v-memo="[isRenaming]"
      v-if="!isRenaming"
      class="action-group forest-toolbar"
    >
      <a
        class="action rename"
        title="Rename"
        @click.prevent.stop="isRenaming = true"
      />
      <a
        class="action restore-remove"
        :title="
          `Open this tab and delete it from the group ` +
          `(hold ${bgKey} to open in background)`
        "
        @click.prevent.stop="openRemove"
      />
      <a
        class="action remove"
        title="Delete this tab from the group"
        @click.prevent.stop="remove"
      />
    </nav>
  </div>
</template>

<script lang="ts">
import {defineComponent, type PropType} from "vue";

import {altKeyName, bgKeyName, bgKeyPressed, required} from "../util";

import type {Model} from "../model";
import type {Bookmark, Folder, Node} from "../model/bookmarks";
import type {FaviconEntry} from "../model/favicons";
import type {FilteredChild} from "../model/filtered-tree";
import type {Tab} from "../model/tabs";

import AsyncTextInput from "../components/async-text-input.vue";
import ItemIcon from "../components/item-icon.vue";

export type FilteredBookmark = FilteredChild<Folder, Node> & {
  readonly unfiltered: Bookmark;
};

type RelatedTabState = {
  open: boolean;
  active: boolean;
  loading: boolean;
  discarded: boolean;
  title?: string;
};

export default defineComponent({
  components: {ItemIcon, AsyncTextInput},

  inject: ["$model"],

  props: {
    bookmark: required(Object as PropType<FilteredBookmark>),
  },

  computed: {
    altkey: altKeyName,
    bgKey: bgKeyName,

    relatedTabs(): readonly Tab[] {
      const tab_model = this.model().tabs;
      const target_window = tab_model.targetWindow.value;
      return Array.from(
        tab_model.tabsWithURL(this.bookmark.unfiltered.url),
      ).filter(t => t.position?.parent.id === target_window);
    },

    related_container_color(): string | undefined {
      const containers = this.model().containers;

      // Reduce here has three states:
      //   undefined: We'll set the state if the tab isn't hidden and there's
      //     a container color associated with this tab.
      //   null: We had a container color in the state, but then we saw
      //     a different one.
      //   string: One or more tabs with a container color, and all
      //     set to the same color.
      const container_color = this.relatedTabs.reduce(
        (prev: string | undefined | null, t: Tab) => {
          if (t.hidden || prev === null || t.cookieStoreId === undefined)
            return prev;
          const cc = containers.container(t.cookieStoreId)?.color;
          if (!cc) return prev;
          return prev === undefined || cc === prev ? cc : null;
        },
        undefined,
      );
      return container_color ?? undefined;
    },

    tabState(): RelatedTabState {
      let open: boolean = false,
        active: boolean = false,
        loading: boolean = false;
      let discarded = 0;
      let title: string | undefined = undefined;
      for (const t of this.relatedTabs) {
        if (!t.hidden && t.discarded) discarded++;
        open = open || !t.hidden;
        active = active || t.active;
        loading = loading || t.status === "loading";
        if (t.title) title = t.title;
      }
      const tl = this.relatedTabs.length;
      return {
        open: !!open,
        active: !!active,
        loading: !!loading,
        discarded: tl > 0 && discarded === tl,
        title,
      };
    },

    defaultTitle(): string {
      return (
        this.tabState.title ??
        this.favicon?.value?.title ??
        this.bookmark.unfiltered.title
      );
    },

    favicon(): FaviconEntry | null {
      if (!this.bookmark.unfiltered.url) return null;
      return this.model().favicons.get(this.bookmark.unfiltered.url);
    },
  },

  data: () => ({
    isRenaming: false,
  }),

  methods: {
    // TODO make Vue injection play nice with TypeScript typing...
    model() {
      return (<any>this).$model as Model;
    },

    select(ev: MouseEvent) {
      this.model().attempt(async () => {
        await this.model().selection.toggleSelectFromEvent(
          ev,
          this.model().bookmarks,
          this.bookmark.unfiltered,
        );
      });
    },

    open(ev: MouseEvent) {
      this.model().attempt(async () => {
        (<HTMLElement>this.$refs.link).blur();

        if (!this.bookmark.unfiltered.url) return;
        const bg = bgKeyPressed(ev);

        await this.model().restoreTabs([this.bookmark.unfiltered], {
          background: bg,
        });
      });
    },

    remove() {
      this.model().attempt(async () => {
        await this.model().deleteBookmark(this.bookmark.unfiltered);
      });
    },

    closeOrHideOrOpen(ev: MouseEvent) {
      this.model().attempt(async () => {
        const openTabs = this.relatedTabs.filter(t => !t.hidden).map(t => t.id);

        // Remove keyboard focus after a middle click, otherwise focus will
        // remain within the element and it will appear to be highlighted.
        (<HTMLAnchorElement>this.$refs.link).blur();

        // If bookmark has no open tabs, open a new one in the background.
        if (openTabs.length < 1) {
          if (!this.bookmark.unfiltered.url) return;
          return await this.model().restoreTabs([this.bookmark.unfiltered], {
            background: true,
          });
        }

        // Otherwise hide or close open tabs related to this bookmark.
        await this.model().hideOrCloseStashedTabs(openTabs);
      });
    },

    openRemove(ev: MouseEvent) {
      this.model().attempt(async () => {
        if (!this.bookmark.unfiltered.url) return;
        const bg = bgKeyPressed(ev);
        await this.model().restoreTabs([this.bookmark.unfiltered], {
          background: bg,
        });
        await this.model().deleteBookmark(this.bookmark.unfiltered);
      });
    },

    rename(newName: string) {
      return this.model().attempt(async () => {
        await this.model().bookmarks.rename(
          this.bookmark.unfiltered,
          newName || this.defaultTitle,
        );
      });
    },
  },
});
</script>

<style></style>

<template>
  <div
    :class="{
      'action-container': true,
      tab: true, // TODO fix the CSS classes...
      saved: true,
      discarded: tabState.discarded,
      open: tabState.open,
      active: tabState.active,
      loading: tabState.loading,
      selected: bookmark.$selected,
    }"
    :title="bookmark.title"
    :data-id="bookmark.id"
    :data-container-color="related_container_color"
    @click.prevent.stop="select"
  >
    <item-icon
      :class="{action: true, 'item-icon': true, select: true}"
      :src="!bookmark.$selected ? favicon?.value?.favIconUrl || '' : ''"
      :default-class="{
        'icon-tab': !bookmark.$selected,
        'icon-tab-selected-inverse': bookmark.$selected,
      }"
      @click.prevent.stop="select"
    />

    <a
      v-if="!isRenaming"
      class="text"
      :href="bookmark.url"
      target="_blank"
      draggable="false"
      ref="link"
      @click.left.prevent.stop="open"
      @auxclick.middle.exact.prevent.stop="closeOrHideOrOpen"
    >
      {{ bookmark.title }}
    </a>
    <async-text-input
      v-else
      class="text ephemeral"
      :value="bookmark.title"
      :defaultValue="defaultTitle"
      :save="rename"
      @done="isRenaming = false"
    />

    <ButtonBox v-if="!isRenaming">
      <Button class="rename" @action="isRenaming = true" tooltip="Rename" />
      <Button
        class="restore-remove"
        @action="openRemove"
        :tooltip="
          `Open this tab and delete it from the group ` +
          `(hold ${bgKey} to open in background)`
        "
      />
      <Button
        class="remove"
        @action="remove"
        tooltip="Delete this tab from the group"
      />
    </ButtonBox>
  </div>
</template>

<script lang="ts">
import {defineComponent, type PropType} from "vue";

import type {Model} from "../model";
import type {Bookmark} from "../model/bookmarks";
import type {FaviconEntry} from "../model/favicons";
import type {Tab} from "../model/tabs";
import {altKeyName, bgKeyName, bgKeyPressed, required} from "../util";

import AsyncTextInput from "../components/async-text-input.vue";
import ButtonBox from "../components/button-box.vue";
import Button from "../components/button.vue";
import ItemIcon from "../components/item-icon.vue";

type RelatedTabState = {
  open: boolean;
  active: boolean;
  loading: boolean;
  discarded: boolean;
  title?: string;
};

export default defineComponent({
  components: {Button, ButtonBox, ItemIcon, AsyncTextInput},

  inject: ["$model"],

  props: {
    bookmark: required(Object as PropType<Bookmark>),
    relatedTabs: required(Object as PropType<Tab[]>),
  },

  computed: {
    altkey: altKeyName,
    bgKey: bgKeyName,

    related_container_color(): string | undefined {
      if (!this.model().options.local.state.ff_container_indicators) return;
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
        this.tabState.title ?? this.favicon?.value?.title ?? this.bookmark.title
      );
    },

    favicon(): FaviconEntry | null {
      if (!this.bookmark.url) return null;
      return this.model().favicons.get(this.bookmark.url);
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
          this.bookmark,
        );
      });
    },

    open(ev: MouseEvent) {
      this.model().attempt(async () => {
        (<HTMLElement>this.$refs.link).blur();

        if (!this.bookmark.url) return;
        const bg = bgKeyPressed(ev);

        await this.model().restoreTabs([this.bookmark], {background: bg});
      });
    },

    remove() {
      this.model().attempt(async () => {
        await this.model().deleteBookmark(this.bookmark);
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
          if (!this.bookmark.url) return;
          return await this.model().restoreTabs([this.bookmark], {
            background: true,
          });
        }

        // Otherwise hide or close open tabs related to this bookmark.
        await this.model().hideOrCloseStashedTabs(openTabs);
      });
    },

    openRemove(ev: MouseEvent) {
      this.model().attempt(async () => {
        if (!this.bookmark.url) return;
        const bg = bgKeyPressed(ev);
        await this.model().restoreTabs([this.bookmark], {background: bg});
        await this.model().deleteBookmark(this.bookmark);
      });
    },

    rename(newName: string) {
      return this.model().attempt(async () => {
        await this.model().bookmarks.rename(
          this.bookmark,
          newName || this.defaultTitle,
        );
      });
    },
  },
});
</script>

<style></style>

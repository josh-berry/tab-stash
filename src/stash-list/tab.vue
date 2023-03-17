<template>
  <div
    :class="{
      'action-container': true,
      'forest-item': true,
      selectable: true,
      open: !tab.hidden,
      active: !!tab.active,
      discarded: tab.discarded,
      loading: isLoading,
      stashed: stashedIn.length > 0,
      selected: tab.$selected,
      'no-match': !tab.$visible,
    }"
    :title="tab.title"
    :data-container-color="containerColor"
    @click.prevent.stop="select"
  >
    <item-icon
      :class="{
        'forest-icon': true,
        action: true,
        select: true,
        'icon-tab': !tab.$selected,
        'icon-tab-selected-inverse': tab.$selected,
      }"
      :src="favIcon"
      @click.prevent.stop="select"
    />

    <a
      class="forest-title"
      :href="tab.url"
      target="_blank"
      draggable="false"
      ref="a"
      @click.left.prevent.stop="open"
      @auxclick.middle.exact.prevent.stop="remove"
      >{{ tab.title }}</a
    >

    <span
      v-if="stashedIn.length > 0"
      class="forest-badge icon icon-stashed"
      :title="`This tab is stashed in:\n${stashedIn.join('\n')}`"
    />

    <nav class="action-group forest-toolbar">
      <a
        v-if="isStashable"
        class="action stash one"
        :title="`Stash this tab (hold ${altKey} to keep tab open)`"
        @click.prevent.stop="stash"
      />
      <a
        class="action remove"
        title="Close this tab"
        @click.prevent.stop="remove"
      />
    </nav>
  </div>
</template>

<script lang="ts">
import {defineComponent, type PropType} from "vue";
import browser from "webextension-polyfill";

import type {Model} from "../model";
import {friendlyFolderName} from "../model/bookmarks";
import type {Container} from "../model/containers";
import type {Tab} from "../model/tabs";
import {altKeyName, bgKeyName, required} from "../util";

import ItemIcon from "../components/item-icon.vue";

export default defineComponent({
  components: {ItemIcon},

  inject: ["$model"],

  props: {
    tab: required(Object as PropType<Tab>),
  },

  computed: {
    altKey: altKeyName,
    bgKey: bgKeyName,
    targetWindow(): number | undefined {
      return this.model().tabs.targetWindow.value;
    },
    favIcon(): string {
      if (this.tab.$selected) {
        return "";
      } else if (this.tab.favIconUrl) {
        return this.tab.favIconUrl;
      }
      return (
        this.model().favicons.getIfExists(this.tab.url)?.value?.favIconUrl ?? ""
      );
    },
    isStashable(): boolean {
      const t = this.tab;
      return !t.hidden && !t.pinned && this.model().isURLStashable(t.url);
    },
    isLoading(): boolean {
      return this.tab.status === "loading";
    },
    isActive(): boolean {
      return this.tab.active && this.tab.windowId === this.targetWindow;
    },
    stashedIn(): string[] {
      // Micro-optimizations - if the URL changes quickly, we don't want
      // to dig around in the bookmarks repeatedly.
      if (this.isLoading) return [];
      if (!this.tab.url) return [];

      const bookmarks = this.model().bookmarks;

      const ret = [];
      for (const bm of bookmarks.bookmarksWithURL(this.tab.url)) {
        const group = bookmarks.stashGroupOf(bm);
        if (!group) continue;
        ret.push(friendlyFolderName(group.title));
      }
      return ret;
    },
    container(): Container | undefined {
      if (this.tab.cookieStoreId === undefined) return;
      return this.model().containers.container(this.tab.cookieStoreId);
    },
    containerColor(): string | undefined {
      return this.container?.color;
    },
  },

  methods: {
    // TODO make Vue injection play nice with TypeScript typing...
    model() {
      return (<any>this).$model as Model;
    },
    attempt(fn: () => Promise<void>) {
      this.model().attempt(fn);
    },

    select(ev: MouseEvent) {
      this.attempt(async () => {
        await this.model().selection.toggleSelectFromEvent(
          ev,
          this.model().tabs,
          this.tab,
        );
      });
    },

    stash(ev: MouseEvent) {
      this.attempt(async () => {
        const model = this.model();
        await model.putItemsInFolder({
          items: model.copyIf(ev.altKey, [this.tab]),
          toFolderId: (await model.ensureRecentUnnamedFolder()).id,
        });
      });
    },

    open(ev: MouseEvent) {
      this.attempt(async () => {
        (<HTMLElement>this.$refs.a).blur();
        await browser.tabs.update(this.tab.id, {active: true});
      });
    },

    remove() {
      this.attempt(async () => {
        await this.model().tabs.remove([this.tab.id]);
      });
    },
  },
});
</script>

<style></style>

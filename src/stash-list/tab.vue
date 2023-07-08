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
      selected: selectionInfo.isSelected,
      'no-match': !filterInfo.isMatching,
    }"
    :title="tab.title"
    :data-container-color="containerColor"
  >
    <item-icon
      :class="{
        'forest-icon': true,
        action: true,
        select: true,
      }"
      default-icon="tab"
      :src="favIcon"
      selectable
      :selected="selectionInfo.isSelected"
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

import {altKeyName, bgKeyName, required} from "../util";

import the from "@/globals-ui";
import {friendlyFolderName} from "../model/bookmarks";
import type {Container} from "../model/containers";
import type {Tab, Window} from "../model/tabs";

import ItemIcon from "../components/item-icon.vue";

export default defineComponent({
  components: {ItemIcon},

  props: {
    tab: required(Object as PropType<Tab>),
  },

  computed: {
    filterInfo() {
      return the.model.filter.info(this.tab);
    },
    selectionInfo() {
      return the.model.selection.info(this.tab);
    },

    altKey: altKeyName,
    bgKey: bgKeyName,
    targetWindow(): Window | undefined {
      return the.model.tabs.targetWindow.value;
    },
    favIcon(): string {
      if (this.selectionInfo.isSelected) {
        return "";
      } else if (this.tab.favIconUrl) {
        return this.tab.favIconUrl;
      }
      return (
        the.model.favicons.getIfExists(this.tab.url)?.value?.favIconUrl ?? ""
      );
    },
    isStashable(): boolean {
      const t = this.tab;
      return !t.hidden && !t.pinned && the.model.isURLStashable(t.url);
    },
    isLoading(): boolean {
      return this.tab.status === "loading";
    },
    isActive(): boolean {
      return this.tab.active && this.tab.position?.parent === this.targetWindow;
    },
    stashedIn(): string[] {
      // Micro-optimizations - if the URL changes quickly, we don't want
      // to dig around in the bookmarks repeatedly.
      if (this.isLoading) return [];
      if (!this.tab.url) return [];

      return the.model.bookmarks
        .foldersInStashContainingURL(this.tab.url)
        .map(f => friendlyFolderName(f.title));
    },
    container(): Container | undefined {
      if (this.tab.cookieStoreId === undefined) return;
      return the.model.containers.container(this.tab.cookieStoreId);
    },
    containerColor(): string | undefined {
      return this.container?.color;
    },
  },

  methods: {
    attempt(fn: () => Promise<void>) {
      the.model.attempt(fn);
    },

    select(ev: MouseEvent) {
      this.attempt(async () => {
        the.model.selection.toggleSelectFromEvent(ev, this.tab);
      });
    },

    stash(ev: MouseEvent) {
      this.attempt(async () => {
        await the.model.putItemsInFolder({
          items: the.model.copyIf(ev.altKey, [this.tab]),
          toFolderId: (await the.model.ensureRecentUnnamedFolder()).id,
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
        if (this.stashedIn.length > 0) {
          await the.model.hideOrCloseStashedTabs([this.tab.id]);
        } else {
          await the.model.tabs.remove([this.tab.id]);
        }
      });
    },
  },
});
</script>

<style></style>

<template>
  <div
    :class="{
      'action-container': true,
      'forest-item': true,
      selectable: true,
      open: !tab.unfiltered.hidden,
      active: !!tab.unfiltered.active,
      discarded: tab.unfiltered.discarded,
      loading: isLoading,
      stashed: stashedIn.length > 0,
      selected: tab.unfiltered.$selected,
      'no-match': !tab.isMatching,
    }"
    :title="tab.unfiltered.title"
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
      :selected="tab.unfiltered.$selected"
      @click.prevent.stop="select"
    />

    <a
      class="forest-title"
      :href="tab.unfiltered.url"
      target="_blank"
      draggable="false"
      ref="a"
      @click.left.prevent.stop="open"
      @auxclick.middle.exact.prevent.stop="remove"
      >{{ tab.unfiltered.title }}</a
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

import type {Model} from "../model";
import {friendlyFolderName} from "../model/bookmarks";
import type {Container} from "../model/containers";
import type {FilteredChild} from "../model/filtered-tree";
import type {Tab, Window} from "../model/tabs";

import ItemIcon from "../components/item-icon.vue";

export default defineComponent({
  components: {ItemIcon},

  inject: ["$model"],

  props: {
    tab: required(Object as PropType<FilteredChild<Window, Tab>>),
  },

  computed: {
    altKey: altKeyName,
    bgKey: bgKeyName,
    targetWindow(): Window | undefined {
      return this.model().tabs.targetWindow.value;
    },
    favIcon(): string {
      if (this.tab.unfiltered.$selected) {
        return "";
      } else if (this.tab.unfiltered.favIconUrl) {
        return this.tab.unfiltered.favIconUrl;
      }
      return (
        this.model().favicons.getIfExists(this.tab.unfiltered.url)?.value
          ?.favIconUrl ?? ""
      );
    },
    isStashable(): boolean {
      const t = this.tab.unfiltered;
      return !t.hidden && !t.pinned && this.model().isURLStashable(t.url);
    },
    isLoading(): boolean {
      return this.tab.unfiltered.status === "loading";
    },
    isActive(): boolean {
      return (
        this.tab.unfiltered.active &&
        this.tab.unfiltered.position?.parent === this.targetWindow
      );
    },
    stashedIn(): string[] {
      // Micro-optimizations - if the URL changes quickly, we don't want
      // to dig around in the bookmarks repeatedly.
      if (this.isLoading) return [];
      if (!this.tab.unfiltered.url) return [];

      return this.model()
        .bookmarks.foldersInStashContainingURL(this.tab.unfiltered.url)
        .map(f => friendlyFolderName(f.title));
    },
    container(): Container | undefined {
      if (this.tab.unfiltered.cookieStoreId === undefined) return;
      return this.model().containers.container(
        this.tab.unfiltered.cookieStoreId,
      );
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
          this.tab.unfiltered,
        );
      });
    },

    stash(ev: MouseEvent) {
      this.attempt(async () => {
        const model = this.model();
        await model.putItemsInFolder({
          items: model.copyIf(ev.altKey, [this.tab.unfiltered]),
          toFolderId: (await model.ensureRecentUnnamedFolder()).id,
        });
      });
    },

    open(ev: MouseEvent) {
      this.attempt(async () => {
        (<HTMLElement>this.$refs.a).blur();
        await browser.tabs.update(this.tab.unfiltered.id, {active: true});
      });
    },

    remove() {
      this.attempt(async () => {
        await this.model().tabs.remove([this.tab.unfiltered.id]);
      });
    },
  },
});
</script>

<style></style>

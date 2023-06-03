<template>
  <Dialog
    :class="{[$style.dlg]: true, 'export-dialog': true}"
    @close="$emit('close')"
    show-close-button
  >
    <template #title>Export</template>

    <form :id="$style.dlg" @submit.prevent.stop="">
      <label :for="$style.format" :class="$style.format">Format:</label>
      <select :id="$style.format" v-model="format">
        <option value="html-links">Clickable Links</option>
        <option value="url-list">List of URLs</option>
        <option value="markdown">Markdown</option>
        <option value="one-tab">OneTab</option>
      </select>
      <nav>
        <button @click.prevent.stop="select_all">Select All</button>
        <button class="clickme" @click.prevent.stop="copy">Copy</button>
      </nav>
      <label :class="$style.help">
        <a
          href="https://github.com/josh-berry/tab-stash/wiki/Exporting-Tabs-from-Tab-Stash"
          target="_blank"
          >About Formats...</a
        >
      </label>
    </form>

    <output
      v-if="export_folders"
      ref="output"
      :for="$style.dlg"
      :class="{[$style.plaintext]: format !== 'html-links'}"
      tabindex="0"
    >
      <html-links v-if="format === 'html-links'" :folders="export_folders" />
      <url-list v-if="format === 'url-list'" :folders="export_folders" />
      <markdown v-if="format === 'markdown'" :folders="export_folders" />
      <one-tab v-if="format === 'one-tab'" :folders="export_folders" />
    </output>
  </Dialog>
</template>

<script lang="ts">
import {defineComponent, nextTick} from "vue";

import {filterMap} from "../util";

import type {Model} from "../model";
import {
  friendlyFolderName,
  isBookmark,
  type Bookmark,
  type Folder,
  type Node,
} from "../model/bookmarks";

import Dialog from "../components/dialog.vue";

import {exportFolder, type ExportFolder} from "./export/model";

import HtmlLinks from "./export/html-links";
import Markdown from "./export/markdown";
import OneTab from "./export/one-tab";
import UrlList from "./export/url-list";

export default defineComponent({
  components: {Dialog, HtmlLinks, Markdown, OneTab, UrlList},

  inject: ["$model"],

  emits: ["close"],

  props: {},

  computed: {
    export_folders(): ExportFolder[] | undefined {
      const root = this.model().bookmarks.stash_root.value;
      if (!root) return undefined;
      return exportFolder(this.model().bookmarks, root).folders;
    },
    stash(): Node[] {
      const m = this.model().bookmarks;
      if (!m.stash_root.value) return [];
      return m.stash_root.value.children;
    },
    folders(): Folder[] {
      return this.stash.filter(t => "children" in t) as Folder[];
    },
  },

  data: () => ({
    format: "html-links",
  }),

  mounted(this: any) {
    this.select_all();
  },

  watch: {
    format(this: any, val: string) {
      this.select_all();
    },
  },

  methods: {
    model(): Model {
      return (<any>this).$model as Model;
    },

    friendlyFolderName,
    leaves(folder: Folder): Bookmark[] {
      return filterMap(folder.children, node => {
        if (isBookmark(node)) return node;
        return undefined;
      });
    },

    faviconFor(bm: Bookmark): string | undefined {
      if (!bm.url) return undefined;
      return this.model().favicons.get(bm.url)?.value?.favIconUrl || undefined;
    },

    copy() {
      document.execCommand("copy");
    },
    select_all() {
      nextTick(() => {
        (<HTMLElement>this.$refs.output).focus();
        window.getSelection()!.selectAllChildren(<Element>this.$refs.output);
      });
    },
  },
});
</script>

<style module>
.dlg {
  width: 60rem;
  min-height: 20rem;
  height: 67%;
}

.dlg :global(.dialog-content) {
  grid-template-columns: 1fr;
  grid-template-rows: 0fr 1fr;
}

.dlg form {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
}

.dlg form > nav {
  display: flex;
  flex-direction: row;
  row-gap: inherit;
  column-gap: inherit;
}
.dlg form > select,
.dlg > form > nav {
  min-width: max-content;
}
.dlg form > .help {
  flex-grow: 1;
  text-align: right;
}

@media all and (max-width: 20rem) {
  .dlg > form > label.format {
    display: none;
  }
}

.plaintext {
  font-family: monospace;
}
</style>

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
      ref="output"
      :for="$style.dlg"
      :class="{[$style.plaintext]: format !== 'html-links'}"
      tabindex="0"
    >
      <html-links v-if="format === 'html-links'" :items="items" />
      <url-list v-else-if="format === 'url-list'" :items="items" />
      <markdown v-else-if="format === 'markdown'" :items="items" />
      <one-tab v-else-if="format === 'one-tab'" :items="items" />
    </output>
  </Dialog>
</template>

<script lang="ts">
import {defineComponent, nextTick, type PropType} from "vue";

import type {StashItem} from "../model/index.js";

import Dialog from "../components/dialog.vue";

import HtmlLinks from "./export/html-links.js";
import Markdown from "./export/markdown.js";
import OneTab from "./export/one-tab.js";
import UrlList from "./export/url-list.js";
import {required} from "../util/index.js";

export default defineComponent({
  components: {Dialog, HtmlLinks, Markdown, OneTab, UrlList},

  emits: ["close"],

  props: {
    items: required(Array as PropType<StashItem[]>),
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

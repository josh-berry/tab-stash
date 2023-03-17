<template>
  <ProgressDialog v-if="progress" :progress="progress" :cancel="cancel" />
  <Dialog
    v-else
    :class="{[$style.dlg]: true, 'import-dialog': true}"
    @close="$emit('close')"
    show-close-button
  >
    <template #title>Import</template>

    <label for="data">
      Paste anything containing links or URLs here. Links and URLs will be
      extracted and converted into bookmarks in your stash.
    </label>

    <div ref="data" contenteditable="true" id="data" class="input" />

    <section>
      <label for="splitOn">
        <span>Split tabs into different groups on:</span>
        <select id="splitOn" v-model="splitOn">
          <option value="p+h">Paragraphs and Headers</option>
          <option value="h">Headers</option>
          <option value="">Nothing [all in one group]</option>
        </select>
      </label>
    </section>

    <section>
      <label for="fetchIconsAndTitles">
        <input
          type="checkbox"
          id="fetchIconsAndTitles"
          v-model="fetchIconsAndTitles"
        />
        <span>Fetch icons and titles from each site</span>
      </label>
    </section>

    <template #buttons>
      <button class="clickme" @click="start">Import</button>
    </template>
  </Dialog>
</template>

<script lang="ts">
import {defineComponent} from "vue";

import type {Model} from "../model";
import {TaskMonitor, type Progress} from "../util";
import {importURLs, parse, type ParseOptions} from "./import";

import Dialog from "../components/dialog.vue";
import ProgressDialog from "../components/progress-dialog.vue";

export default defineComponent({
  components: {Dialog, ProgressDialog},

  emits: ["close"],

  data: () => ({
    cancel: undefined as undefined | (() => void),
    progress: undefined as undefined | Progress,
    splitOn: "p+h" as ParseOptions["splitOn"],
    fetchIconsAndTitles: true,
  }),

  inject: ["$model"],

  mounted() {
    (<HTMLElement>this.$refs.data).focus();
  },

  methods: {
    model(): Model {
      return (<any>this).$model as Model;
    },

    start() {
      this.model().attempt(async () => {
        const folders = parse(this.$refs.data as Element, this.model(), {
          splitOn: this.splitOn,
        });

        try {
          const task = TaskMonitor.run(task =>
            importURLs({
              model: this.model(),
              folders,
              fetchIconsAndTitles: this.fetchIconsAndTitles,
              task,
            }),
          );

          this.cancel = () => task.cancel();
          this.progress = task.progress;
          await task;
        } finally {
          this.cancel = undefined;
          this.progress = undefined;
          this.$emit("close");
        }
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
  grid-template-rows: 0fr 1fr 0fr 0fr;
}
</style>

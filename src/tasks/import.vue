<template>
  <ProgressDialog v-if="progress" :progress="progress"/>
  <Dialog v-else :class="{[$style.input]: true, 'import-dialog': true}"
          @close="$emit('close')">
    <label for="data">
      Paste anything containing links or URLs here.  Links and URLs will be
      extracted and converted into bookmarks in your stash.
    </label>
    <div ref="data" contenteditable="true" id="data" class="input"></div>
    <div>
      <label for="splitOn">Split tabs into different groups on:</label>
      <select id="splitOn" v-model="splitOn">
        <option value="p+h">Paragraphs and Headers</option>
        <option value="h">Headers</option>
        <option value="">Nothing [all in one group]</option>
      </select>
    </div>
    <button @click="start">Import</button>
  </Dialog>
</template>

<script lang="ts">
import Vue from 'vue';
import {ParseOptions, parse, importURLs} from './import';
import { TaskMonitor } from '../util';

export default Vue.extend({
    components: {
        Dialog: require('../components/dialog.vue').default,
        ProgressDialog: require('../components/progress-dialog.vue').default,
    },

    data: () => ({
      progress: undefined,
      splitOn: 'p+h' as ParseOptions['splitOn'],
    }),

    methods: {
        start() {
            const groups = parse(this.$refs.data as Element,
                                 {splitOn: this.splitOn});

            const task = TaskMonitor.run(tm =>
                importURLs(groups, tm).finally(() => this.$emit('close')));
            (<any>this).progress = task.progress;
        }
    }
});
</script>

<style module>
.input > :global(.dialog) {
    grid-template-columns: 1fr;
    grid-template-rows: 0fr 1fr;
    width: 60rem;
    min-height: 15rem;
    height: 67%;
}

.input :global(.input) {
    display: block;
    overflow: auto;
    user-select: text;
    -moz-user-select: text;
    cursor: text;
}
</style>

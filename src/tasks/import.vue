<template>
  <ProgressDialog v-if="task" :task="task"/>
  <Dialog v-else :class="$style.input" @close="$emit('close')">
    <label for="data">
      Paste your URLs here, one per line. Titles and icons will be loaded
      automatically by fetching each URL in the background. You can group
      your URLs by inserting blank lines between them.
    </label>
    <textarea ref="data" id="data" autofocus="true" required="true"
              spellcheck="false" autocomplete="false"></textarea>
    <button @click="start">Import</button>
  </Dialog>
</template>

<script lang="ts">
import Vue from 'vue';
import {parse, importURLs} from './import';
import { TaskMonitor } from '../util';

export default Vue.extend({
    components: {
        Dialog: require('../components/dialog.vue').default,
        ProgressDialog: require('../components/progress-dialog.vue').default,
    },

    data: () => ({task: undefined}),

    methods: {
        start() {
            const tm = new TaskMonitor(undefined, "Importing URLs...");
            (<any>this).task = tm;

            const groups = parse((<any>this.$refs.data).value);
            importURLs(groups, tm)
                .finally(() => this.$emit('close'));
        }
    }
});
</script>

<style module>
.input > :global(.dialog) {
    grid-template-columns: 1fr;
    grid-template-rows: 0fr 1fr 0fr;
    width: 60rem;
    min-height: 15rem;
    height: 50%;
}
</style>

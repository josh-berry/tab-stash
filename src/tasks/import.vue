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
      <button class="clickme" @click="start">
        {{
          props.toFolder
            ? `Import to "${friendlyFolderName(props.toFolder.title)}"`
            : "Import"
        }}
      </button>
    </template>
  </Dialog>
</template>

<script lang="ts">
import {onMounted, ref} from "vue";

import the from "../globals-ui.js";
import {TaskMonitor, type Progress} from "../util/index.js";
import {importURLs, parse, type ParseOptions} from "./import.js";

import Dialog from "../components/dialog.vue";
import ProgressDialog from "../components/progress-dialog.vue";
import {type Folder, friendlyFolderName} from "../model/bookmarks.js";
</script>

<script setup lang="ts">
const emit = defineEmits<{
  (e: "close"): void;
}>();

const props = defineProps<{
  toFolder: Folder | undefined;
}>();

const data = ref<HTMLElement>(undefined!);

const cancel = ref<(() => void) | undefined>();
const progress = ref<Progress | undefined>();
const splitOn = ref<ParseOptions["splitOn"]>("p+h");
const fetchIconsAndTitles = ref(true);

onMounted(() => {
  data.value.focus();
});

function start() {
  the.model.attempt(async () => {
    const folders = parse(data.value, the.model, {
      splitOn: splitOn.value,
    });

    try {
      const task = TaskMonitor.run(task =>
        importURLs({
          model: the.model,
          toFolder: props.toFolder,
          folders,
          fetchIconsAndTitles: fetchIconsAndTitles.value,
          task,
        }),
      );

      cancel.value = () => task.cancel();
      progress.value = task.progress;
      const failures = await task;
      if (failures.sites.length > 0) {
        alert(
          `Info for the following URLs could not be fetched:

${failures.urls.join("\n")}

Stashed tabs for these URLs have been created anyway, but you may need to set their titles manually. Sorry about that!`,
        );
      }
    } finally {
      cancel.value = undefined;
      progress.value = undefined;
      emit("close");
    }
  });
}
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

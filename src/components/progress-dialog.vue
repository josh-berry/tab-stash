<template>
  <Dialog
    :class="{progress: true, cancellable: !!cancel}"
    :backdrop-class="{progress: true, cancellable: !!cancel}"
    :prevent-closing="true"
  >
    <ProgressItem class="toplevel" :progress="progress" />
    <template #buttons v-if="cancel">
      <button
        :disabled="cancelled"
        :class="{disabled: cancelled}"
        @click.prevent.stop="doCancel"
      >
        Cancel
      </button>
    </template>
  </Dialog>
</template>

<script lang="ts">
import {defineComponent, type PropType} from "vue";

import {required, type Progress} from "../util";

import Dialog from "./dialog.vue";
import ProgressItem from "./progress-item.vue";

export default defineComponent({
  components: {Dialog, ProgressItem},
  emits: ["close"],
  props: {
    cancel: Function,
    progress: required(Object as PropType<Progress>),
  },
  data() {
    return {
      cancelled: false,
    };
  },
  methods: {
    doCancel() {
      if (!this.cancel) return;
      this.cancel();
      this.cancelled = true;
    },
  },
});
</script>

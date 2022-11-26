<template>
  <Dialog
    :class="{progress: true, cancellable: cancel}"
    :backdrop-class="{progress: true, cancellable: cancel}"
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
import {defineComponent} from "vue";

export default defineComponent({
  components: {
    Dialog: require("./dialog.vue").default,
    ProgressItem: require("./progress-item.vue").default,
  },
  emits: ["close"],
  props: {
    cancel: Function,
    progress: Object,
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

<template>
  <aside
    :class="{notification: true, 'has-action': !inactive}"
    v-if="!dismissed"
  >
    <div class="contents" @click.prevent.stop="activate">
      <slot></slot>
    </div>
    <ButtonBox>
      <a
        class="action cancel"
        name="Dismiss"
        title="Dismiss notification"
        @click.prevent.stop="dismiss"
      />
    </ButtonBox>
  </aside>
</template>

<script lang="ts">
import {defineComponent} from "vue";

import ButtonBox from "./button-box.vue";
import {t} from "../util/i18n.js";

export default defineComponent({
  components: {ButtonBox},

  emits: ["activate", "dismiss"],

  props: {
    inactive: Boolean,
  },

  data: () => ({
    dismissed: false,
  }),

  methods: {
    t,
    activate(ev: MouseEvent) {
      this.$emit("activate");
    },

    dismiss(ev: MouseEvent) {
      this.$emit("dismiss");
      this.dismissed = true;
    },
  },
});
</script>

<style></style>

<template>
  <aside
    :class="{'modal-backdrop': true, [$style.modal]: true}"
    tabindex="-1"
    v-bind="$attrs"
    ref="modal"
  >
    <slot></slot>
  </aside>
</template>

<script lang="ts">
import {defineComponent} from "vue";

export default defineComponent({
  mounted() {
    (<HTMLElement>this.$refs.modal).focus();
  },
});
</script>

<style module>
.modal {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 99;
  cursor: default;
  overflow: hidden;

  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  margin: 0;
}
</style>

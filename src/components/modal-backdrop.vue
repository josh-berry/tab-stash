<template>
<aside :class="{'modal-backdrop': true, [$style.modal]: true}"
       tabindex="-1"
       v-on="$listeners"
       @keypress.stop="" @keydown.stop="" @keyup.stop=""
       @click.stop="" @auxclick.stop="" @dblclick.stop=""
       @mousedown.stop="" @mouseup.stop=""
       @mouseenter.stop="" @mouseleave.stop=""
       @mousemove.stop="" @mouseout.stop="" @mouseover.stop=""
       @scroll.stop="" @select.stop="" @wheel.stop="">
  <slot></slot>
</aside>
</template>

<script lang="ts">
import Vue from 'vue';

export default Vue.extend({
    mounted() { (<HTMLElement>this.$el).focus(); }
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
    background: transparent;
    overflow: hidden;

    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    margin: 0;
}
</style>

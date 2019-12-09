<template>
  <nav class="action-container"
       @dragstart.stop.prevent="" @dragenter.stop="" @dragover.stop=""
       @mousedown.stop="" @pointerdown.stop=""
       @touchstart.stop="" @click.stop=""
       @dblclick.stop="" @altclick.stop="">
    <slot></slot>
  </nav>
</template>

<script lang="ts">
export default {
}
</script>

<style>
</style>

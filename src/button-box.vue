<template>
  <nav class="action-container"
       @dragstart.stop.prevent="" @dragenter.stop="" @dragover.stop=""
       @mousedown.stop="" @pointerdown.stop=""
       @touchstart.stop="" @click.stop=""
       @dblclick.stop="" @altclick.stop="">
    <slot></slot>
  </nav>
</template>

<script>
export default {
    props: {classes: Object},
    //data: () => ({}),
}
</script>

<style>
</style>

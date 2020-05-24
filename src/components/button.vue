<template>
<button class="action" :title="tooltip"
        @click.prevent.stop="act">
  <!-- XXX do something with {{name}} for blind users -->
  </button>
</template>

<script lang="ts">
export default {
    props: {
        name: String,
        tooltip: String,
    },
    methods: {
        act: function(this: any, ev: any) { this.$emit('action', ev); }
    }
}
</script>

<style>
</style>

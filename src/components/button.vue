<template>
<a class="action" :title="tooltip" @click.prevent.stop="act" />
</template>

<script lang="ts">
export default {
    emits: ['action'],
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

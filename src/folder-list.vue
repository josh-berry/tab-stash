<template>
<div>
  <div v-for="f in folders" :key="f.title">
    <folder v-bind="f"></folder>
  </div>
</div>
</template>

<script>
import Folder from 'folder.vue';
export default {
    components: {Folder},
    props: {folders: Array},
    data: () => ({}),
    computed: {},
    methods: {},
};
</script>

<style>
</style>

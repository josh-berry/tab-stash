<template>
<draggable v-model="folders" @update="move">
  <folder v-for="f in folders" :key="f.title" v-bind="f"
          ref="folders"
          :data-bmid="f.id">
  </folder>
</draggable>
</template>

<script>
import Draggable from 'vuedraggable';
import Folder from './folder.vue';

export default {
    components: {Draggable, Folder},
    props: {folders: Array},

    methods: {
        move: function(ev) {
            browser.bookmarks.move(ev.item.dataset.bmid, {
                index: ev.newIndex,
            }).catch(console.log);
        },

        setCollapsed: function(c) {
            for (let f of this.$refs.folders) f.collapsed = c;
        },
    },
};
</script>

<style>
</style>

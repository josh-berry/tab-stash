<template>
<draggable class="sortable-list" @update="move">
  <folder v-for="f in folders" v-if="f.children"
          :key="f.title"
          :id="f.id" :children="f.children"
          :title="f.title" :dateAdded="f.dateAdded"
          :filter="filter" :hideIfEmpty="hideIfEmpty"
          ref="folders">
  </folder>
</draggable>
</template>

<script>
import Draggable from 'vuedraggable';
import Folder from './folder.vue';

export default {
    components: {Draggable, Folder},
    props: {
        folders: Array,
        filter: Function,

        // Whether to hide a folder entirely if it has no elements (e.g. because
        // we're filtering at the moment)
        hideIfEmpty: Boolean,
    },

    methods: {
        move: function(ev) {
            browser.bookmarks.move(ev.item.__vue__.id, {
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

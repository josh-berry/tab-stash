<template>
<Draggable class="sortable-list folder-list" @update="move">
  <Folder v-for="f in folders" v-if="f && f.children"
          :key="f.id"
          :id="f.id" :children="f.children" :allowRenameDelete="true"
          :title="f.title" :dateAdded="f.dateAdded"
          :filter="filter" :userFilter="userFilter" :hideIfEmpty="hideIfEmpty"
          :metadata="metadataCache.get(f.id)"
          ref="folders">
  </Folder>
</Draggable>
</template>

<script>
export default {
    components: {
        Draggable: require('vuedraggable'),
        Folder: require('./folder.vue').default,
    },

    props: {
        folders: Array,
        filter: Function,
        userFilter: Function,

        // Whether to hide a folder entirely if it has no elements (e.g. because
        // we're filtering at the moment)
        hideIfEmpty: Boolean,

        metadataCache: Object,
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

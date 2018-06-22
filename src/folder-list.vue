<template>
<draggable v-model="folders" @sort="move">
  <folder v-for="f in folders" :key="f.title" v-bind="f"
          ref="folders"
          :data-id="f.id">
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
            //console.log('move tab', ev);
            //console.log('item', ev.item.dataset.id);
            //console.log('from', ev.oldIndex, ev.from.dataset.id);
            //console.log('to', ev.newIndex, ev.to.dataset.id);

            browser.bookmarks.move(ev.item.dataset.id, {
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

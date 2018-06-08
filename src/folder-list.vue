<template>
<div>
  <draggable v-model="folders" @sort="move">
    <folder v-for="f in folders" :key="f.title" v-bind="f" :data-id="f.id">
    </folder>
  </draggable>
</div>
</template>

<script>
import Draggable from 'vuedraggable';
import Folder from 'folder.vue';

export default {
    components: {Draggable, Folder},
    props: {folders: Array},
    data: () => ({}),
    computed: {},
    methods: {
        move: function(ev) {
            //console.log('move tab', ev);
            //console.log('item', ev.item.dataset.id);
            //console.log('from', ev.oldIndex, ev.from.dataset.id);
            //console.log('to', ev.newIndex, ev.to.dataset.id);

            browser.bookmarks.move(ev.item.dataset.id, {
                index: ev.newIndex,
            }).then(() => {});
        },
    },
};
</script>

<style>
</style>

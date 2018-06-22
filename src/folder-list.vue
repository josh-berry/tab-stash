<template>
<div>
  <div class="page header action-container">
    <span class="status-text">
      {{folders.length}} {{folders.length == 1 ? 'group' : 'groups'}},
      {{tab_count}} {{tab_count == 1 ? 'tab' : 'tabs'}}
    </span>
    <img src="icons/collapse.svg"
         :class="{action: true, collapse: true, toggled: collapsed}"
         title="Hide all tabs so only group names are showing"
         @click.prevent="collapseAll">
  </div>
  <draggable v-model="folders" @sort="move">
    <folder v-for="f in folders" :key="f.title" v-bind="f"
            ref="folders"
            :data-id="f.id">
    </folder>
  </draggable>
</div>
</template>

<script>
import Draggable from 'vuedraggable';
import Folder from './folder.vue';

export default {
    components: {Draggable, Folder},
    props: {folders: Array},

    data: () => ({
        collapsed: false,
    }),

    computed: {
        tab_count: function() {
            let c = 0;
            for (let f of this.folders) c += f.children.length;
            return c;
        },
    },

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

        collapseAll: function(ev) {
            this.collapsed = ! this.collapsed;
            for (let f of this.$refs.folders) f.collapsed = this.collapsed;
        },
    },
};
</script>

<style>
</style>

<template>
<Draggable class="sortable-list folder-list" @update="move"
           v-model="folders" item-key="id">
  <template #item="{element: f}">
    <Folder :id="f.id" :children="f.children" :allowRenameDelete="true"
            :title="f.title" :dateAdded="f.dateAdded"
            :filter="filter" :userFilter="userFilter" :hideIfEmpty="hideIfEmpty"
            :metadata="model().bookmark_metadata.get(f.id)"
            ref="folders" />
  </template>
</Draggable>
</template>

<script lang="ts">
import {browser} from 'webextension-polyfill-ts';
import {PropType, defineComponent} from 'vue';
import {SortableEvent} from 'sortablejs';

import {Model} from '../model';
import {Bookmark} from '../model/bookmarks';

export default defineComponent({
    components: {
        Draggable: require('vuedraggable'),
        Folder: require('./folder.vue').default,
    },

    inject: ['$model'],

    props: {
        folders: Array as PropType<Bookmark[]>,
        filter: Function as PropType<(i: Bookmark) => boolean>,
        userFilter: Function as PropType<(i: Bookmark) => boolean>,

        // Whether to hide a folder entirely if it has no elements (e.g. because
        // we're filtering at the moment)
        hideIfEmpty: Boolean,
    },

    methods: {
        model(): Model { return (<any>this).$model as Model; },

        move(ev: SortableEvent) {
            browser.bookmarks.move((<any>ev.item).__vue__.id, {
                index: ev.newIndex!,
            }).catch(console.log);
        },
        setCollapsed(c: boolean) {
            for (const f of (<any>this.$refs.folders)) f.collapsed = c;
        }
    },
});
</script>

<style>
</style>

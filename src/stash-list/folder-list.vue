<template>
<dnd-list class="folder-list" v-model="children" item-key="id"
         :accepts="accepts" :drag="drag" :drop="drop"
         :mimic-height="true">
  <template #item="{item: f}">
    <Folder :folder="f"
            :userFilter="userFilter" :hideIfEmpty="hideIfEmpty"
            :metadata="model().bookmark_metadata.get(f.id)"
            ref="folders" />
  </template>
</dnd-list>
</template>

<script lang="ts">
import {PropType, defineComponent} from 'vue';

import {filterMap, required} from '../util';

import {Model} from '../model';
import {Bookmark, Folder, NodeID} from '../model/bookmarks';
import {DragAction, DropAction} from '../components/dnd-list';

const DROP_FORMAT = 'application/x-tab-stash-folder-id';

export default defineComponent({
    components: {
        DndList: require('../components/dnd-list.vue').default,
        Folder: require('./folder.vue').default,
    },

    inject: ['$model'],

    props: {
        parentFolder: required(Object as PropType<Folder>),
        userFilter: Function as PropType<(i: Bookmark) => boolean>,

        // Whether to hide a folder entirely if it has no elements (e.g. because
        // we're filtering at the moment)
        hideIfEmpty: Boolean,
    },

    computed: {
        accepts() { return DROP_FORMAT; },
        children(): readonly Folder[] {
            const bookmarks = this.model().bookmarks;
            return filterMap(this.parentFolder.children, cid => {
                const child = bookmarks.node(cid);
                if ('children' in child) return child;
                return undefined;
            });
        },
    },

    methods: {
        model(): Model { return (<any>this).$model as Model; },

        drag(ev: DragAction<Folder>) {
            ev.dataTransfer.setData(DROP_FORMAT, ev.value.id);
        },

        async drop(ev: DropAction) {
            const id = ev.dataTransfer.getData(DROP_FORMAT)
            await this.model().bookmarks.move(
                id as NodeID, this.parentFolder.id, ev.toIndex);
        },
        setCollapsed(c: boolean) {
            for (const f of (<any>this.$refs.folders)) f.collapsed = c;
        }
    },
});
</script>

<style>
</style>

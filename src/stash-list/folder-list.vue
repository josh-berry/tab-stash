<template>
<Draggable class="sortable-list folder-list" @change="move"
           v-model="children" item-key="id">
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
import {ChangeEvent} from 'vuedraggable';

import {required} from '../util';

import {Model} from '../model';
import {Bookmark} from '../model/bookmarks';

export default defineComponent({
    components: {
        Draggable: require('vuedraggable'),
        Folder: require('./folder.vue').default,
    },

    inject: ['$model'],

    props: {
        parentFolder: required(Object as PropType<Bookmark>),
        filter: Function as PropType<(i: Bookmark) => boolean>,
        userFilter: Function as PropType<(i: Bookmark) => boolean>,

        // Whether to hide a folder entirely if it has no elements (e.g. because
        // we're filtering at the moment)
        hideIfEmpty: Boolean,
    },

    data() { return {
        /** If a drag-and-drop operation has just completed, but the actual
         * model hasn't been updated yet, we temporarily show the user the model
         * "as if" the operation was already done, so it doesn't look like the
         * dragged item snaps back to its original location temporarily. */
        dirtyChildren: undefined as Bookmark[] | undefined,
    }},

    computed: {
        children: {
            get(): Bookmark[] {
                if (this.dirtyChildren) return this.dirtyChildren;

                const children = this.parentFolder.children;
                if (! children) return [];
                return children.filter(c => c.children !== undefined);
            },
            set(children: Bookmark[]) {
                // Triggered only by drag and drop
                this.dirtyChildren = children;
            },
        },
    },

    methods: {
        model(): Model { return (<any>this).$model as Model; },

        move(ev: ChangeEvent<Bookmark>) {
            if (! ev.moved) return;
            browser.bookmarks.move(ev.moved.element.id, {
                index: ev.moved.newIndex,
            })
                .catch(console.log)
                .finally(() => {
                    this.dirtyChildren = undefined;
                });
        },
        setCollapsed(c: boolean) {
            for (const f of (<any>this.$refs.folders)) f.collapsed = c;
        }
    },
});
</script>

<style>
</style>

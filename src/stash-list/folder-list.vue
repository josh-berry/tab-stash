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

<script lang="ts">
import {browser} from 'webextension-polyfill-ts';
import Vue, {PropType} from 'vue';
import {SortableEvent} from 'sortablejs';

import {CacheEntry} from '../datastore/cache/client';
import {ModelLeaf, ModelParent} from '../model/browser';

export default Vue.extend({
    components: {
        Draggable: require('vuedraggable'),
        Folder: require('./folder.vue').default,
    },

    props: {
        folders: Array as PropType<ModelParent[]>,
        filter: Function as PropType<(i: ModelLeaf) => boolean>,
        userFilter: Function as PropType<(i: ModelLeaf) => boolean>,

        // Whether to hide a folder entirely if it has no elements (e.g. because
        // we're filtering at the moment)
        hideIfEmpty: Boolean,

        metadataCache: Object as PropType<CacheEntry<{collapsed: boolean}>>,
    },

    methods: {
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

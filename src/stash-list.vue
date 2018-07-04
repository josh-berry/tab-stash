<template>
<div>
  <div class="page header action-container">
    <span class="status-text">
      {{stashed_tabs.length}} {{stashed_tabs.length == 1 ? 'group' : 'groups'}},
      {{tab_count}} {{tab_count == 1 ? 'tab' : 'tabs'}}
    </span>
    <img :src="`icons/collapse-${collapsed ? 'closed' : 'open'}.svg`"
         :class="{action: true, collapse: true}"
         title="Hide all tabs so only group names are showing"
         @click.prevent.stop="collapseAll">
  </div>
  <folder :isWindow="true" title="Unstashed Tabs"
          ref="unstashed" :children="unstashed_tabs"
          :filter="unstashedFilter" :isItemStashed="isItemStashed">
  </folder>
  <folder-list ref="stashed" :folders="stashed_tabs"></folder-list>
</div>
</template>

<script>
import {isTabStashable} from './stash';
import {isInFolder} from './model';

import FolderList from './folder-list.vue';
import Folder from './folder.vue';

export default {
    components: {
        FolderList,
        Folder,
    },

    data: () => ({
        collapsed: false,
    }),

    computed: {
        tab_count: function() {
            let c = 0;
            for (let f of this.stashed_tabs) c += f.children.length;
            return c;
        },
    },

    methods: {
        collapseAll: function(ev) {
            this.collapsed = ! this.collapsed;
            this.$refs.unstashed.collapsed = this.collapsed;
            this.$refs.stashed.setCollapsed(this.collapsed);
        },

        unstashedFilter(t) {
            return ! t.hidden && isTabStashable(t) && ! this.isItemStashed(t);
        },

        isItemStashed(i) {
            return i.related.find(
                i => i.isBookmark && isInFolder(this.root_id, i));
        }
    },
};
</script>

<style>
</style>

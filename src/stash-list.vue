<template>
<div class="stash-list">
  <div class="page header action-container">
    <input type="search" ref="search"
           :placeholder="search_placeholder"
           @keyup.esc.prevent="searchtext=''; $refs.search.blur();"
           v-model="searchtext">
    <img :src="`icons/collapse-${collapsed ? 'closed' : 'open'}.svg`"
         :class="{action: true, collapse: true}"
         title="Hide all tabs so only group names are showing"
         @click.prevent.stop="collapseAll">
  </div>
  <div class="folder-list">
    <folder title="Unstashed Tabs" :allowRenameDelete="false"
            ref="unstashed" :children="unstashed_tabs.children"
            :filter="unstashedFilter" :isItemStashed="isItemStashed">
    </folder>
    <!-- XXX This is presently disabled because it exposes a bug in
         Vue.Draggable, wherein if the draggable goes away as the result of a
         drag operation, the "ghost" element which is being dragged doesn't get
         cleaned up, and it looks like there is a duplicate.

         We hit the bug in this case, because the "Unfiled" folder disappears
         after the last unfiled entry is dragged out of it.

    <folder title="Unfiled" :allowRenameDelete="false"
            :id="stashed_tabs.id" :children="stashed_tabs.children"
            :dateAdded="stashed_tabs.dateAdded"
            :filter="search_filter" :isItemStashed="isItemStashed"
            :hideIfEmpty="true">
    </folder>
    -->
  </div>
  <folder-list ref="stashed" :folders="stashed_tabs.children"
               :filter="search_filter"
               :hideIfEmpty="searchtext !== ''">
  </folder-list>
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
        searchtext: '',
    }),

    computed: {
        counts: function() {
            let tabs = 0, groups = 0;
            for (let f of this.stashed_tabs.children) {
                if (f.children) {
                    tabs += f.children.length;
                    groups++;
                }
            }
            return {tabs, groups};
        },
        search_placeholder: function() {
            const counts = this.counts;
            const groups = counts.groups == 1 ? 'group' : 'groups';
            const tabs = counts.tabs == 1 ? 'tab' : 'tabs';
            return `Search ${counts.groups} ${groups}, ${counts.tabs} ${tabs}`;
        },
        text_matcher: function() {
            if (this.searchtext == '') return txt => true;
            try {
                let re = new RegExp(this.searchtext, 'iu');
                return txt => re.test(txt);
            } catch (e) {
                let lower = this.searchtext.normalize().toLowerCase();
                return txt => txt.normalize().toLowerCase().includes(lower);
            }
        }
    },

    methods: {
        collapseAll: function(ev) {
            this.collapsed = ! this.collapsed;
            this.$refs.unstashed.collapsed = this.collapsed;
            this.$refs.stashed.setCollapsed(this.collapsed);
        },

        search_filter: function(i) {
            return this.text_matcher(i.title) || this.text_matcher(i.url);
        },

        unstashedFilter(t) {
            return ! t.hidden && isTabStashable(t) && ! this.isItemStashed(t)
                && this.search_filter(t);
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

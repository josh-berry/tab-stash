<template>
<div>
  <div class="page header action-container">
    <input class="status-text" type="search"
           :placeholder="search_placeholder"
           @keyup.esc.prevent="searchtext=''"
           v-model="searchtext">
    <img :src="`icons/collapse-${collapsed ? 'closed' : 'open'}.svg`"
         :class="{action: true, collapse: true}"
         title="Hide all tabs so only group names are showing"
         @click.prevent.stop="collapseAll">
  </div>
  <folder :isWindow="true" title="Unstashed Tabs"
          ref="unstashed" :children="unstashed_tabs"
          :filter="unstashedFilter" :isItemStashed="isItemStashed">
  </folder>
  <folder-list ref="stashed" :folders="stashed_tabs" :filter="search_filter"
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
        tab_count: function() {
            let c = 0;
            for (let f of this.stashed_tabs) {
                if (f.children) c += f.children.length;
            }
            return c;
        },
        search_placeholder: function() {
            const groups = this.stashed_tabs.length == 1 ? 'group' : 'groups';
            const tabs = this.tab_count == 1 ? 'tab' : 'tabs';
            return `${this.stashed_tabs.length} ${groups}, ${this.tab_count} ${tabs}`;
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

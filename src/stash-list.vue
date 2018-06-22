<template>
<div>
  <div class="page header action-container">
    <span class="status-text">
      {{stashed_tabs.length}} {{stashed_tabs.length == 1 ? 'group' : 'groups'}},
      {{tab_count}} {{tab_count == 1 ? 'tab' : 'tabs'}}
    </span>
    <img src="icons/collapse.svg"
         :class="{action: true, collapse: true, toggled: collapsed}"
         title="Hide all tabs so only group names are showing"
         @click.prevent="collapseAll">
  </div>
  <folder-list ref="stashed" :folders="stashed_tabs"></folder-list>
</div>
</template>

<script>
import FolderList from './folder-list.vue';
export default {
    components: {
        FolderList,
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
            this.$refs.stashed.setCollapsed(this.collapsed);
        },
    },
};
</script>

<style>
</style>

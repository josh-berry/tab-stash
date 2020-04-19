<template>
<div class="stash-list">
  <header class="page action-container">
    <Menu class="menu">
      <template #summary><div class="action mainmenu"></div></template>
      <button @click="showOptions">Options...</button>
      <hr/>
      <a href="https://josh-berry.github.io/tab-stash/tips.html">Tips and Tricks</a>
      <a href="https://github.com/josh-berry/tab-stash/wiki">Wiki</a>
      <a href="https://josh-berry.github.io/tab-stash/support.html">Help and Support</a>
      <button @click="showWhatsNew">What's New?</button>
    </Menu>
    <input type="search" ref="search"
           :placeholder="search_placeholder"
           @keyup.esc.prevent="searchtext=''; $refs.search.blur();"
           v-model="searchtext">
    <Button :class="{collapse: collapsed, expand: ! collapsed}"
            title="Hide all tabs so only group names are showing"
            @action="collapseAll" />
  </header>
  <header class="notifications">
    <Notification v-if="recently_updated"
                  @activate="showWhatsNew" @dismiss="hideWhatsNew">
      You've been updated to Tab Stash {{my_version}}.  See what's new!
    </Notification>
    <Notification v-if="root_folder_warning" @activate="root_folder_warning[1]">
      {{root_folder_warning[0]}}
    </Notification>
  </header>
  <div class="folder-list">
    <folder title="Unstashed Tabs" :allowRenameDelete="false"
            ref="unstashed" :children="unstashed_tabs.children"
            :filter="unstashedFilter" :userFilter="search_filter"
            :isItemStashed="isItemStashed"
            :metadata="metadata_cache.get('')">
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
               :userFilter="search_filter"
               :hideIfEmpty="searchtext !== ''"
               :metadataCache="metadata_cache">
  </folder-list>
  <footer class="page footer status-text">
    Tab Stash {{my_version}} &mdash;
    <a href="whats-new.html">What's New</a>
  </footer>
</div>
</template>

<script>
import {isURLStashable, rootFolderWarning} from './stash';
import {isInFolder} from './model';

import FolderList from './folder-list.vue';
import Folder from './folder.vue';
import ButtonBox from './button-box.vue';
import Button from './button.vue';
import Notification from './notification.vue';
import Menu from './menu.vue';

export default {
    components: {
        FolderList,
        Folder,
        ButtonBox,
        Button,
        Notification,
        Menu,
    },

    data: () => ({
        collapsed: false,
        searchtext: '',
    }),

    computed: {
        recently_updated: function() {
            return this.local_options.last_notified_version !== this.my_version;
        },

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
        },
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
            return ! t.hidden && ! t.pinned
                && isURLStashable(t.url) && ! this.isItemStashed(t);
        },

        isItemStashed(i) {
            return i.related.find(
                i => i.isBookmark && i.isInFolder(this.root_id));
        },

        showOptions() {
            browser.runtime.openOptionsPage().catch(console.log);
        },

        showWhatsNew() {
            window.location.href = 'whats-new.html';
        },
        hideWhatsNew() {
            this.local_options.set({last_notified_version: this.my_version});
        },
    },
};
</script>

<style>
</style>

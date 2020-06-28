<template>
<div class="stash-list">
  <component v-if="dialog" :is="dialog.class" v-bind="dialog.props"
             v-on="dialog.on" @close="dialog = undefined">
  </component>
  <header class="page action-container">
    <Menu class="menu" summaryClass="action mainmenu">
      <a @click.prevent.stop="showOptions">Options...</a>
      <hr/>
      <a @click.prevent.stop="dialog = {class: 'ImportDialog'}">Import...</a>
      <a @click.prevent.stop="showExportDialog">Export...</a>
      <hr/>
      <a @click.prevent.stop="fetchMissingFavicons">Fetch Missing Icons</a>
      <hr/>
      <a href="https://josh-berry.github.io/tab-stash/tips.html">Tips and Tricks</a>
      <a href="https://github.com/josh-berry/tab-stash/wiki">Wiki</a>
      <a href="https://josh-berry.github.io/tab-stash/support.html">Help and Support</a>
      <a @click.prevent.stop="showWhatsNew">What's New?</a>
    </Menu>
    <input type="search" ref="search" class="ephemeral"
           :placeholder="search_placeholder"
           @keyup.esc.prevent="searchtext=''; $refs.search.blur();"
           v-model="searchtext">
    <ButtonBox>
      <Button :class="{collapse: collapsed, expand: ! collapsed}"
              title="Hide all tabs so only group names are showing"
              @action="collapseAll" />
    </ButtonBox>
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
import {asyncEvent, urlsInTree, urlToOpen, TaskMonitor} from './util';
import {isURLStashable, rootFolderWarning, tabStashTree} from './stash';
import {isInFolder} from './model';
import {Cache} from './cache-client';
import {fetchInfoForSites} from './tasks/siteinfo';

import FolderList from './folder-list.vue';
import Folder from './folder.vue';
import ButtonBox from './components/button-box.vue';
import Button from './components/button.vue';
import Notification from './components/notification.vue';
import Menu from './components/menu.vue';

export default {
    components: {
        FolderList,
        Folder,
        ButtonBox,
        Button,
        Notification,
        Menu,
        ImportDialog: require('./tasks/import.vue').default,
        ExportDialog: require('./tasks/export.vue').default,
        ProgressDialog: require('./components/progress-dialog.vue').default,
    },

    data: () => ({
        collapsed: false,
        searchtext: '',
        dialog: undefined,
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

        showExportDialog() {
            this.dialog = {
                class: 'ExportDialog',
                props: {stash: this.stashed_tabs.children},
            };
        },

        fetchMissingFavicons: asyncEvent(async function() {
            const cache = Cache.open('favicons');
            const urls = new Set(urlsInTree(await tabStashTree()));

            // This is just an async filter :/
            for (const url of urls) {
                const favicon = await cache.get(url);
                if (favicon && favicon.value) urls.delete(url);
            }

            const iter = TaskMonitor.run_iter(tm => fetchInfoForSites(urls, tm));
            this.dialog = {
                class: 'ProgressDialog',
                props: {progress: iter.progress, cancel: () => iter.cancel()},
            };

            try {
                for await (const info of iter) {
                    if (info.favIconUrl) {
                        cache.set(info.originalUrl, info.favIconUrl);
                    }
                }
            } finally {
                this.dialog = undefined;
            }
        }),
    },
};
</script>

<style>
</style>

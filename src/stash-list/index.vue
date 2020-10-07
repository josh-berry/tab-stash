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
    <a :href="pageref('whats-new.html')">What's New</a>
  </footer>
</div>
</template>

<script lang="ts">
import Vue, {PropType} from 'vue';

import launch, {pageref} from '../launch-vue';
import {
    urlsInTree, TaskMonitor, resolveNamed, Promised, logErrors,
} from '../util';
import {
    isURLStashable, rootFolder, rootFolderWarning, tabStashTree,
} from '../stash';
import {StashState, Bookmark, Tab} from '../model';
import Options, {LocalOptions, SyncOptions} from '../model/options';
import {Cache} from '../cache-client';
import {fetchInfoForSites} from '../tasks/siteinfo';

const Main = Vue.extend({
    components: {
        Button: require('../components/button.vue').default,
        ButtonBox: require('../components/button-box.vue').default,
        ExportDialog: require('../tasks/export.vue').default,
        Folder: require('./folder.vue').default,
        FolderList: require('./folder-list.vue').default,
        ImportDialog: require('../tasks/import.vue').default,
        Menu: require('../components/menu.vue').default,
        Notification: require('../components/notification.vue').default,
        ProgressDialog: require('../components/progress-dialog.vue').default,
    },

    props: {
        unstashed_tabs: Object as PropType<Window>,
        stashed_tabs: Object as PropType<Bookmark>,
        root_id: String,
        my_version: String,
        local_options: Object as PropType<LocalOptions>,
        sync_options: Object as PropType<SyncOptions>,
        metadata_cache: Object as PropType<Cache<{collapsed: boolean}>>,
        root_folder_warning: Object as PropType<
            Promised<ReturnType<typeof rootFolderWarning>>>,
    },

    data: () => ({
        collapsed: false,
        searchtext: '',
        dialog: undefined as undefined | {class: string, props: any},
    }),

    computed: {
        recently_updated(): boolean {
            return this.local_options.last_notified_version !== this.my_version;
        },

        counts(): {tabs: number, groups: number} {
            let tabs = 0, groups = 0;
            for (const f of this.stashed_tabs.children!) {
                if (f?.children) {
                    tabs += f.children.length;
                    groups++;
                }
            }
            return {tabs, groups};
        },

        search_placeholder(): string {
            const counts = this.counts;
            const groups = counts.groups == 1 ? 'group' : 'groups';
            const tabs = counts.tabs == 1 ? 'tab' : 'tabs';
            return `Search ${counts.groups} ${groups}, ${counts.tabs} ${tabs}`;
        },

        text_matcher(): (txt: string) => boolean {
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
        pageref,

        collapseAll() {
            this.collapsed = ! this.collapsed;
            (<any>this.$refs.unstashed).collapsed = this.collapsed;
            (<any>this.$refs.stashed).setCollapsed(this.collapsed);
        },

        search_filter(i: Bookmark | Tab) {
            if (this.searchtext === '') return true;
            return (i.title && this.text_matcher(i.title))
                || (i.url && this.text_matcher(i.url));
        },

        unstashedFilter(t: Tab) {
            return ! t.hidden && ! t.pinned && t.url
                && isURLStashable(t.url) && ! this.isItemStashed(t);
        },

        isItemStashed(i: Tab) {
            return i.related && i.related.find(
                i => i instanceof Bookmark && i.isInFolder(this.root_id));
        },

        showOptions() {
            browser.runtime.openOptionsPage().catch(console.log);
        },

        showWhatsNew() {
            window.location.href = pageref('whats-new.html');
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

        async fetchMissingFavicons() { logErrors(async() => {
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
        })},
    },
});

export default Main;

launch(Main, async() => {
    const p = await resolveNamed({
        state: StashState.make(),
        root: rootFolder(),
        win: browser.windows.getCurrent(),
        curtab: browser.tabs.getCurrent(),
        extinfo: browser.management.getSelf(),
        localopts: Options.local(),
        syncopts: Options.sync(),
        warning: rootFolderWarning(),
    });

    // For debugging purposes only...
    (<any>globalThis).metadata_cache = Cache.open('bookmarks');
    (<any>globalThis).favicon_cache = Cache.open('favicons');
    (<any>globalThis).stash_state = p.state;

    return {
        propsData: {
            unstashed_tabs: p.state.wins_by_id.get(p.win.id!),
            stashed_tabs: p.state.bms_by_id.get(p.root.id),
            root_id: p.root.id,
            my_version: p.extinfo.version,
            local_options: p.localopts,
            sync_options: p.syncopts,
            metadata_cache: Cache.open('bookmarks'),
            root_folder_warning: p.warning,
        },
    };
});
</script>

<style>
</style>

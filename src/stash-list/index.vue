<template>
<main>
  <component v-if="dialog" :is="dialog.class" v-bind="dialog.props"
             v-on="dialog.on" @close="dialog = undefined">
  </component>
  <aside class="notification-overlay">
    <Notification v-if="recently_updated === 'features'"
                @activate="go('whats-new.html')" @dismiss="hideWhatsNew">
      Tab Stash {{my_version}} now offers options to customize how it looks.
      See what's new!
    </Notification>
    <Notification v-if="recently_updated === 'fixes'"
                @activate="go('whats-new.html')" @dismiss="hideWhatsNew">
      Tab Stash {{my_version}} now offers options to customize how it looks.
      See what's new!
    </Notification>
    <Notification v-if="root_folder_warning" @activate="root_folder_warning[1]">
      {{root_folder_warning[0]}}
    </Notification>
    <Notification v-if="recently_deleted.length === 1"
                  @activate="model().deleted_items.undelete(recently_deleted[0])">
      Deleted "{{recently_deleted[0].item.title}}".  Undo?
    </Notification>
    <Notification v-else-if="recently_deleted.length > 1"
                  @activate="go('deleted-items.html')">
      Deleted {{recently_deleted.length}} items.  Show what was deleted?
    </Notification>
  </aside>
  <header class="page action-container">
    <Menu class="menu" summaryClass="action mainmenu">
      <a @click.prevent.stop="showOptions">Options...</a>
      <hr/>
      <a @click.prevent.stop="dialog = {class: 'ImportDialog'}">Import...</a>
      <a @click.prevent.stop="showExportDialog">Export...</a>
      <hr/>
      <a :href="pageref('deleted-items.html')">Deleted Items...</a>
      <a @click.prevent.stop="fetchMissingFavicons">Fetch Missing Icons</a>
      <hr/>
      <a href="https://josh-berry.github.io/tab-stash/tips.html">Tips and Tricks</a>
      <a href="https://github.com/josh-berry/tab-stash/wiki">Wiki</a>
      <a href="https://josh-berry.github.io/tab-stash/support.html">Help and Support</a>
      <a :href="pageref('whats-new.html')">What's New?</a>
    </Menu>
    <input type="search" ref="search" class="ephemeral" aria-label="Search"
           :placeholder="search_placeholder" @keyup.esc.prevent="searchtext=''"
           v-model="searchtext">
    <Button :class="{collapse: ! collapsed, expand: collapsed}"
            title="Hide all tabs so only group names are showing"
            @action="collapseAll" />
  </header>
  <div class="folder-list">
    <window :title="tabfolder_title" :allowRenameDelete="false"
            ref="unstashed" :children="unstashed_tabs"
            :filter="unstashedFilter" :userFilter="search_filter"
            :isItemStashed="isItemStashed"
            :metadata="model().bookmark_metadata.get('')" />
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
  <folder-list ref="stashed" :parentFolder="stashed_tabs"
               :userFilter="search_filter"
               :hideIfEmpty="searchtext !== ''" />
  <footer class="page status-text">
    Tab Stash {{my_version}} &mdash;
    <a :href="pageref('whats-new.html')">What's New</a>
  </footer>
</main>
</template>

<script lang="ts">
import {browser} from 'webextension-polyfill-ts';
import {PropType, defineComponent} from 'vue';

import launch, {pageref} from '../launch-vue';
import {
    urlsInTree, TaskMonitor, resolveNamed, Promised, logErrors, textMatcher,
    parseVersion, required,
} from '../util';
import {
    isURLStashable, rootFolder, rootFolderWarning, tabStashTree,
} from '../stash';
import ui_model from '../ui-model';
import {Model, DeletedItems as DI} from '../model';
import {Tab} from '../model/tabs';
import {Bookmark} from '../model/bookmarks';
import {fetchInfoForSites} from '../tasks/siteinfo';

const Main = defineComponent({
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
        Window: require('./window.vue').default,
    },

    props: {
        window_id: required(Number),
        root_id: required(String),
        my_version: required(String),
        root_folder_warning: Object as PropType<
            Promised<ReturnType<typeof rootFolderWarning>>>,
    },

    data: () => ({
        collapsed: false,
        searchtext: '',
        dialog: undefined as undefined | {class: string, props: any},
    }),

    computed: {
        unstashed_tabs(): readonly Tab[] {
            return this.model().tabs.by_window.get(this.window_id) ?? [];
        },
        stashed_tabs(): Bookmark {
            // TODO remove !
            return this.model().bookmarks.by_id.get(this.root_id)!;
        },
        tabfolder_title(): string {
            if (this.model().options.sync.state.show_all_open_tabs) return "Open Tabs";
            return "Unstashed Tabs";
        },

        recently_updated(): undefined | 'features' | 'fixes' {
            const last_notified = this.model().options.local.state.last_notified_version;
            if (last_notified === this.my_version) return undefined;

            const my = parseVersion(this.my_version);
            const last = last_notified ? parseVersion(last_notified) : [];

            if (my[0] == last[0] && my[1] == last[1]) return 'fixes';
            return 'features';
        },

        recently_deleted(): DI.Deletion[] {
            return this.model().deleted_items.state.recentlyDeleted;
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
            return textMatcher(this.searchtext);
        },
    },

    mounted() {
        if (document.documentElement.classList.contains('popup-view')) {
            (<HTMLInputElement>this.$refs.search).focus();
        }
    },

    methods: {
        pageref,

        model(): Model { return <any>undefined; }, // dummy; overridden below

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
                && isURLStashable(t.url)
                && (this.model().options.sync.state.show_all_open_tabs
                    || ! this.isItemStashed(t));
        },

        isItemStashed(i: Tab): boolean {
            if (! i.url) return false;
            const bookmarks = this.model().bookmarks;
            const bms = bookmarks.by_url.get(i.url);
            return !!bms.find(bm => bookmarks.isBookmarkInFolder(bm, this.root_id));
        },

        showOptions() {
            browser.runtime.openOptionsPage().catch(console.log);
        },

        go(page: string) {
            window.location.href = pageref(page);
        },
        hideWhatsNew() {
            this.model().options.local.set({last_notified_version: this.my_version});
        },

        showExportDialog() {
            this.dialog = {
                class: 'ExportDialog',
                props: {stash: this.stashed_tabs.children},
            };
        },

        async fetchMissingFavicons() { logErrors(async() => {
            const favicons = this.model().favicons;
            const urls = new Set(urlsInTree(await tabStashTree()));

            // This is just an async filter :/
            for (const url of urls) {
                const favicon = favicons.get(url);
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
                        favicons.set(info.originalUrl, info.favIconUrl);
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
        model: ui_model(),
        root: rootFolder(), // TODO move into bookmarks model
        win: browser.windows.getCurrent(),
        curtab: browser.tabs.getCurrent(),
        extinfo: browser.management.getSelf(),
        warning: rootFolderWarning(),
    });

    return {
        propsData: {
            window_id: p.win.id!,
            root_id: p.root.id,
            my_version: p.extinfo.version,
            root_folder_warning: p.warning,
        },
        provide: {
            $model: p.model,
        },
        methods: {
            model() { return p.model; },
        },
    };
});
</script>

<style>
</style>

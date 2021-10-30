<template>
<main :class="{'selection-active': selection_active}" @click="deselectAll">
  <teleport to="body">
    <transition appear name="dialog">
      <component v-if="dialog" :is="dialog.class" v-bind="dialog.props"
                 @close="dialog = undefined">
      </component>
    </transition>
  </teleport>
  <transition-group tag="aside" class="notification-overlay" appear name="notification">
    <Notification key="new-features" v-if="recently_updated === 'features'"
                  @activate="go('whats-new.html')" @dismiss="hideWhatsNew">
      Tab Stash {{my_version}} now offers options to customize how it looks.
      See what's new!
    </Notification>
    <Notification key="new-fixes" v-if="recently_updated === 'fixes'"
                  @activate="go('whats-new.html')" @dismiss="hideWhatsNew">
      Tab Stash {{my_version}} now offers options to customize how it looks.
      See what's new!
    </Notification>
    <Notification key="stash-root-warning" v-if="stash_root_warning"
                  @activate="stash_root_warning.help">
      {{stash_root_warning.text}}
    </Notification>
    <Notification key="recently-deleted" v-if="recently_deleted.length > 0"
                  @activate="recently_deleted.length === 1
                    ? model().undelete(recently_deleted[0])
                    : go('deleted-items.html')">
        <span v-if="recently_deleted.length === 1">
            Deleted "{{recently_deleted[0].item.title}}".  Undo?
        </span>
        <span v-else>
            Deleted {{recently_deleted.length}} items.  Show what was deleted?
        </span>
    </Notification>
  </transition-group>
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
           @click.stop="; /* Don't propagate clicks so we can search without
                             losing whatever is currently selected. */"
           v-model="searchtext">
    <Button :class="{collapse: ! collapsed, expand: collapsed}"
            title="Hide all tabs so only group names are showing"
            @action="collapseAll" />
  </header>
  <div class="folder-list">
    <window :tabs="tabs" :userFilter="search_filter"
            :metadata="model().bookmark_metadata.get('')" />
  </div>
  <folder-list ref="stashed" v-if="stash_root"
               :parentFolder="stash_root"
               :userFilter="search_filter"
               :hideIfEmpty="searchtext !== ''" />
  <footer class="page status-text">
    Tab Stash {{my_version}} &mdash;
    <a :href="pageref('whats-new.html')">What's New</a>
  </footer>
</main>
</template>

<script lang="ts">
import browser from 'webextension-polyfill';
import {defineComponent, PropType} from 'vue';

import launch, {pageref} from '../launch-vue';
import {
    TaskMonitor, resolveNamed, logErrors, textMatcher,
    parseVersion, required,
} from '../util';
import ui_model from '../ui-model';
import {Model, DeletedItems as DI} from '../model';
import {Tab, WindowID} from '../model/tabs';
import {Bookmark, Folder} from '../model/bookmarks';
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
        window_id: required(Number as PropType<number> as PropType<WindowID>),
        my_version: required(String),
    },

    data: () => ({
        collapsed: false,
        searchtext: '',
        dialog: undefined as undefined | {class: string, props?: any},
    }),

    computed: {
        stash_root_warning(): {text: string, help: () => void} | undefined {
            return this.model().bookmarks.stash_root_warning.value;
        },
        tabs(): readonly Tab[] {
            return this.model().tabs.window(this.window_id).tabs
                .map(tid => this.model().tabs.tab(tid));
        },
        stash_root(): Folder | undefined {
            return this.model().bookmarks.stash_root.value;
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

        selection_active(): boolean {
            return this.model().selection.selected_count.value > 0;
        },

        counts(): {tabs: number, groups: number} {
            let tabs = 0, groups = 0;
            if (this.stash_root?.children) {
                for (const fid of this.stash_root.children) {
                    const f = this.model().bookmarks.node(fid);
                    if (! ('children' in f)) continue;
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

        // The following block of code is just to help me test out progress
        // dialogs (since they only appear for a limited time when things are
        // happening):
        /*
        const self = this;
        this.dialog = {
            class: 'ProgressDialog',
            props: {
                cancel() { self.dialog = undefined; },
                progress: {
                    status: 'Top',
                    max: 100,
                    value: 50,
                    children: [
                        {
                            status: 'Child 1',
                            max: 10,
                            value: 5,
                            children: [
                                {status: 'Grandchild A', max: 5, value: 1, children: []},
                                {status: 'Grandchild B', max: 5, value: 2, children: []},
                                {status: 'Grandchild C', max: 5, value: 5, children: []},
                            ]
                        },
                        {status: 'Child 2', max: 10, value: 2, children: []},
                        {status: 'Child 3', max: 10, value: 0, children: []},
                    ],
                }
            },
        };
        */
    },

    methods: {
        pageref,

        model(): Model { return <any>undefined; }, // dummy; overridden below

        collapseAll() {
            this.collapsed = ! this.collapsed;
            const metadata = this.model().bookmark_metadata;
            metadata.setCollapsed('', this.collapsed);
            for (const fid of this.stash_root?.children || []) {
                const f = this.model().bookmarks.node(fid);
                if (! ('children' in f)) continue;
                metadata.setCollapsed(f.id, this.collapsed);
            }
        },

        deselectAll() {
            this.model().selection.clearSelection().catch(console.error);
        },

        search_filter(i: Bookmark | Tab) {
            if (this.searchtext === '') return true;
            return (i.title && this.text_matcher(i.title))
                || (i.url && this.text_matcher(i.url));
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
                props: {stash: this.stash_root?.children || []},
            };
        },

        async fetchMissingFavicons() { logErrors(async() => {
            const favicons = this.model().favicons;
            const urls = this.model().bookmarks.urlsInStash();

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
        win: browser.windows.getCurrent(),
        curtab: browser.tabs.getCurrent(),
        extinfo: browser.management.getSelf(),
    });

    return {
        propsData: {
            window_id: p.win.id!,
            my_version: p.extinfo.version,
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

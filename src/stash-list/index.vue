<template>
<main :class="{'selection-active': selection_active}" tabindex="0"
      @click="deselectAll" @keydown.esc.prevent.stop="onEscape">
  <transition-group tag="aside" class="notification-overlay" appear name="notification">
    <Notification key="new-features" v-if="recently_updated === 'features'"
                  @activate="go('whats-new.html')" @dismiss="hideWhatsNew">
      Tab Stash {{my_version}} now allows you to select and move multiple tabs
      at once.  See what else is new!
    </Notification>
    <Notification key="new-fixes" v-if="recently_updated === 'fixes'"
                  @activate="go('whats-new.html')" @dismiss="hideWhatsNew">
      Tab Stash {{my_version}} now allows you to select and move multiple tabs
      at once.  See what else is new!
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
  <header class="page action-container"
          @click.stop="; /* Don't propagate clicks so we can search without
                            losing whatever is currently selected. */">
    <Menu class="menu main-menu" summaryClass="action mainmenu">
      <button @click.prevent="showOptions">Options...</button>
      <hr/>
      <button @click.prevent="dialog = {class: 'ImportDialog'}">Import...</button>
      <button @click.prevent="showExportDialog">Export...</button>
      <hr/>
      <a tabindex="0" :href="pageref('deleted-items.html')">Deleted Items...</a>
      <button @click.prevent="fetchMissingFavicons">Fetch Missing Icons</button>
      <hr/>
      <a tabindex="0" href="https://josh-berry.github.io/tab-stash/tips.html">Tips and Tricks</a>
      <a tabindex="0" href="https://github.com/josh-berry/tab-stash/wiki">Wiki</a>
      <a tabindex="0" href="https://josh-berry.github.io/tab-stash/support.html">Help and Support</a>
      <a tabindex="0" :href="pageref('whats-new.html')">What's New?</a>
    </Menu>
    <SelectionMenu v-if="selection_active" />
    <input type="search" ref="search" class="ephemeral" aria-label="Search"
           :placeholder="search_placeholder" v-model="searchText">
    <Button :class="{collapse: ! collapsed, expand: collapsed}"
            title="Hide all tabs so only group names are showing"
            @action="collapseAll" />
  </header>
  <div class="folder-list">
    <window :tabs="tabs" :metadata="model().bookmark_metadata.get('')" />
  </div>
  <folder-list ref="stashed" v-if="stash_root"
               :parentFolder="stash_root" />
  <footer class="page status-text">
    Tab Stash {{my_version}} &mdash;
    <a :href="pageref('whats-new.html')">What's New</a>
  </footer>
</main>

<transition appear name="dialog">
    <component v-if="dialog" :is="dialog.class" v-bind="dialog.props"
               @close="dialog = undefined" />
</transition>
</template>

<script lang="ts">
import browser from 'webextension-polyfill';
import {defineComponent} from 'vue';

import {pageref} from '../launch-vue';
import {TaskMonitor, expect, parseVersion, required} from '../util';
import {Model, DeletedItems as DI} from '../model';
import {Tab} from '../model/tabs';
import {Folder} from '../model/bookmarks';
import {fetchInfoForSites} from '../tasks/siteinfo';

export default defineComponent({
    components: {
        SelectionMenu: require('./selection-menu.vue').default,
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
        my_version: required(String),
    },

    data: () => ({
        collapsed: false,
        searchText: '',
        dialog: undefined as undefined | {class: string, props?: any},
    }),

    computed: {
        stash_root_warning(): {text: string, help: () => void} | undefined {
            return this.model().bookmarks.stash_root_warning.value;
        },
        tabs(): readonly Tab[] {
            const m = this.model().tabs;
            if (m.targetWindow.value === undefined) return [];
            const win = m.window(m.targetWindow.value);
            if (! win) return [];
            return m.tabsIn(win);
        },
        stash_root(): Folder | undefined {
            return this.model().bookmarks.stash_root.value;
        },
        stash_groups(): Folder[] {
            if (! this.stash_root?.children) return [];
            return this.model().bookmarks.childrenOf(this.stash_root)
                .filter(c => 'children' in c) as Folder[];
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
            return this.model().selection.selectedCount.value > 0;
        },

        counts(): {tabs: number, groups: number} {
            let tabs = 0, groups = 0;
            for (const f of this.stash_groups) {
                tabs += f.children.length;
                groups++;
            }
            return {tabs, groups};
        },

        search_placeholder(): string {
            const counts = this.counts;
            const groups = counts.groups == 1 ? 'group' : 'groups';
            const tabs = counts.tabs == 1 ? 'tab' : 'tabs';
            return `Search ${counts.groups} ${groups}, ${counts.tabs} ${tabs}`;
        },
    },

    mounted() {
        if (document.documentElement.classList.contains('view-popup')) {
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

    watch: {
        searchText(text) { this.model().setFilter(text); },
    },

    methods: {
        pageref,

        model(): Model { return <any>undefined; }, // dummy; overridden in index.ts

        collapseAll() {
            this.collapsed = ! this.collapsed;
            const metadata = this.model().bookmark_metadata;
            metadata.setCollapsed('', this.collapsed);
            for (const f of this.stash_groups) {
                metadata.setCollapsed(f.id, this.collapsed);
            }
        },

        onEscape() {
            if (this.searchText) {
                this.searchText = '';
                return;
            }
            this.deselectAll();
        },

        deselectAll() {
            this.model().selection.clearSelection().catch(console.error);
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
            this.dialog = {class: 'ExportDialog', props: {}};
        },

        async fetchMissingFavicons() { this.model().attempt(async() => {
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
</script>

<style>
</style>

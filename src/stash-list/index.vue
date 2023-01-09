<template>
  <main
    :class="{'stash-list': true, 'selection-active': selection_active}"
    tabindex="0"
    @click="deselectAll"
    @keydown.esc.prevent.stop="onEscape"
  >
    <transition-group
      tag="aside"
      class="notification-overlay"
      appear
      name="notification"
    >
      <OopsNotification key="oops" v-if="showCrashReport" />
      <Notification
        key="new-features"
        v-if="recently_updated === 'features'"
        @activate="go('whats-new.html')"
        @dismiss="hideWhatsNew"
      >
        Tab Stash {{ my_version }} includes lots of small quality-of-life
        improvements. See what's new!
      </Notification>
      <Notification
        key="new-fixes"
        v-if="recently_updated === 'fixes'"
        @activate="go('whats-new.html')"
        @dismiss="hideWhatsNew"
      >
        Tab Stash {{ my_version }} includes lots of small quality-of-life
        improvements. See what's new!
      </Notification>
      <Notification
        key="stash-root-warning"
        v-if="stash_root_warning"
        @activate="stash_root_warning!.help"
      >
        {{ stash_root_warning.text }}
      </Notification>
      <Notification
        key="recently-deleted"
        v-if="recently_deleted !== 0"
        @activate="
          typeof recently_deleted === 'object'
            ? model().undelete(recently_deleted)
            : go('deleted-items.html')
        "
      >
        <span v-if="typeof recently_deleted === 'object'">
          Deleted "{{ recentlyDeletedTitle }}". Undo?
        </span>
        <span v-else>
          Deleted {{ recently_deleted }} items. Show what was deleted?
        </span>
      </Notification>
    </transition-group>

    <header class="page action-container" @click.stop="">
      <Menu class="menu main-menu" summaryClass="action mainmenu">
        <button @click.prevent="showOptions">Options...</button>
        <hr />
        <button @click.prevent="dialog = {class: 'ImportDialog'}">
          Import...
        </button>
        <button @click.prevent="showExportDialog">Export...</button>
        <hr />
        <a tabindex="0" :href="pageref('deleted-items.html')"
          >Deleted Items...</a
        >
        <button @click.prevent="fetchMissingFavicons">
          Fetch Missing Icons
        </button>
        <hr />
        <a tabindex="0" href="https://josh-berry.github.io/tab-stash/tips.html"
          >Tips and Tricks</a
        >
        <a tabindex="0" href="https://github.com/josh-berry/tab-stash/wiki"
          >Wiki</a
        >
        <a
          tabindex="0"
          href="https://josh-berry.github.io/tab-stash/support.html"
          >Help and Support</a
        >
        <a tabindex="0" :href="pageref('whats-new.html')">What's New?</a>
      </Menu>

      <SelectionMenu v-if="selection_active" />

      <search-input
        :tooltip="searchTooltip"
        :placeholder="search_placeholder"
        v-model="searchText"
        :focus-on-mount="focusSearchOnMount"
      />
      <Button
        :class="{collapse: !collapsed, expand: collapsed}"
        title="Hide all tabs so only group names are showing"
        @action="collapseAll"
      />
    </header>

    <ul class="forest one-column">
      <li><window :tabs="tabs" :metadata="curWindowMetadata" /></li>
    </ul>

    <folder-list ref="stashed" v-if="stash_root" :parentFolder="stash_root" />

    <footer class="page status-text">
      Tab Stash {{ my_version }} &mdash;
      <a :href="pageref('whats-new.html')">What's New</a>
    </footer>
  </main>

  <transition appear name="dialog">
    <component
      v-if="dialog"
      :is="dialog.class"
      v-bind="dialog.props"
      @close="dialog = undefined"
    />
  </transition>
</template>

<script lang="ts">
import {defineComponent} from "vue";
import browser from "webextension-polyfill";

import {pageref} from "../launch-vue";
import type {Model} from "../model";
import {
  CUR_WINDOW_MD_ID,
  type BookmarkMetadataEntry,
} from "../model/bookmark-metadata";
import {friendlyFolderName, type Folder} from "../model/bookmarks";
import type {Tab} from "../model/tabs";
import {fetchInfoForSites} from "../tasks/siteinfo";
import {parseVersion, required, TaskMonitor} from "../util";

import Button from "../components/button.vue";
import Menu from "../components/menu.vue";
import Notification from "../components/notification.vue";
import OopsNotification from "../components/oops-notification.vue";
import ProgressDialog from "../components/progress-dialog.vue";
import SearchInput from "../components/search-input.vue";
import ExportDialog from "../tasks/export.vue";
import ImportDialog from "../tasks/import.vue";
import FolderList from "./folder-list.vue";
import FolderVue from "./folder.vue";
import SelectionMenu from "./selection-menu.vue";
import Window from "./window.vue";

export default defineComponent({
  components: {
    Button,
    ExportDialog,
    Folder: FolderVue,
    FolderList,
    ImportDialog,
    Menu,
    Notification,
    OopsNotification,
    ProgressDialog,
    SearchInput,
    SelectionMenu,
    Window,
  },

  props: {
    my_version: required(String),
  },

  data: () => ({
    collapsed: false,
    searchText: "",
    dialog: undefined as undefined | {class: string; props?: any},
  }),

  computed: {
    stash_root_warning(): {text: string; help: () => void} | undefined {
      return this.model().bookmarks.stash_root_warning.value;
    },
    targetWindow() {
      return this.model().tabs.targetWindow.value;
    },
    tabs(): readonly Tab[] {
      const m = this.model().tabs;
      if (m.targetWindow.value === undefined) return [];
      const win = m.window(m.targetWindow.value);
      if (!win) return [];
      return m.tabsIn(win);
    },
    stash_root(): Folder | undefined {
      return this.model().bookmarks.stash_root.value;
    },
    stash_groups(): Folder[] {
      if (!this.stash_root?.children) return [];
      return this.model()
        .bookmarks.childrenOf(this.stash_root)
        .filter(c => "children" in c) as Folder[];
    },

    recently_updated(): undefined | "features" | "fixes" {
      const last_notified =
        this.model().options.local.state.last_notified_version;
      if (last_notified === this.my_version) return undefined;

      const my = parseVersion(this.my_version);
      const last = last_notified ? parseVersion(last_notified) : [];

      if (my[0] == last[0] && my[1] == last[1]) return "fixes";
      return "features";
    },

    recently_deleted() {
      return this.model().deleted_items.state.recentlyDeleted;
    },
    recentlyDeletedTitle() {
      if (typeof this.recently_deleted === "object") {
        return friendlyFolderName(this.recently_deleted.item.title);
      }
      return undefined;
    },

    selection_active(): boolean {
      return this.model().selection.selectedCount.value > 0;
    },

    counts(): {tabs: number; groups: number} {
      let tabs = 0,
        groups = 0;
      for (const f of this.stash_groups) {
        tabs += f.children.length;
        groups++;
      }
      return {tabs, groups};
    },

    search_placeholder(): string {
      const counts = this.counts;
      const groups = counts.groups == 1 ? "group" : "groups";
      const tabs = counts.tabs == 1 ? "tab" : "tabs";
      return `Search ${counts.groups} ${groups}, ${counts.tabs} ${tabs}`;
    },

    tabStats(): {open: number; discarded: number; hidden: number} {
      let open = 0,
        discarded = 0,
        hidden = 0;
      for (const tab of this.tabs) {
        if (tab.windowId !== this.targetWindow) continue;
        if (tab.hidden) {
          hidden += 1;
        } else if (tab.discarded) {
          discarded += 1;
        } else {
          open += 1;
        }
      }
      return {open, discarded, hidden};
    },

    searchTooltip(): string {
      const st = this.tabStats;
      const tabs_sum = st.open + st.discarded + st.hidden;
      return `${this.counts.groups} group${this.plural(this.counts.groups)}, ${
        this.counts.tabs
      } stashed tab${this.plural(
        this.counts.tabs,
      )}\n${tabs_sum} tab${this.plural(tabs_sum)} in this window (${
        st.open
      } open, ${st.discarded} unloaded, ${st.hidden} hidden)`;
    },

    focusSearchOnMount(): boolean {
      return document.documentElement.classList.contains("view-popup");
    },

    curWindowMetadata(): BookmarkMetadataEntry {
      return this.model().bookmark_metadata.get(CUR_WINDOW_MD_ID);
    },

    showCrashReport(): boolean {
      return this.model().options.showCrashReport.value;
    },
  },

  mounted() {
    // The following block of code is just to help me test out progress
    // dialogs (since they only appear for a limited time when things are
    // happening):
    /*
    const self = this;
    this.dialog = {
      class: "ProgressDialog",
      props: {
        cancel() {
          self.dialog = undefined;
        },
        progress: {
          status: "Top",
          max: 100,
          value: 50,
          children: [
            {
              status: "Child 1",
              max: 10,
              value: 5,
              children: [
                {status: "Grandchild A", max: 5, value: 1, children: []},
                {status: "Grandchild B", max: 5, value: 2, children: []},
                {status: "Grandchild C", max: 5, value: 5, children: []},
              ],
            },
            {status: "Child 2", max: 10, value: 2, children: []},
            {status: "Child 3", max: 10, value: 0, children: []},
          ],
        },
      },
    };
    */
  },

  watch: {
    searchText(text) {
      this.model().setFilter(text);
    },
  },

  methods: {
    pageref,

    model(): Model {
      return <any>undefined;
    }, // dummy; overridden in index.ts

    collapseAll() {
      this.collapsed = !this.collapsed;
      const metadata = this.model().bookmark_metadata;
      metadata.setCollapsed(CUR_WINDOW_MD_ID, this.collapsed);
      for (const f of this.stash_groups) {
        metadata.setCollapsed(f.id, this.collapsed);
      }
    },

    onEscape() {
      if (this.searchText) {
        this.searchText = "";
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
      this.dialog = {class: "ExportDialog", props: {}};
    },

    plural(n: number): string {
      return n == 1 ? "" : "s";
    },

    async fetchMissingFavicons() {
      this.model().attempt(async () => {
        const favicons = this.model().favicons;
        const urls = this.model().bookmarks.urlsInStash();

        // This is just an async filter :/
        for (const url of urls) {
          const favicon = favicons.get(url);
          if (favicon?.value?.favIconUrl) urls.delete(url);
        }

        const iter = TaskMonitor.run_iter(tm => fetchInfoForSites(urls, tm));
        this.dialog = {
          class: "ProgressDialog",
          props: {progress: iter.progress, cancel: () => iter.cancel()},
        };

        try {
          for await (const info of iter) {
            favicons.set(info.originalUrl, {
              favIconUrl: info.favIconUrl ?? null,
              title: info.title,
            });
          }
        } finally {
          this.dialog = undefined;
        }
      });
    },
  },
});
</script>

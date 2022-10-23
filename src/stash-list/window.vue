<template>
<section :class="{folder: true,
              window: true,
              'action-container': true,
              collapsed: collapsed,
              }">
  <header>
    <Button :class="{collapse: ! collapsed, expand: collapsed}"
            tooltip="Hide the tabs for this group"
            @action="collapsed = ! collapsed" />
    <ButtonBox v-if="selectedCount === 0" class="folder-actions">
      <Button class="stash" @action="stash"
              :tooltip="`Stash all ${
                    showStashedTabs ? 'open tabs' : 'unstashed tabs'
                } to a new group (hold ${altKey} to keep tabs open)`" />
      <Button class="stash newgroup" @action="newGroup"
              tooltip="Create a new empty group" />
      <Button class="remove" @action="remove"
              :tooltip="`Close all unstashed tabs`" />
      <Button class="remove stashed" @action="removeStashed"
              :tooltip="`Close all stashed tabs`" />
      <Button class="remove opened" @action="removeOpen" :tooltip="
`Click: Close all open tabs
${altKey}+Click: Close any hidden/stashed tabs (reclaims memory)`" />
    </ButtonBox>
    <ButtonBox v-else class="folder-actions">
      <Button class="stash newgroup" @action="moveToNewGroup"
              :tooltip="`Move ${selectedCount} tab(s) to a new group (hold ${altKey} to copy)`" />
      <Button v-if="selectedCount > 0" class="restore" @action="copyToWindow"
              :tooltip="`Open ${selectedCount} tab(s)`" />
      <Button v-if="selectedCount > 0" class="restore-remove" @action="moveToWindow"
              :tooltip="`Unstash ${selectedCount} tab(s)`" />
    </ButtonBox>
    <span :class="{'folder-name': true, 'ephemeral': true, 'disabled': true}"
          :title="tooltip" @click.prevent.stop="toggleMode">{{title}}</span>
  </header>
  <div class="contents">
    <dnd-list class="tabs" v-model="tabs" item-key="id" :item-class="childClasses"
              :accepts="accepts" :drag="drag" :drop="drop" :mimic-height="true">
      <template #item="{item}">
        <tab v-if="isValidChild(item)" :tab="item"
             :class="{'folder-item': true, 'no-match': ! item.$visible}" />
      </template>
    </dnd-list>
    <div class="folder-item" v-if="filteredCount > 0"
         @click.prevent.stop="showFiltered = ! showFiltered">
      <span class="indent" />
      <span class="text status-text hidden-count">
        {{showFiltered ? '-' : '+'}} {{filteredCount}} filtered
      </span>
    </div>
  </div>
</section>
</template>

<script lang="ts">
import browser from 'webextension-polyfill';
import {PropType, defineComponent} from 'vue';

import {altKeyName, filterMap, required} from '../util';

import {DragAction, DropAction} from '../components/dnd-list';

import {Model, StashItem, copyIf} from '../model';
import {Tab} from '../model/tabs';
import {BookmarkMetadataEntry} from '../model/bookmark-metadata';
import type {SyncState} from '../model/options';

const DROP_FORMATS = [
    'application/x-tab-stash-items',
];

const NEXT_SHOW_OPEN_TAB_STATE: Record<SyncState['show_open_tabs'], SyncState['show_open_tabs']> = {
    'all': 'unstashed',
    'unstashed': 'all',
};

export default defineComponent({
    components: {
        Button: require('../components/button.vue').default,
        ButtonBox: require('../components/button-box.vue').default,
        DndList: require('../components/dnd-list.vue').default,
        Tab: require('./tab.vue').default,
        Bookmark: require('./bookmark.vue').default,
    },

    inject: ['$model'],

    props: {
        // Window contents
        tabs: required(Array as PropType<readonly Tab[]>),

        // Metadata (for collapsed state)
        metadata: required(Object as PropType<BookmarkMetadataEntry>),
    },

    data: () => ({
        showFiltered: false,
    }),

    computed: {
        altKey: altKeyName,

        accepts() { return DROP_FORMATS; },

        showStashedTabs(): boolean {
            return this.model().options.sync.state.show_open_tabs === 'all';
        },

        title(): string {
            if (this.showStashedTabs) return "Open Tabs";
            return "Unstashed Tabs";
        },

        tooltip(): string {
            return `${this.validChildren.length} ${this.title}\n`
                + `Click to change which tabs are shown.`;
        },

        collapsed: {
            get(): boolean { return !! this.metadata.value?.collapsed; },
            set(collapsed: boolean) {
                this.model().bookmark_metadata.setCollapsed(
                    this.metadata.key, collapsed);
            },
        },

        validChildren(): Tab[] {
            return this.tabs.filter(t => this.isValidChild(t));
        },
        visibleChildren(): Tab[] {
            return this.validChildren.filter(t => t.$visible);
        },
        filteredCount(): number {
            return this.validChildren.length - this.visibleChildren.length;
        },

        selectedCount(): number {
            return this.model().selection.selectedCount.value;
        },
    },

    methods: {
        // TODO make Vue injection play nice with TypeScript typing...
        model() { return (<any>this).$model as Model; },
        attempt(fn: () => Promise<void>) { this.model().attempt(fn); },

        toggleMode() { this.attempt(async() => {
            const options = this.model().options;
            await options.sync.set({
                show_open_tabs: NEXT_SHOW_OPEN_TAB_STATE[options.sync.state.show_open_tabs],
            });
        })},

        childClasses(t: Tab): Record<string, boolean> {
            return {hidden: ! (
                this.isValidChild(t) && (this.showFiltered || t.$visible))};
        },

        isValidChild(t: Tab): boolean {
            const model = this.model();
            if (t.hidden || t.pinned) return false;
            return this.showStashedTabs ||
                (model.isURLStashable(t.url) && ! model.bookmarks.isURLStashed(t.url));
        },

        async newGroup() {this.attempt(async() => {
            await this.model().bookmarks.createStashFolder();
        })},

        async stash(ev: MouseEvent | KeyboardEvent) {this.attempt(async() => {
            const model = this.model();
            const stashable_visible_children = this.visibleChildren
                .filter(t => model.isURLStashable(t.url));

            if (stashable_visible_children.length === 0) return;
            await model.putItemsInFolder({
                items: copyIf(ev.altKey, stashable_visible_children),
                toFolderId: (await model.bookmarks.createStashFolder()).id,
            });
        })},

        async remove() {this.attempt(async() => {
            const model = this.model();
            // This filter keeps the active tab if it's the Tab Stash tab, or a
            // new tab (so we can avoid creating new tabs unnecessarily).
            const to_remove = this.visibleChildren
                .filter(t => ! t.active || model.isURLStashable(t.url))
                .filter(t => ! model.bookmarks.isURLStashed(t.url));
            await model.tabs.remove(to_remove.map(t => t.id));
        })},

        async removeStashed() {this.attempt(async() => {
            const model = this.model();
            await model.hideOrCloseStashedTabs(this.tabs
                .filter(t => ! t.hidden && ! t.pinned
                            && model.bookmarks.isURLStashed(t.url))
                .map(t => t.id));
        })},

        async removeOpen(ev: MouseEvent | KeyboardEvent) {this.attempt(async() => {
            const model = this.model();

            if (ev.altKey) {
                // Discard hidden/stashed tabs to free memory.
                const tabs = this.tabs.filter(
                    t => t.hidden && model.bookmarks.isURLStashed(t.url));
                await model.tabs.remove(filterMap(tabs, t => t?.id));
            } else {
                // Closes ALL open tabs (stashed and unstashed).
                //
                // For performance, we will try to identify stashed tabs the
                // user might want to keep, and hide instead of close them.
                //
                // (Just as in remove(), we keep the active tab if it's a
                // new-tab page or the Tab Stash page.)
                const tabs = this.tabs.filter(t =>
                    (! t.active || model.isURLStashable(t.url))
                    && ! t.hidden && ! t.pinned);
                const hide_tabs = tabs
                    .filter(t => model.bookmarks.isURLStashed(t.url))
                    .map(t => t.id);
                const close_tabs = tabs
                    .filter(t => ! model.bookmarks.isURLStashed(t.url))
                    .map(t => t.id);

                await model.tabs.refocusAwayFromTabs(tabs.map(t => t.id));

                model.hideOrCloseStashedTabs(hide_tabs).catch(console.log);
                browser.tabs.remove(close_tabs).catch(console.log);
            }
        })},

        copyToWindow() {
            this.attempt(() => this.model().putSelectedInWindow({copy: true}));
        },

        moveToWindow() {
            this.attempt(() => this.model().putSelectedInWindow({copy: false}));
        },

        moveToNewGroup(ev: MouseEvent | KeyboardEvent) { this.attempt(async () => {
            const folder = await this.model().bookmarks.createStashFolder();
            await this.model().putSelectedInFolder({
                copy: ev.altKey,
                toFolderId: folder.id,
            });
        })},

        drag(ev: DragAction<Tab>) {
            const items = ev.value.$selected
                ? Array.from(this.model().selectedItems())
                : [ev.value];
            ev.dataTransfer.setData('application/x-tab-stash-items',
                JSON.stringify(items));
        },

        async drop(ev: DropAction) {
            const data = ev.dataTransfer.getData('application/x-tab-stash-items');
            const items = JSON.parse(data) as StashItem[];

            const model = this.model();
            await model.attempt(() => model.putItemsInWindow({
                items,
                toIndex: ev.toIndex,
            }));
        },
    },
});
</script>

<style>
</style>

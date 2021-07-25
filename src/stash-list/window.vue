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
    <ButtonBox class="folder-actions">
      <Button class="stash" @action="stash"
              :tooltip="`Stash only the unstashed tabs to a new group (hold ${altkey} to keep tabs open)`" />
      <Button class="stash newgroup" @action="newGroup"
              tooltip="Create a new empty group" />
      <Button v-if="! collapsed" class="remove" @action="remove"
              :tooltip="`Close all unstashed tabs`" />
      <Button v-if="! collapsed" class="remove stashed" @action="removeStashed"
              :tooltip="`Close all stashed tabs`" />
      <Button v-if="! collapsed" class="remove opened" @action="removeOpen"
              :tooltip="
`Click: Close all open tabs
${altkey}+Click: Close any hidden/stashed tabs (reclaims memory)`" />
    </ButtonBox>
    <!-- This is at the end so it gets put in front of the buttons etc.
         Important to ensure the focused box-shadow gets drawn over the buttons,
         rather than behind them. -->
    <editable-label :class="{'folder-name': true, 'disabled': true}"
                    :value="title" :defaultValue="title" />
  </header>
  <div class="contents">
    <Draggable group="tab" class="tabs" @change="move"
               v-model="children" item-key="id">
      <template #item="{element: item}">
        <tab :tab="item"
             :class="{hidden: (! filter(item)) || (userFilter && ! userFilter(item)),
                      'folder-item': true}" />
      </template>
    </Draggable>
    <div class="folder-item disabled" v-if="filterCount > 0">
      <span class="icon" /> <!-- spacer -->
      <span class="text status-text hidden-count">
        + {{filterCount}} filtered
      </span>
    </div>
  </div>
</section>
</template>

<script lang="ts">
import {browser} from 'webextension-polyfill-ts';
import {PropType, defineComponent} from 'vue';

import {altKeyName, filterMap, logErrors, required} from '../util';

import {Model} from '../model';
import {Tab} from '../model/tabs';
import {Bookmark, genDefaultFolderName} from '../model/bookmarks';
import {BookmarkMetadataEntry} from '../model/bookmark-metadata';
import { ChangeEvent } from 'vuedraggable';

export default defineComponent({
    components: {
        Button: require('../components/button.vue').default,
        ButtonBox: require('../components/button-box.vue').default,
        Draggable: require('vuedraggable'),
        EditableLabel: require('../components/editable-label.vue').default,
        Tab: require('./tab.vue').default,
        Bookmark: require('./bookmark.vue').default,
    },

    inject: ['$model'],

    props: {
        // View filter function
        userFilter: Function as PropType<(item: Tab) => boolean>,

        // Window contents
        tabs: required(Array as PropType<readonly Tab[]>),

        // Metadata (for collapsed state)
        metadata: required(Object as PropType<BookmarkMetadataEntry>),
    },

    data() { return {
        /** If a drag-and-drop operation has just completed, but the actual
         * model hasn't been updated yet, we temporarily show the user the model
         * "as if" the operation was already done, so it doesn't look like the
         * dragged item snaps back to its original location temporarily. */
        dirtyChildren: undefined as Tab[] | undefined,
    }; },

    computed: {
        altkey: altKeyName,

        title(): string {
            if (this.model().options.sync.state.show_all_open_tabs) return "Open Tabs";
            return "Unstashed Tabs";
        },

        children: {
            get(): readonly Tab[] {
                if (this.dirtyChildren) return this.dirtyChildren;
                return this.tabs;
            },
            set(children: Tab[]) {
                console.log("set dirty = ", children.map(c => c.title));
                // Triggered only by drag-and-drop
                // this.dirtyChildren = children;
            },
        },

        collapsed: {
            get(): boolean { return !! this.metadata.value?.collapsed; },
            set(collapsed: boolean) {
                this.model().bookmark_metadata.setCollapsed(
                    this.metadata.key, collapsed);
            },
        },

        filteredChildren(): Tab[] {
            return this.children.filter(c => this.filter(c));
        },
        visibleChildren(): Tab[] {
            if (this.userFilter) {
                return this.filteredChildren.filter(this.userFilter);
            } else {
                return this.filteredChildren;
            }
        },
        filterCount(): number {
            return this.filteredChildren.length - this.visibleChildren.length;
        },
    },

    methods: {
        // TODO make Vue injection play nice with TypeScript typing...
        model() { return (<any>this).$model as Model; },

        filter(t: Tab) {
            return ! t.hidden && ! t.pinned && t.url
                && this.model().isURLStashable(t.url)
                && (this.model().options.sync.state.show_all_open_tabs
                    || ! this.isItemStashed(t));
        },

        isItemStashed(i: Tab): boolean {
            if (! i.url) return false;

            const bookmarks = this.model().bookmarks;
            const stash_root_id = bookmarks.stash_root.value?.id;
            if (stash_root_id === undefined) return false;

            const bms = bookmarks.by_url.get(i.url);
            return !!bms.find(bm => bookmarks.isBookmarkInFolder(bm, stash_root_id));
        },

        async newGroup() {logErrors(async() => {
            await browser.bookmarks.create({
                parentId: (await this.model().bookmarks.ensureStashRoot()).id,
                title: genDefaultFolderName(new Date()),
                index: 0, // Newest folders should show up on top
            });
        })},

        async stash(ev: MouseEvent | KeyboardEvent) {logErrors(async() => {
            await this.model().stashTabs(this.visibleChildren, {close: ! ev.altKey});
        })},

        async remove() {logErrors(async() => {
            await this.model().tabs.closeTabs(this.visibleChildren.map(t => t.id));
        })},

        async removeStashed() {logErrors(async() => {
            if (! this.isItemStashed) throw new Error(
                "isItemStashed not provided to tab folder");

            await this.model().hideOrCloseStashedTabs(this.children
                .filter(t => t && ! t.hidden && ! t.pinned && this.isItemStashed(t))
                .map(t => t.id));
        })},

        async removeOpen(ev: MouseEvent | KeyboardEvent) {logErrors(async() => {
            if (! this.isItemStashed) throw new Error(
                "isItemStashed not provided to tab folder");

            if (ev.altKey) {
                // Discard hidden/stashed tabs to free memory.
                const tabs = this.children.filter(
                    t => t && t.hidden && this.isItemStashed(t));
                await this.model().tabs.closeTabs(filterMap(tabs, t => t?.id));
            } else {
                // Closes ALL open tabs (stashed and unstashed).
                //
                // For performance, we will try to identify stashed tabs the
                // user might want to keep, and hide instead of close them.
                const hide_tabs = this.children
                    .filter(t => ! t.hidden && ! t.pinned && this.isItemStashed(t))
                    .map(t => t.id);
                const close_tabs = this.children
                    .filter(t => ! t.hidden && ! t.pinned && ! this.isItemStashed(t))
                    .map(t => t.id);

                await this.model().tabs.refocusAwayFromTabs(
                    hide_tabs.concat(close_tabs));

                this.model().hideOrCloseStashedTabs(hide_tabs).catch(console.log);
                browser.tabs.remove(close_tabs).catch(console.log);
            }
        })},

        move(ev: ChangeEvent<Bookmark | Tab>) {
            // NOTE: This is for dragging INTO the window (either from within
            // the window itself or from a folder).
            const what = ev.moved || ev.added;
            if (! what) return false;

            // Disallow(maybe?) dragging of windows/bookmarks without URLs...
            if (! what.element?.url) return false;

            this.moveInternal(what)
                .catch(console.log)
                .finally(() => { this.dirtyChildren = undefined; });
        },

        async moveInternal(moved: {newIndex: number, element: Bookmark | Tab}) {
            const item = moved.element;
            if (! item.url) return false; // just to avoid casting

            let tid;
            if ('windowId' in item) {
                // Item being dragged is a Tab, so we are just moving it from
                // one place in the window to another.
                tid = item.id;

            } else {
                // Item being dragged is a Bookmark--that is, we're restoring a
                // tab to a particular location in the window.  If there's
                // already an open tab for this bookmark in the same window,
                // we will just move it to the right place.

                const cur_win = this.model().tabs.current_window;

                // First see if we have an open tab in this window already.  If
                // so, we need only move it into position.
                const already_open = this.model().tabs.by_url.get(item.url);
                tid = already_open.filter(t => t.windowId === cur_win)[0]?.id;
                if (tid === undefined) {
                    // There is no open tab, so we must restore one.
                    tid = (await this.model().restoreTabs(
                        [item.url], {background: true}))[0];
                }
            }

            // For sanity; we should always restore a tab or have one open.
            if (tid === undefined) return;

            // Move the (possibly-restored) tab to the right place in the
            // browser window.
            await browser.tabs.move(tid, {index: moved.newIndex});
            if (browser.tabs.show) await browser.tabs.show(tid);

            // Remove the previously-stashed tab (if there was one).
            if (! ('windowId' in item)) await this.model().deleteBookmark(item);
        },
    },
});
</script>

<style>
</style>

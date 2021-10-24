<template>
<section :class="{folder: true,
              'action-container': true,
              collapsed: collapsed,
              hidden: hideIfEmpty && visibleChildren.length == 0,
              }"
          :data-id="folder.id">
  <header>
    <Button :class="{collapse: ! collapsed, expand: collapsed}"
            tooltip="Hide the tabs for this group"
            @action="collapsed = ! collapsed" />
    <ButtonBox class="folder-actions">
      <Button class="stash here" @action="stash"
              :tooltip="`Stash all (or selected) open tabs to this group `
                        + `(hold ${altkey} to keep tabs open)`" />
      <Button class="stash one here" @action="stashOne"
              :tooltip="`Stash the active tab to this group `
                        + `(hold ${altkey} to keep tabs open)`" />
      <Button class="restore" @action="restoreAll"
              :tooltip="`Open all tabs in this group `
                      + `(hold ${bgKey} to open in background)`" />
      <Button class="restore-remove" @action="restoreAndRemove"
              :tooltip="`Open all tabs in the group and delete the group `
                      + `(hold ${bgKey} to open in background)`" />
      <Button v-if="! collapsed" class="remove" @action="remove"
              tooltip="Delete this group" />
    </ButtonBox>
    <!-- This is at the end so it gets put in front of the buttons etc.
         Important to ensure the focused box-shadow gets drawn over the buttons,
         rather than behind them. -->
    <editable-label :class="{'folder-name': true, 'ephemeral': true}"
                    :value="nonDefaultTitle"
                    :defaultValue="defaultTitle"
                    :edit="rename"></editable-label>
  </header>
  <div class="contents">
    <dnd-list class="tabs" v-model="allChildren" item-key="id"
              :accepts="accepts" :drag="drag" :drop="drop" :mimic-height="true">
      <template #item="{item}">
        <bookmark v-if="! ('children' in item)" :bookmark="item"
             :class="{hidden: (filter && ! filter(item))
                        || (userFilter && ! userFilter(item)),
                      'folder-item': true}" />
      </template>
    </dnd-list>
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
import browser from 'webextension-polyfill';
import {PropType, defineComponent} from 'vue';

import {
    altKeyName, bgKeyName, bgKeyPressed, logErrors, required
} from '../util';
import {DragAction, DropAction} from '../components/dnd-list';

import {Model} from '../model';
import {
    Node, Bookmark, Folder, genDefaultFolderName, getDefaultFolderNameISODate, NodeID
} from '../model/bookmarks';
import {BookmarkMetadataEntry} from '../model/bookmark-metadata';
import {TabID} from '../model/tabs';

const DROP_FORMATS = [
    'application/x-tab-stash-bookmark-id',
    'application/x-tab-stash-tab-id',
];

export default defineComponent({
    components: {
        Button: require('../components/button.vue').default,
        ButtonBox: require('../components/button-box.vue').default,
        DndList: require('../components/dnd-list.vue').default,
        EditableLabel: require('../components/editable-label.vue').default,
        Bookmark: require('./bookmark.vue').default,
    },

    inject: ['$model'],

    props: {
        // View filter functions
        userFilter: Function as PropType<(item: Bookmark) => boolean>,
        hideIfEmpty: Boolean,

        // Bookmark folder
        folder: required(Object as PropType<Folder>),

        metadata: required(Object as PropType<BookmarkMetadataEntry>),
    },

    computed: {
        altkey: altKeyName,
        bgKey: bgKeyName,

        accepts() { return DROP_FORMATS; },

        allChildren(): readonly Node[] {
            return this.folder.children.map(cid => this.model().bookmarks.node(cid));
        },

        collapsed: {
            get(): boolean { return !! this.metadata.value?.collapsed; },
            set(collapsed: boolean) {
                this.model().bookmark_metadata.setCollapsed(
                    this.metadata.key, collapsed);
            },
        },

        defaultTitle(): string {
            return `Saved ${(new Date(this.folder.dateAdded || 0)).toLocaleString()}`;
        },
        nonDefaultTitle(): string | undefined {
            return getDefaultFolderNameISODate(this.folder.title) !== null
                ? undefined : this.folder.title;
        },

        filteredChildren(): Bookmark[] {
            return this.allChildren.filter(c => 'url' in c) as Bookmark[];
        },
        visibleChildren(): Bookmark[] {
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

        async stash(ev: MouseEvent | KeyboardEvent) {logErrors(async() => {
            // Stashing possibly-selected open tabs into the current group.
            const win_id = this.model().tabs.current_window;
            if (! win_id) return;
            await this.model().stashTabsInWindow(
                win_id, {folderId: this.folder.id, close: ! ev.altKey});
        })},

        async stashOne(ev: MouseEvent | KeyboardEvent) {logErrors(async() => {
            const tab = this.model().tabs.activeTab();
            if (! tab) return;
            await this.model().stashTabs([tab],
                {folderId: this.folder.id, close: ! ev.altKey});
        })},

        async restoreAll(ev: MouseEvent | KeyboardEvent) {logErrors(async () => {
            await this.model().restoreTabs(
                this.filteredChildren.map(c => c.url),
                {background: bgKeyPressed(ev)});
        })},

        async remove() {logErrors(async() => {
            await this.model().deleteBookmarkTree(this.folder.id);
        })},

        async restoreAndRemove(ev: MouseEvent | KeyboardEvent) {logErrors(async() => {
            const bg = bgKeyPressed(ev);

            await this.model().restoreTabs(
                this.filteredChildren.map(c => c.url),
                {background: bg});
            await this.model().deleteBookmarkTree(this.folder.id);
        })},

        async rename(title: string) {
            if (title === '') {
                // Give it a default name based on when the folder was created
                title = genDefaultFolderName(new Date(this.folder.dateAdded || 0));
            }

            await browser.bookmarks.update(this.folder.id, {title});
        },

        drag(ev: DragAction<Bookmark>) {
            ev.dataTransfer.setData('application/x-tab-stash-bookmark-id', ev.value.id);
        },

        async drop(ev: DropAction) {
            const bmId = ev.dataTransfer.getData('application/x-tab-stash-bookmark-id');
            const tabId = ev.dataTransfer.getData('application/x-tab-stash-tab-id');

            if (tabId) {
                // We are dragging a tab into this bookmark folder.  Create a
                // new bookmark and close the tab.
                const tab = this.model().tabs.tab(Number.parseInt(tabId) as TabID);

                await browser.bookmarks.create({
                    parentId: this.folder.id,
                    title: tab.title,
                    url: tab.url,
                    index: ev.toIndex,
                });
                await this.model().hideOrCloseStashedTabs([tab.id]);

            } else if (bmId) {
                // We are dragging only bookmarks around.  Just move the
                // bookmark.
                const bm = this.model().bookmarks.node(bmId as NodeID);

                const fromFolder = bm.parentId;
                await this.model().bookmarks.move(
                    bm.id, this.folder.id, ev.toIndex);

                if (fromFolder === undefined) return;
                await this.model().bookmarks.removeFolderIfEmptyAndUnnamed(fromFolder);
            }
        },
    },
});
</script>

<style>
</style>

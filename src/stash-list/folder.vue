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
    <Draggable group="tab" class="tabs" @change="move"
               v-model="allChildren" item-key="id">
      <template #item="{element: item}">
        <bookmark :bookmark="item"
             :class="{hidden: (filter && ! filter(item))
                        || (userFilter && ! userFilter(item)),
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

import {
    altKeyName, bgKeyName, bgKeyPressed, filterMap, logErrors, required
} from '../util';

import {Model} from '../model';
import {
    Bookmark, genDefaultFolderName, getDefaultFolderNameISODate
} from '../model/bookmarks';
import {BookmarkMetadataEntry} from '../model/bookmark-metadata';
import { ChangeEvent } from 'vuedraggable';
import { Tab } from '../model/tabs';

export default defineComponent({
    components: {
        Button: require('../components/button.vue').default,
        ButtonBox: require('../components/button-box.vue').default,
        Draggable: require('vuedraggable'),
        EditableLabel: require('../components/editable-label.vue').default,
        Bookmark: require('./bookmark.vue').default,
    },

    inject: ['$model'],

    props: {
        // View filter functions
        userFilter: Function as PropType<(item: Bookmark) => boolean>,
        hideIfEmpty: Boolean,

        // Bookmark folder
        folder: required(Object as PropType<Bookmark>),

        metadata: required(Object as PropType<BookmarkMetadataEntry>),
    },

    data() { return {
        /** If a drag-and-drop operation has just completed, but the actual
         * model hasn't been updated yet, we temporarily show the user the model
         * "as if" the operation was already done, so it doesn't look like the
         * dragged item snaps back to its original location temporarily. */
        dirtyChildren: undefined as Bookmark[] | undefined,
    }; },

    computed: {
        altkey: altKeyName,
        bgKey: bgKeyName,

        allChildren: {
            get(): readonly Bookmark[] {
                if (this.dirtyChildren) return this.dirtyChildren;
                return this.folder.children || [];
            },
            set(children: Bookmark[]) {
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

        defaultTitle(): string {
            return `Saved ${(new Date(this.folder.dateAdded || 0)).toLocaleString()}`;
        },
        nonDefaultTitle(): string | undefined {
            return getDefaultFolderNameISODate(this.folder.title) !== null
                ? undefined : this.folder.title;
        },

        filteredChildren(): Bookmark[] {
            return this.allChildren.filter(c => c && c.url);
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
                filterMap(this.allChildren, item => item.url),
                {background: bgKeyPressed(ev)});
        })},

        async remove() {logErrors(async() => {
            await this.model().deleteBookmarkTree(this.folder.id);
        })},

        async restoreAndRemove(ev: MouseEvent | KeyboardEvent) {logErrors(async() => {
            const bg = bgKeyPressed(ev);

            await this.model().restoreTabs(
                filterMap(this.allChildren, item => item.url),
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

        move(ev: ChangeEvent<Bookmark | Tab>) {
            console.log(ev);
            // NOTE: This is for dragging INTO the folder (either from within
            // the folder itself, from another folder, or from a window).
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

            if ('windowId' in item) {
                // We are dragging a tab into this bookmark folder.  Create a
                // new bookmark and close the tab.
                await browser.bookmarks.create({
                    parentId: this.folder.id,
                    title: item.title,
                    url: item.url,
                    index: moved.newIndex,
                });
                await this.model().hideOrCloseStashedTabs([item.id]);

            } else {
                // We are dragging only bookmarks around.  Just move the
                // bookmark.
                const fromFolder = item.parentId;
                await browser.bookmarks.move(item.id, {
                    parentId: this.folder.id,
                    index: moved.newIndex,
                });

                if (fromFolder === undefined) return;
                await this.model().bookmarks.removeFolderIfEmptyAndUnnamed(fromFolder);
            }
        },
    },
});
</script>

<style>
</style>

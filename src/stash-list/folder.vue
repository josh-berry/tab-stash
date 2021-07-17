<template>
<section :class="{folder: true,
              'action-container': true,
              collapsed: collapsed,
              hidden: hideIfEmpty && visibleChildren.length == 0,
              }"
          :data-id="id">
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
      <Button v-if="allowRenameDelete"
              class="restore-remove" @action="restoreAndRemove"
              :tooltip="`Open all tabs in the group and delete the group `
                      + `(hold ${bgKey} to open in background)`" />
      <Button v-if="allowRenameDelete && ! collapsed"
              class="remove" @action="remove"
              tooltip="Delete this group" />
    </ButtonBox>
    <!-- This is at the end so it gets put in front of the buttons etc.
         Important to ensure the focused box-shadow gets drawn over the buttons,
         rather than behind them. -->
    <editable-label :class="{'folder-name': true, 'ephemeral': true,
                            'disabled': ! allowRenameDelete}"
                    :value="nonDefaultTitle"
                    :defaultValue="defaultTitle"
                    :enabled="allowRenameDelete"
                    @update:value="rename"></editable-label>
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
import {DeletedItem} from '../model/deleted-items';
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
        id: required(String),
        children: required(Array as PropType<Bookmark[]>),
        title: required(String),

        // Bookmark folder
        dateAdded: Number,
        allowRenameDelete: Boolean,

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
                return this.children;
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
            if (! this.dateAdded) return `Unstashed Tabs`;
            return `Saved ${(new Date(this.dateAdded)).toLocaleString()}`;
        },
        nonDefaultTitle(): string {
            return getDefaultFolderNameISODate(this.title) !== null
                ? '' : this.title;
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
                win_id, {folderId: this.id, close: ! ev.altKey});
        })},

        async stashOne(ev: MouseEvent | KeyboardEvent) {logErrors(async() => {
            const tab = this.model().tabs.activeTab();
            if (! tab) return;
            await this.model().stashTabs([tab], {folderId: this.id, close: ! ev.altKey});
        })},

        async restoreAll(ev: MouseEvent | KeyboardEvent) {logErrors(async () => {
            await this.model().restoreTabs(
                filterMap(this.allChildren, item => item.url),
                {background: bgKeyPressed(ev)});
        })},

        async remove() {logErrors(async() => {
            await this._deleteSelfAndLog();
        })},

        async restoreAndRemove(ev: MouseEvent | KeyboardEvent) {logErrors(async() => {
            const bg = bgKeyPressed(ev);

            await this.model().restoreTabs(
                filterMap(this.allChildren, item => item.url),
                {background: bg});
            await this._deleteSelfAndLog();
        })},

        rename(title: string) {
            if (title === '') {
                // Give it a default name based on when the folder was created
                title = genDefaultFolderName(new Date(this.dateAdded!));
            }

            // <any> is needed to work around incorrect typing in web-ext-types
            browser.bookmarks.update(this.id, <any>{title}).catch(console.log);
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
                    parentId: this.id,
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
                    parentId: this.id,
                    index: moved.newIndex,
                });

                if (fromFolder === undefined) return;
                await this.model().bookmarks.removeFolderIfEmptyAndUnnamed(fromFolder);
            }
        },

        async _deleteSelfAndLog() {
            // TODO save favicons
            const toDeletedItem = (item: Bookmarkable): DeletedItem => {
                if (item.children) {
                    return {
                        title: item.title ?? '',
                        children: (item.children.filter(i => i) as Bookmark[])
                            .map(i => toDeletedItem(i)),
                    };
                } else {
                    return {
                        title: item.title ?? item.url ?? '',
                        url: item.url ?? '',
                        // favIconUrl: item.favicon?.value,
                    }
                }
            };
            await this.model().deleted_items.add(toDeletedItem(this));
            await browser.bookmarks.removeTree(this.id);
        }
    },
});

// TODO helper type for things that look like a bookmark (including this
// component).  Fix this by taking a bookmark as a single prop, rather than a
// bunch of fields of a bookmark as different props...
type Bookmarkable = {
    title?: string,
    url?: string,
    // favicon?: FaviconCacheEntry,
    children?: readonly Bookmarkable[],
};
</script>

<style>
</style>

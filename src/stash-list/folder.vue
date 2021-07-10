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
    <editable-label :class="{'folder-name': true, 'ephemeral': ! isWindow,
                            'disabled': isWindow || ! allowRenameDelete}"
                    :value="nonDefaultTitle"
                    :defaultValue="defaultTitle"
                    :enabled="! isWindow && allowRenameDelete"
                    @update:value="rename"></editable-label>
  </header>
  <div class="contents">
    <Draggable group="tab" ref="drag" class="tabs"
               v-model="filteredChildren" item-key="id"
               @add="move" @update="move">
      <template #item="{element: item}">
        <tab v-if="item.isTab" :tab="item"
             :class="{hidden: (filter && ! filter(item))
                        || (userFilter && ! userFilter(item)),
                      'folder-item': true}" />
        <bookmark v-else :bookmark="item"
             :class="{hidden: (filter && ! filter(item))
                        || (userFilter && ! userFilter(item)),
                      'folder-item': true}" />
      </template>
    </Draggable>
    <div class="folder-item disabled" v-if="userHiddenChildren.length > 0">
      <span class="icon" /> <!-- spacer -->
      <span class="text status-text hidden-count">
        + {{userHiddenChildren.length}} filtered
      </span>
    </div>
  </div>
</section>
</template>

<script lang="ts">
import {browser} from 'webextension-polyfill-ts';
import {PropType, defineComponent} from 'vue';
import {SortableEvent} from 'sortablejs';

import {altKeyName, bgKeyName, bgKeyPressed, logErrors, required} from '../util';
import {
    getFolderNameISODate, genDefaultFolderName, rootFolder,
    stashTabsInWindow, stashTabs, restoreTabs, hideStashedTabs,
} from '../stash';

import {Model} from '../model';
import {Tab} from '../model/tabs';
import {Bookmark} from '../model/bookmarks';
import {DeletedItem} from '../model/deleted-items';
import {BookmarkMetadataEntry} from '../model/bookmark-metadata';

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
        // View filter functions
        filter: Function,
        userFilter: Function as PropType<(item: Bookmark) => boolean>,
        isItemStashed: Function as PropType<(t: Tab) => boolean>,
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

    computed: {
        altkey: altKeyName,
        bgKey: bgKeyName,

        collapsed: {
            get(): boolean { return !! this.metadata.value?.collapsed; },
            set(collapsed: boolean) {
                this.model().bookmark_metadata.set(
                    this.metadata.key,
                    {...this.metadata.value || {}, collapsed});
            },
        },

        isWindow(): boolean { return ! this.id; },
        defaultTitle(): string {
            if (! this.dateAdded) return `Unstashed Tabs`;
            return `Saved ${(new Date(this.dateAdded)).toLocaleString()}`;
        },
        nonDefaultTitle(): string {
            return getFolderNameISODate(this.title) !== null
                ? '' : this.title;
        },
        filteredChildren(): Bookmark[] {
            if (! this.children) return [];
            if (this.filter) {
                return this.children.filter(c => c && c.url && this.filter!(c));
            } else {
                return this.children.filter(c => c && c.url);
            }
        },
        visibleChildren(): Bookmark[] {
            if (this.userFilter) {
                return this.filteredChildren.filter(this.userFilter);
            } else {
                return this.filteredChildren;
            }
        },
        userHiddenChildren(): Bookmark[] {
            if (this.userFilter) {
                return this.filteredChildren.filter(
                    c => c && ! this.userFilter!(c));
            } else {
                return [];
            }
        },
    },

    methods: {
        // TODO make Vue injection play nice with TypeScript typing...
        model() { return (<any>this).$model as Model; },

        async newGroup() {logErrors(async() => {
            await browser.bookmarks.create({
                parentId: (await rootFolder()).id,
                title: genDefaultFolderName(new Date()),
                index: 0, // Newest folders should show up on top
            });
        })},

        async stash(ev: MouseEvent | KeyboardEvent) {logErrors(async() => {
            // Stashing possibly-selected open tabs into the current group.
            await stashTabsInWindow(undefined, {
                folderId: this.id,
                close: ! ev.altKey,
            });
        })},

        async stashOne(ev: MouseEvent | KeyboardEvent) {logErrors(async() => {
            let tabs = (await browser.tabs.query(
                    {currentWindow: true, hidden: false, active: true}))
                .sort((a, b) => a.index - b.index);

            await stashTabs(tabs, {
                folderId: this.id,
                close: ! ev.altKey,
            });
        })},

        async restoreAll(ev: MouseEvent | KeyboardEvent) {logErrors(async () => {
            await restoreTabs(this.children.map(item => item.url),
                             {background: bgKeyPressed(ev)});
        })},

        async remove() {logErrors(async() => {
            await this._deleteSelfAndLog();
        })},

        async restoreAndRemove(ev: MouseEvent | KeyboardEvent) {logErrors(async() => {
            const bg = bgKeyPressed(ev);

            await restoreTabs(this.children.map(item => item.url),
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

        async move(ev: SortableEvent) {logErrors(async() => {
            console.log("drag and drop not implemented for Vue 3 yet");
            return false;

            // Move is somewhat complicated, since we can have a combination of
            // different types of tabs (open tabs vs bookmarks) and folders
            // (folder of open tabs vs folder of bookmarks), and each needs to
            // be handled differently.
            //
            // Note that because of the way the events are bound, if we are
            // dragging between two folders, move is always triggered only on
            // the destination folder.
            //
            // One other critical thing to keep in mind--we have to calculate
            // indexes based on our children's .index values, and NOT the
            // positions as reported by ev.newIndex etc.  This is because the
            // children array might be filtered.

            // XXX All this nonsense with __vue__ is *totally documented*
            // (StackOverflow counts as documentation, right? :D), and super
            // #$*&ing janky because we're reaching into HTML to find out what
            // the heck Vue.Draggable is doing, but it seems to work...
            //
            // Note that ev.from is the <draggable>, so we want the parent
            // <folder>.
            const from_folder = (<any>ev.from).__vue__.$parent;
            const item = (<any>ev.item).__vue__;

            // Note that ev.to.children ALREADY reflects the updated state of
            // the list post-move, so we have to do some weird black-magic math
            // to determine which item got replaced, and thus the final index at
            // which to place the moved item in the model.
            let new_model_idx: number;
            if (this === from_folder) {
                // Moving within the same folder, so this is a rotation.  The
                // item was previously removed from oldIndex, so subsequent
                // items would have rotated upwards, and then when it was
                // reinserted, items after the new position would have rotated
                // downwards again.
                new_model_idx = ev.newIndex! < ev.oldIndex!
                    ? (<any>ev.to.children[ev.newIndex! + 1]).__vue__.index
                    : (<any>ev.to.children[ev.newIndex! - 1]).__vue__.index;

            } else if (ev.to.children.length > 1) {
                // Moving from another folder to a (non-empty) folder, so this
                // is strictly an insertion.  Pick the model index based on
                // neighboring items, assuming that the insertion would have
                // shifted everything else down.
                //
                // (NOTE: index > 1 above, since ev.to.children already contains
                // the item we are moving.)
                new_model_idx = ev.newIndex! < ev.to.children.length - 1
                    ? (<any>ev.to.children[ev.newIndex! + 1]).__vue__.index
                    : (<any>ev.to.children[ev.newIndex! - 1]).__vue__.index + 1;

            } else {
                // Moving from another folder, to an empty folder.  Just assume
                // we are inserting at the top.
                new_model_idx = 0;
            }

            if (! from_folder.isWindow && ! this.isWindow) {
                console.assert(item.isBookmark);
                // Moving a stashed tab from one place to another.
                await browser.bookmarks.move(item.id, {
                    parentId: this.id,
                    index: new_model_idx,
                });

                await this._maybeCleanupEmptyFolder(from_folder, item);

            } else {
                console.assert(item.isTab);
                // Save a single tab at a specific location.
                await browser.bookmarks.create({
                    parentId: this.id,
                    title: item.title,
                    url: item.url,
                    index: new_model_idx,
                });
                await hideStashedTabs([item]);
            }
        })},

        // TODO duplicated in window.vue
        async _maybeCleanupEmptyFolder(folder: Window | Bookmark, removing_item: Bookmark) {
            // If the folder we are removing an item from is empty and has a
            // default name, remove the folder automatically so we don't leave
            // any empty stashes lying around unnecessarily.

            if (folder instanceof Window) return;
            if (folder.id === this.id) return;
            if (getFolderNameISODate(folder.title ?? '') === null) return;

            // Now we check if the folder is empty, or about to be.  Note that
            // there are three cases here:
            //
            // 1. The model has been updated and /removing_item/ removed
            //    (so: length == 0),
            //
            // 2. The model hasn't yet been updated and /removing_item/ still
            //    appears to be present (but should have been removed already)
            //    (so: length == 1 and the only child is /removing_item/),
            //
            // 3. There are other children present which aren't /removing_item/,
            //    in which case the folder doesn't need to be cleaned up.
            //
            // The following paragraph detects case #3 and returns early.

            if (folder.children) {
                if (folder.children.length > 1) return;
                if (folder.children.length === 1
                    && folder.children[0]?.id !== removing_item.id) {
                    return;
                }
            }

            // If we reach this point, we have an empty, unnamed bookmark
            // folder.
            await browser.bookmarks.remove(folder.id);
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

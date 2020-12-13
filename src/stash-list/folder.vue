<template>
<div :class="{folder: true,
              window: isWindow,
              'action-container': true,
              collapsed: collapsed,
              hidden: hideIfEmpty && visibleChildren.length == 0,
              }">
  <div class="header">
    <ButtonBox class="collapse-btnbox">
      <Button :class="{collapse: collapsed, expand: ! collapsed}"
              tooltip="Hide the tabs for this group"
              @action="collapsed = ! collapsed" />
    </ButtonBox>
    <ButtonBox class="action-btnbox" v-if="! isWindow">
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
    <ButtonBox class="action-btnbox" v-else>
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
    <editable-label :class="{'folder-name': true, 'ephemeral': true,
                            'disabled': isWindow || ! allowRenameDelete}"
                    :value="nonDefaultTitle"
                    :defaultValue="defaultTitle"
                    :enabled="! isWindow && allowRenameDelete"
                    @update:value="rename"></editable-label>
  </div>
  <div class="contents">
    <Draggable group="tab" ref="drag" class="tabs"
               @add="move" @update="move">
      <tab v-for="item of filteredChildren"
           :key="item.id" v-bind="item"
           :class="{hidden: (filter && ! filter(item))
                         || (userFilter && ! userFilter(item)),
                    'folder-item': true}"></tab>
    </Draggable>
    <div class="folder-item disabled" v-if="userHiddenChildren.length > 0">
      <span class="text status-text hidden-count">
        + {{userHiddenChildren.length}} filtered
      </span>
    </div>
  </div>
</div>
</template>

<script lang="ts">
import {browser} from 'webextension-polyfill-ts';
import Vue, {PropType} from 'vue';
import {SortableEvent} from 'sortablejs';

import {altKeyName, bgKeyName, bgKeyPressed, logErrors} from '../util';
import {
    getFolderNameISODate, genDefaultFolderName, rootFolder,
    stashTabsInWindow, stashTabs, restoreTabs,
    closeTabs, hideStashedTabs, refocusAwayFromTabs,
} from '../stash';

import {Model} from '../model';
import {Cache, CacheEntry} from '../datastore/cache/client';
import {ModelLeaf, Tab, Window, Bookmark, FaviconCacheEntry} from '../model/browser';
import {DeletedItem} from '../model/deleted-items';

export default Vue.extend({
    components: {
        Button: require('../components/button.vue').default,
        ButtonBox: require('../components/button-box.vue').default,
        Draggable: require('vuedraggable'),
        EditableLabel: require('../components/editable-label.vue').default,
        Tab: require('./tab.vue').default,
    },

    inject: ['$model'],

    props: {
        // View filter functions
        filter: Function,
        userFilter: Function as PropType<(item: ModelLeaf) => boolean>,
        isItemStashed: Function,
        hideIfEmpty: Boolean,

        // Common
        id: String,
        children: Array as PropType<ModelLeaf[]>,
        title: String,

        // Bookmark folder
        dateAdded: Number,
        allowRenameDelete: Boolean,

        metadata: Object as PropType<CacheEntry<{collapsed: boolean}>>,
    },

    computed: {
        altkey: altKeyName,
        bgKey: bgKeyName,

        collapsed: {
            get(): boolean {
                const m = this.metadata.value;
                if (m) return !! m.collapsed;
                return false;
            },
            set(collapsed: boolean) {
                let m = {...this.metadata.value};
                m.collapsed = collapsed;
                Cache.open('bookmarks').set(this.metadata.key, m);
            },
        },

        isWindow(): boolean { return ! this.id; },
        defaultTitle(): string {
            return `Saved ${(new Date(this.dateAdded)).toLocaleString()}`;
        },
        nonDefaultTitle(): string {
            return getFolderNameISODate(this.title) !== null
                ? '' : this.title;
        },
        filteredChildren(): ModelLeaf[] {
            if (this.filter) {
                return this.children.filter(c => c && c.url && this.filter(c));
            } else {
                return this.children.filter(c => c && c.url);
            }
        },
        visibleChildren(): ModelLeaf[] {
            if (this.userFilter) {
                return this.filteredChildren.filter(this.userFilter);
            } else {
                return this.filteredChildren;
            }
        },
        userHiddenChildren(): ModelLeaf[] {
            if (this.userFilter) {
                return this.filteredChildren.filter(
                    c => c && ! this.userFilter(c));
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
            if (this.id) {
                // Stashing possibly-selected open tabs into the current group.
                await stashTabsInWindow(undefined, {
                    folderId: this.id,
                    close: ! ev.altKey,
                });
            } else {
                // This is the "Unstashed Tabs" group--stash everything in
                // "Unstashed Tabs" to a new group.
                await stashTabs(this.visibleChildren as Tab[], {close: ! ev.altKey});
            }
        })},

        async stashOne(ev: MouseEvent | KeyboardEvent) {logErrors(async() => {
            // Stashing the front tab to the unstashed-tabs group doesn't make
            // sense
            console.assert(this.id);
            let tabs = (await browser.tabs.query(
                    {currentWindow: true, hidden: false, active: true}))
                .sort((a, b) => a.index - b.index);

            await stashTabs(tabs, {
                folderId: this.id,
                close: ! ev.altKey,
            });
        })},

        async restoreAll(ev: MouseEvent | KeyboardEvent) {logErrors(async () => {
            console.assert(this.id); // Can't restore already-open tabs

            await restoreTabs(this.children.map(item => item.url),
                             {background: bgKeyPressed(ev)});
        })},

        async remove() {logErrors(async() => {
            if (this.id) {
                // If we have any hidden tabs stored for these bookmarks, we
                // should remove them first.  We do this explicitly to avoid the
                // momentary reshuffling of hidden tabs into the "Unstashed
                // Tabs" list which would happen if this was left to the garbage
                // collector in index.js.
                const tabs = this.children
                    .map(bm => <Tab | undefined>(
                            bm.related && bm.related.find(t => t instanceof Tab)))
                    .filter(t => t?.hidden)
                    .map(t => t?.id) as number[];
                await browser.tabs.remove(tabs);

                await this._deleteSelfAndLog();

            } else {
                // User has asked us to hide all unstashed tabs.
                await closeTabs(this.visibleChildren as Tab[]);
            }
        })},

        async removeStashed() {logErrors(async() => {
            if (this.id) throw new Error(
                "Called removeStashed from bookmark folder");

            await hideStashedTabs(this.children.filter(
                t => t && ! (<Tab>t).hidden && ! (<Tab>t).pinned
                       && this.isItemStashed(t)) as Tab[]);
        })},

        async removeOpen(ev: MouseEvent | KeyboardEvent) {logErrors(async() => {
            console.assert(! this.id);
            const children = this.children as (Tab | undefined)[];

            if (ev.altKey) {
                // Discard hidden/stashed tabs to free memory.
                const tabs = children.filter(
                    t => t && t.hidden && this.isItemStashed(t));
                await closeTabs(tabs as Tab[]);
            } else {
                // Closes ALL open tabs (stashed and unstashed).  This is just a
                // convenience button for the "Unstashed Tabs" view.
                //
                // For performance, we will try to identify stashed tabs the
                // user might want to keep, and hide instead of close them.
                const hide_tabs = children.filter(
                    t => t && ! t.hidden && ! t.pinned
                           && this.isItemStashed(t)) as Tab[];
                const close_tabs = children.filter(
                    t => t && ! t.hidden && ! t.pinned
                           && ! this.isItemStashed(t)) as Tab[];

                await refocusAwayFromTabs(hide_tabs.concat(close_tabs));

                hideStashedTabs(hide_tabs).catch(console.log);
                browser.tabs.remove(close_tabs.map(t => t.id))
                    .catch(console.log);
            }
        })},

        async restoreAndRemove(ev: MouseEvent | KeyboardEvent) {logErrors(async() => {
            console.assert(this.id); // Can't restore already-open tabs

            const bg = bgKeyPressed(ev);

            await restoreTabs(this.children.map(item => item.url),
                              {background: bg});

            // Discard opened tabs as requested.
            await this._deleteSelfAndLog();
        })},

        rename(title: string) {
            if (title === '') {
                // Give it a default name based on when the folder was created
                title = genDefaultFolderName(new Date(this.dateAdded));
            }

            // <any> is needed to work around incorrect typing in web-ext-types
            browser.bookmarks.update(this.id, <any>{title}).catch(console.log);
        },

        async move(ev: SortableEvent) {logErrors(async() => {
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
            const tab = (<any>item).tab;

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

            } else if (this.isWindow && tab) {
                // Moving a bookmark with an open tab from a bookmark folder to
                // the window folder.  This is ALSO a rotation, though it
                // doesn't much look like it--it's the case below where we
                // restore a tab and then remove the bookmark.  In this case,
                // however, we can't rely on oldIndex to tell us which way we're
                // rotating, so we have to infer based on our neighbors.
                if (ev.to.children.length > 1) {
                    const prev_idx: number = ev.newIndex! > 0
                        ? (<any>ev.to.children[ev.newIndex! - 1]).__vue__.index
                        : (<any>ev.to.children[1]).__vue__.index - 1;
                    new_model_idx = tab.index < prev_idx
                        ? prev_idx
                        : prev_idx + 1;
                } else {
                    // The destination doesn't have any unfiltered children, so
                    // we have nothing whatsoever to go on, so just don't have
                    // an opinion because it doesn't matter.
                    new_model_idx = -1;
                }

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

            } else if (! this.isWindow) {
                console.assert(item.isTab);
                // Save a single tab at a specific location.
                await browser.bookmarks.create({
                    parentId: this.id,
                    title: item.title,
                    url: item.url,
                    index: new_model_idx,
                });
                await hideStashedTabs([item]);

            } else {
                // Placing a tab at a particular location in the open window
                // (and possibly restoring it from the stash if necessary).
                let tid = tab ? tab.id : undefined;

                if (! tid) {
                    // Restoring from the stash.
                    let tabs = await restoreTabs(
                        [item.url], {background: true});

                    if (tabs[0]) {
                        tid = tabs[0].id;
                    } else {
                        // We didn't actually restore anything; just go with the
                        // tabid we already have.
                    }
                }

                console.assert(tid !== undefined);
                await browser.tabs.move(tid, {index: new_model_idx});
                await browser.tabs.show(tid);

                // Remove the restored bookmark
                if (item.isBookmark) {
                    await this.model().deleted_items.add({
                        title: item.title,
                        url: item.url,
                        favIconUrl: item.favicon?.value,
                    }, {
                        folder_id: this.id,
                        title: this.title,
                    });
                    await browser.bookmarks.remove(item.id);
                    await this._maybeCleanupEmptyFolder(from_folder, item);
                }
            }
        })},

        async _maybeCleanupEmptyFolder(folder: Window | Bookmark, removing_item: ModelLeaf) {
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
            if (! this.id) throw `Expected a bookmark folder`;
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
                        favIconUrl: item.favicon?.value,
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
    favicon?: FaviconCacheEntry,
    children?: (Bookmarkable | undefined)[],
};
</script>

<style>
</style>

<template>
<section :class="{folder: true,
              window: true,
              'action-container': true,
              collapsed: collapsed,
              hidden: hideIfEmpty && visibleChildren.length == 0,
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
                    :value="title" :defaultValue="title" :enabled="false" />
  </header>
  <div class="contents">
    <Draggable group="tab" ref="drag" class="tabs"
               v-model="filteredChildren" item-key="id"
               @add="move" @update="move">
      <template #item="{element: item}">
        <tab :tab="item"
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

import {altKeyName, logErrors, required} from '../util';
import {
    getFolderNameISODate, genDefaultFolderName, rootFolder,
    stashTabs, restoreTabs, closeTabs, hideStashedTabs, refocusAwayFromTabs,
} from '../stash';

import {Model} from '../model';
import {Cache, CacheEntry} from '../datastore/cache/client';
import {Tab} from '../model/tabs';
import {Bookmark} from '../model/bookmarks';

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
        userFilter: Function as PropType<(item: Tab) => boolean>,
        isItemStashed: Function as PropType<(t: Tab) => boolean>,
        hideIfEmpty: Boolean,

        // Window contents
        title: required(String),
        children: required(Array as PropType<Tab[]>),

        // Metadata (for collapsed state)
        metadata: required(Object as PropType<CacheEntry<{collapsed: boolean}>>),
    },

    computed: {
        altkey: altKeyName,

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

        filteredChildren(): Tab[] {
            if (! this.children) return [];
            if (this.filter) {
                return this.children.filter(c => c && c.url && this.filter!(c));
            } else {
                return this.children.filter(c => c && c.url);
            }
        },
        visibleChildren(): Tab[] {
            if (this.userFilter) {
                return this.filteredChildren.filter(this.userFilter);
            } else {
                return this.filteredChildren;
            }
        },
        userHiddenChildren(): Tab[] {
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
            await stashTabs(this.visibleChildren as Tab[], {close: ! ev.altKey});
        })},

        async remove() {logErrors(async() => {
            await closeTabs(this.visibleChildren as Tab[]);
        })},

        async removeStashed() {logErrors(async() => {
            if (! this.isItemStashed) throw new Error(
                "isItemStashed not provided to tab folder");
            if (! this.children) return;

            await hideStashedTabs(this.children.filter(
                t => t && ! (<Tab>t).hidden && ! (<Tab>t).pinned
                       && this.isItemStashed!(<Tab>t)) as Tab[]);
        })},

        async removeOpen(ev: MouseEvent | KeyboardEvent) {logErrors(async() => {
            if (! this.isItemStashed) throw new Error(
                "isItemStashed not provided to tab folder");

            if (! this.children) return;
            const children = this.children as (Tab | undefined)[];

            if (ev.altKey) {
                // Discard hidden/stashed tabs to free memory.
                const tabs = children.filter(
                    t => t && t.hidden && this.isItemStashed!(t));
                await closeTabs(tabs as Tab[]);
            } else {
                // Closes ALL open tabs (stashed and unstashed).  This is just a
                // convenience button for the "Unstashed Tabs" view.
                //
                // For performance, we will try to identify stashed tabs the
                // user might want to keep, and hide instead of close them.
                const hide_tabs = children.filter(
                    t => t && ! t.hidden && ! t.pinned
                           && this.isItemStashed!(t)) as Tab[];
                const close_tabs = children.filter(
                    t => t && ! t.hidden && ! t.pinned
                           && ! this.isItemStashed!(t)) as Tab[];

                await refocusAwayFromTabs(hide_tabs.concat(close_tabs));

                hideStashedTabs(hide_tabs).catch(console.log);
                browser.tabs.remove(close_tabs.map(t => t.id))
                    .catch(console.log);
            }
        })},

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

            } else if (tab) {
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
            if (browser.tabs.show) await browser.tabs.show(tid);

            // Remove the restored bookmark
            if (item.isBookmark) {
                await this.model().deleted_items.add({
                    title: item.title,
                    url: item.url,
                    favIconUrl: item.favicon?.value,
                }, {
                    folder_id: item.parent.id,
                    title: this.title,
                });
                await browser.bookmarks.remove(item.id);
                await this._maybeCleanupEmptyFolder(from_folder, item);
            }
        })},

        async _maybeCleanupEmptyFolder(folder: Bookmark, removing_item: Bookmark) {
            // If the folder we are removing an item from is empty and has a
            // default name, remove the folder automatically so we don't leave
            // any empty stashes lying around unnecessarily.

            if (folder instanceof Window) return;
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
    },
});
</script>

<style>
</style>

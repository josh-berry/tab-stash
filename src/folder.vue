<template>
<div :class="{folder: true,
              window: isWindow,
              
              'action-container': true,
              collapsed: collapsed}"
     v-if="! hideIfEmpty || visibleChildren.length > 0">
  <div class="panel-section-header">
    <div class="header">
      <editable-label :classes="{'folder-name': true,
                                 'disabled': isWindow || ! allowRenameDelete}"
                      :value="nonDefaultTitle"
                      :defaultValue="defaultTitle"
                      :enabled="! isWindow && allowRenameDelete"
                      @update:value="rename"></editable-label>
      <ButtonBox class="collapse-btnbox">
        <img :src="`icons/collapse-${collapsed ? 'closed' : 'open'}.svg`"
             :class="{action: true, collapse: true}"
             title="Hide the tabs for this group"
             @click.prevent.stop="collapsed = ! collapsed">
      </ButtonBox>
      <ButtonBox v-if="! isWindow">
        <img src="icons/stash-dark.svg" class="action stash"
             :title="`Stash all open tabs to this group (hold ${altkey} to keep tabs open)`"
             @click.prevent.stop="stash">
        <img src="icons/stash-one-dark.svg" class="action stash"
             :title="`Stash the active tab to this group (hold ${altkey} to keep tab open)`"
             @click.prevent.stop="stashOne">
        <img src="icons/restore.svg" class="action restore"
             title="Open all tabs in this group"
             @click.prevent.stop="restoreAll">
        <img v-if="allowRenameDelete"
             src="icons/restore-del.svg" class="action restore-remove"
             title="Open all tabs in the group and delete the group"
             @click.prevent.stop="restoreAndRemove">
        <img v-if="allowRenameDelete"
             src="icons/delete.svg" class="action remove"
             title="Delete this group"
             @click.prevent.stop="remove">
      </ButtonBox>
      <ButtonBox v-else>
        <img src="icons/stash-dark.svg" class="action stash"
             :title="`Stash only the unstashed tabs to a new group (hold ${altkey} to keep tabs open)`"
             @click.prevent.stop="stash">
        <img src="icons/new-empty-group.svg" class="action stash"
             title="Create a new empty group"
             @click.prevent.stop="newGroup">
        <img src="icons/delete.svg" class="action remove"
             :title="
`Click: Close all unstashed tabs
${altkey}+Click: Close/hide all stashed tabs`"
             @click.prevent.stop="remove">
        <img src="icons/delete-opened.svg" class="action remove"
             :title="
`Click: Close all open tabs
${altkey}+Click: Close any hidden/stashed tabs (reclaims memory)`"
             @click.prevent.stop="removeOpen">
      </ButtonBox>
    </div>
  </div>
  <div class="panel-section-list contents">
    <draggable :options="{group: 'tab'}" ref="drag"
               class="sortable-list"
               @add="move" @update="move">
      <tab v-for="item of visibleChildren"
           :key="item.id" v-bind="item"></tab>
    </draggable>
  </div>
</div>
</template>

<script>
import {asyncEvent, altKeyName} from './util';
import {
    getFolderNameISODate, genDefaultFolderName, rootFolder,
    isTabStashable,
    stashTabs, bookmarkTabs, restoreTabs, closeTabs, hideTabs,
    refocusAwayFromTabs,
} from 'stash';

import Draggable from 'vuedraggable';
import EditableLabel from './editable-label.vue';
import Tab from './tab.vue';
import ButtonBox from './button-box.vue';

export default {
    components: {Draggable, EditableLabel, Tab, ButtonBox},

    props: {
        // View filter functions
        filter: Function,
        isItemStashed: Function,
        hideIfEmpty: Boolean,

        // Common
        id: [String, Number],
        children: Array, // tabs in this window, OR bookmarks in this folder
        title: String,

        // Bookmark folder
        dateAdded: Number,
        allowRenameDelete: Boolean,
    },

    data: () => ({
        collapsed: false,
    }),

    computed: {
        altkey: altKeyName,

        isWindow: function() { return ! this.id; },
        defaultTitle: function() {
            return `Saved ${(new Date(this.dateAdded)).toLocaleString()}`;
        },
        nonDefaultTitle: function() {
            return getFolderNameISODate(this.title) !== null
                ? '' : this.title;
        },
        visibleChildren: function() {
            return this.children.filter(
                c => c.url && (! this.filter || this.filter(c)));
        },
    },

    methods: {
        newGroup: asyncEvent(async function(ev) {
            await browser.bookmarks.create({
                parentId: (await rootFolder()).id,
                title: genDefaultFolderName(new Date()),
                type: 'folder',
                index: 0, // Newest folders should show up on top
            });
        }),

        stash: asyncEvent(async function(ev) {
            let tabs = this.id
                ? await browser.tabs.query(
                    {currentWindow: true, hidden: false, pinned: false})
                : this.visibleChildren;

            if (ev.altKey) {
                await bookmarkTabs(this.id, tabs);
            } else {
                await stashTabs(this.id, tabs);
            }
        }),

        stashOne: asyncEvent(async function(ev) {
            // Stashing the front tab to the unstashed-tabs group doesn't make
            // sense
            console.assert(this.id);
            let tabs = await browser.tabs.query(
                {currentWindow: true, hidden: false, active: true});

            if (ev.altKey) {
                await bookmarkTabs(this.id, tabs);
            } else {
                await stashTabs(this.id, tabs);
            }
        }),

        restoreAll: asyncEvent(async function() {
            console.assert(this.id); // Can't restore already-open tabs

            // Figure out which tab WE are.  Do this before opening new tabs,
            // since that will disturb the browser's focus.
            let curtab = await browser.tabs.getCurrent();

            await restoreTabs(this.children.map(item => item.url));

            // If we ourselves are open in a tab (and not the sidebar or a
            // popup), close the tab so the user doesn't have to.
            if (curtab && ! curtab.pinned) {
                await browser.tabs.remove([curtab.id]);
            }
        }),

        remove: asyncEvent(async function(ev) {
            if (this.id) {
                // If we have any hidden tabs stored for these bookmarks, we
                // should remove them first.  We do this explicitly to avoid the
                // momentary reshuffling of hidden tabs into the "Unstashed
                // Tabs" list which would happen if this was left to the garbage
                // collector in index.js.
                let tabs = this.children
                    .map(bm => bm.related.find(t => t.isTab))
                    .filter(t => t && t.hidden);
                await browser.tabs.remove(tabs.map(t => t.id));

                await browser.bookmarks.removeTree(this.id);

            } else {
                // This is the "open-tabs" folder.
                if (ev.altKey) {
                    // User has asked us to hide all STASHED tabs.
                    // (Note that this.visibleChildren are the UNSTASHED tabs)
                    //
                    // XXX This is similar to the unstashedFilter, but the
                    // isBookmark test is inverted.
                    await hideTabs(this.children.filter(
                        t => ! t.hidden && ! t.pinned
                            && this.isItemStashed(t)));
                } else {
                    // User has asked us to hide all unstashed tabs.
                    await closeTabs(this.visibleChildren);
                }

            }
        }),

        removeOpen: asyncEvent(async function(ev) {
            console.assert(! this.id);
            if (ev.altKey) {
                // Discard hidden/stashed tabs to free memory.
                let tabs = this.children.filter(
                    t => t.hidden && this.isItemStashed(t));
                await closeTabs(tabs);
            } else {
                // Closes ALL open tabs (stashed and unstashed).  This is just a
                // convenience button for the "Unstashed Tabs" view.
                //
                // For performance, we will try to identify stashed tabs the
                // user might want to keep, and hide instead of close them.
                let hide_tabs = this.children.filter(
                    t => ! t.hidden && ! t.pinned && this.isItemStashed(t));
                let close_tabs = this.children.filter(
                    t => ! t.hidden && ! t.pinned && ! this.isItemStashed(t));

                await refocusAwayFromTabs(Array.concat(hide_tabs, close_tabs));

                browser.tabs.hide(hide_tabs.map(t => t.id))
                    .catch(console.log);
                browser.tabs.remove(close_tabs.map(t => t.id))
                    .catch(console.log);
            }
        }),

        restoreAndRemove: asyncEvent(async function() {
            console.assert(this.id); // Can't restore already-open tabs

            // Figure out which tab WE are.  Do this before opening new tabs,
            // since that will disturb the browser's focus.
            let curtab = await browser.tabs.getCurrent();

            await restoreTabs(this.children.map(item => item.url));

            // Discard opened tabs as requested.
            await browser.bookmarks.removeTree(this.id);

            // If we ourselves are open in a tab (and not the sidebar or a
            // popup), close the tab so the user doesn't have to.
            if (curtab && ! curtab.pinned) {
                await browser.tabs.remove([curtab.id]);
            }
        }),

        rename: function(title) {
            if (title === '') {
                // Give it a default name based on when the folder was created
                title = genDefaultFolderName(new Date(this.dateAdded));
            }
            browser.bookmarks.update(this.id, {title}).catch(console.log);
        },

        move: asyncEvent(async function(ev) {
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
            const from_folder = ev.from.__vue__.$parent;
            const item = ev.item.__vue__;
            const tab = item.tab;

            // Note that ev.to.children ALREADY reflects the updated state of
            // the list post-move, so we have to do some weird black-magic math
            // to determine which item got replaced, and thus the final index at
            // which to place the moved item in the model.
            let new_model_idx;
            if (this === from_folder) {
                // Moving within the same folder, so this is a rotation.  The
                // item was previously removed from oldIndex, so subsequent
                // items would have rotated upwards, and then when it was
                // reinserted, items after the new position would have rotated
                // downwards again.
                new_model_idx = ev.newIndex < ev.oldIndex
                    ? ev.to.children[ev.newIndex + 1].__vue__.index
                    : ev.to.children[ev.newIndex - 1].__vue__.index;

            } else if (this.isWindow && tab) {
                // Moving a bookmark with an open tab from a bookmark folder to
                // the window folder.  This is ALSO a rotation, though it
                // doesn't much look like it--it's the case below where we
                // restore a tab and then remove the bookmark.  In this case,
                // however, we can't rely on oldIndex to tell us which way we're
                // rotating, so we have to infer based on our neighbors.
                if (ev.to.children.length > 1) {
                    let prev_idx = ev.newIndex > 0
                        ? ev.to.children[ev.newIndex - 1].__vue__.index
                        : ev.to.children[1].__vue__.index - 1;
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
                new_model_idx = ev.newIndex < ev.to.children.length - 1
                    ? ev.to.children[ev.newIndex + 1].__vue__.index
                    : ev.to.children[ev.newIndex - 1].__vue__.index + 1;

            } else {
                // Moving from another folder, to an empty folder.  Just assume
                // we are inserting at the top.
                new_model_idx = 0;
            }

            if (! from_folder.isWindow && ! this.isWindow) {
                console.assert(item.isBookmark);
                // Moving a stashed tab from one place to another.
                browser.bookmarks.move(item.id, {
                    parentId: this.id,
                    index: new_model_idx,
                }).catch(console.log);

            } else if (! this.isWindow) {
                console.assert(item.isTab);
                // Save a single tab at a specific location.
                await browser.bookmarks.create({
                    parentId: this.id,
                    title: item.title,
                    url: item.url,
                    index: new_model_idx,
                });
                await hideTabs([item]);

            } else {
                // Placing a tab at a particular location in the open window
                // (and possibly restoring it from the stash if necessary).
                let tid = tab ? tab.id : undefined;

                if (! tid) {
                    // Restoring from the stash.
                    let tabs = await restoreTabs([item.url]);

                    if (tabs[0]) {
                        tid = tabs[0].id;
                    } else {
                        // We didn't actually restore anything; just go with the
                        // tabid we already have.
                    }
                }

                // Remove the restored bookmark in the background
                if (item.isBookmark) {
                    browser.bookmarks.remove(item.id).catch(console.log);
                }

                console.assert(tid !== undefined);
                await browser.tabs.move(tid, {
                    windowId: this.id, index: new_model_idx,
                });
                await browser.tabs.show(tid);
            }
        }),
    },
};
</script>

<style>
</style>

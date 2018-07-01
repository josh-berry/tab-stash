<template>
<div :class="{folder: true,
              virtual: ! id,
              'action-container': true,
              collapsed: collapsed}">
  <div class="panel-section-header">
    <div class="header">
      <editable-label classes="folder-name" :value="userTitle"
                      :isDefaultValue="isTitleDefault"
                      :enabled="!! id"
                      @update:value="rename"></editable-label>
      <img :src="`icons/collapse-${collapsed ? 'closed' : 'open'}.svg`"
           :class="{action: true, collapse: true}"
           title="Hide the tabs for this group"
           @click.prevent="collapsed = ! collapsed">
      <nav v-if="id">
        <img src="icons/stash-dark.svg" class="action stash"
             :title="`Stash all open tabs to this group (hold ${altkey} to keep tabs open)`"
             @click.prevent="stash">
        <img src="icons/stash-one-dark.svg" class="action stash"
             :title="`Stash the active tab to this group (hold ${altkey} to keep tab open)`"
             @click.prevent="stashOne">
        <img src="icons/restore.svg" class="action restore"
             title="Open all tabs in this group"
             @click.prevent="restoreAll">
        <img src="icons/restore-del.svg" class="action restore-remove"
             title="Open all tabs in the group and delete the group"
             @click.prevent="restoreAndRemove">
        <img src="icons/delete.svg" class="action remove"
             title="Delete this group"
             @click.prevent="remove">
      </nav>
      <nav v-else>
        <img src="icons/stash-dark.svg" class="action stash"
             :title="`Stash only the unstashed tabs to a new group (hold ${altkey} to keep tabs open)`"
             @click.prevent="stash">
        <img src="icons/new-empty-group.svg" class="action stash"
             title="Create a new empty group"
             @click.prevent="newGroup">
        <img src="icons/delete.svg" class="action remove"
             title="Close all unstashed tabs"
             @click.prevent="remove">
        <img src="icons/delete-opened.svg" class="action remove"
             title="Close all open tabs"
             @click.prevent="removeOpen">
      </nav>
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
    stashTabs, bookmarkTabs, restoreTabs, refocusAwayFromTabs, hideTabs,
} from 'stash';

import Draggable from 'vuedraggable';
import EditableLabel from './editable-label.vue';
import Tab from './tab.vue';

export default {
    components: {Draggable, EditableLabel, Tab},

    props: {
        // Common
        id: [String, Number],
        filter: Function,
        children: Array,
        title: String,

        // Bookmark folder
        dateAdded: Number,

        // Window
        isWindow: Boolean,
    },

    data: () => ({
        collapsed: false,
    }),

    computed: {
        altkey: altKeyName,

        isTitleDefault: function() {
            return getFolderNameISODate(this.title) !== null;
        },
        userTitle: function() {
            return this.isTitleDefault
                ? `Saved ${(new Date(getFolderNameISODate(this.title))).toLocaleString()}`
                : this.title;
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
            if (curtab) await browser.tabs.remove([curtab.id]);
        }),

        remove: asyncEvent(async function() {
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
                // This is the "open-tabs" folder; user has asked us to close
                // all unstashed tabs.  Open a new tab for them and close all
                // the existing ones.
                await refocusAwayFromTabs(this.visibleChildren);
                await browser.tabs.remove(this.visibleChildren.map(t => t.id));
            }
        }),

        removeOpen: asyncEvent(async function() {
            // Closes ALL open tabs (stashed and unstashed).  This is just a
            // convenience button for the "Unstashed Tabs" view.
            console.assert(! this.id);
            let tabs = await browser.tabs.query(
                {currentWindow: true, hidden: false, pinned: false});
            await refocusAwayFromTabs(tabs);
            await browser.tabs.remove(tabs.map(t => t.id));
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
            if (curtab) await browser.tabs.remove([curtab.id]);
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

            } else {
                // Moving from another folder, so this is strictly an insertion.
                // Pick the model index based on neighboring items, assuming
                // that the insertion would have shifted everything else down.
                new_model_idx = ev.newIndex < ev.to.children.length - 1
                    ? ev.to.children[ev.newIndex + 1].__vue__.index
                    : ev.to.children[ev.newIndex - 1].__vue__.index + 1;
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

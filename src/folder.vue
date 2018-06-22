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
      <img src="icons/collapse.svg"
           :class="{action: true, collapse: true, toggled: collapsed}"
           title="Hide the tabs for this group"
           @click.prevent="collapsed = ! collapsed">
      <nav v-if="id">
        <img src="icons/stash-dark.svg" class="action stash"
             title="Stash all open tabs to this group"
             @click.prevent="stash">
        <img src="icons/stash-one-dark.svg" class="action stash"
             title="Stash the active tab to this group"
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
             title="Stash only the unstashed tabs to a new group"
             @click.prevent="stash">
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
    <draggable v-model="children" :data-id="id"
               :options="{group: 'tab'}"
               @add="move" @update="move">
      <tab v-for="item of children" :key="item.id" v-bind="item"></tab>
    </draggable>
  </div>
</div>
</template>

<script>
import {asyncEvent} from './util';
import {
    getFolderNameISODate, genDefaultFolderName,
    stashOpenTabs, stashFrontTab, stashTabs, restoreTabs,
    refocusAwayFromTabs,
} from 'stash';

import Draggable from 'vuedraggable';
import EditableLabel from './editable-label.vue';
import Tab from './tab.vue';

export default {
    components: {Draggable, EditableLabel, Tab},

    props: {
        title: String,
        children: Array,
        id: [String, Number],
        dateAdded: Number,
    },

    data: () => ({
        collapsed: false,
    }),

    computed: {
        isTitleDefault: function() {
            return getFolderNameISODate(this.title) !== null;
        },
        userTitle: function() {
            return this.isTitleDefault
                ? `Saved ${(new Date(getFolderNameISODate(this.title))).toLocaleString()}`
                : this.title;
        },
    },

    methods: {
        stash: asyncEvent(function() {
            if (this.id) {
                return stashOpenTabs(this.id);
            } else {
                return stashTabs(undefined, this.children.map(t => t.tab));
            }
        }),

        stashOne: asyncEvent(function() {
            // Stashing the front tab to the unstashed-tabs group doesn't make
            // sense
            console.assert(this.id);
            return stashFrontTab(this.id);
        }),

        restoreAll: asyncEvent(async function() {
            console.assert(this.id); // Can't restore already-open tabs

            // Figure out which tab WE are.  Do this before opening new tabs,
            // since that will disturb the browser's focus.
            let curtab = await browser.tabs.getCurrent();

            await restoreTabs(this.children.map(item => item.bm.url));

            // If we ourselves are open in a tab (and not the sidebar or a
            // popup), close the tab so the user doesn't have to.
            if (curtab) await browser.tabs.remove([curtab.id]);
        }),

        remove: asyncEvent(async function() {
            if (this.id) {
                await browser.bookmarks.removeTree(this.id);
            } else {
                // This is the "open-tabs" folder; user has asked us to close
                // all unstashed tabs.  Open a new tab for them and close all
                // the existing ones.
                let tabs = this.children.map(t => t.tab);
                await refocusAwayFromTabs(tabs);
                await browser.tabs.remove(tabs.map(t => t.id));
            }
        }),

        removeOpen: asyncEvent(async function() {
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

            await restoreTabs(this.children.map(item => item.bm.url));

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
            // different types of folders, and each needs to be handled
            // differently.
            //
            // Note that because of the way the events are bound, if we are
            // dragging between two folders, move is always triggered only on
            // the destination folder.

            if (ev.to.dataset.id && ev.from.dataset.id) {
                // Moving a stashed tab from one place to another.
                browser.bookmarks.move(ev.item.dataset.bmid, {
                    parentId: ev.to.dataset.id,
                    index: ev.newIndex,
                }).catch(console.log);

            } else if (ev.to.dataset.id) {
                // Stashing a single tab at a specific location.
                let tabs = await stashTabs(
                    ev.to.dataset.id,
                    [await browser.tabs.get(ev.item.dataset.tabid|0)]);

                if (tabs[0].bm) {
                    await browser.bookmarks.move(
                        tabs[0].bm.id, {index: ev.newIndex});
                }

            } else {
                // Placing a tab at a particular location in the open window
                // (and possibly restoring it from the stash if necessary).
                let tid = ev.item.dataset.tabid | 0;

                if (ev.item.dataset.bmid) {
                    // Restoring from the stash.
                    let bm = await browser.bookmarks.get(ev.item.dataset.bmid);
                    let tabs = await restoreTabs([bm[0].url]);

                    if (tabs[0]) {
                        tid = tabs[0].id;
                    } else {
                        // We didn't actually restore anything; just go with the
                        // tabid we already have.
                        console.assert(tid);
                    }

                    // Remove the restored bookmark in the background
                    browser.bookmarks.remove(ev.item.dataset.bmid)
                        .catch(console.log);
                }

                // Now move the tab (whether it was restored or already open) to
                // the right location.  This is slightly harder than it
                // sounds--the browser intersperses hidden and visible tabs, so
                // we have to choose a reasonable index to account for the
                // locations of hidden tabs.

                // The black magic used to set /idx/ takes into account the fact
                // that this.children has /already/ been moved to its new
                // location--so this.children[ev.newIndex] is always the tab we
                // are moving.
                let idx = ev.newIndex > 0
                    ? this.children[ev.newIndex-1].tab.index
                      + (ev.newIndex < ev.oldIndex ? 1 : 0)
                    : this.children[1].tab.index;

                await browser.tabs.move(tid, {index: idx});
                await browser.tabs.show(tid);
            }
        }),
    },
};
</script>

<style>
</style>

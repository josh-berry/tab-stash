<template>
<div class="action-container">
  <div class="panel-section-header">
    <editable-label classes="folder" :value="userTitle"
                    :isDefaultValue="isTitleDefault"
                    @update:value="rename"></editable-label>
    <nav>
      <img src="icons/stash-dark.svg" class="action stash"
           title="Close and save all open tabs to this group"
           @click.prevent="stash">
      <img src="icons/stash-one-dark.svg" class="action stash"
           title="Close and save the active tab to this group"
           @click.prevent="stashOne">
      <img src="icons/restore.svg" class="action restore"
           title="Open all tabs in this group"
           @click.prevent="restoreAll">
      <img src="icons/restore-del.svg" class="action restore-remove"
           title="Open all tabs in the group and delete the group"
           @click.prevent="restoreAndDiscard">
      <img src="icons/delete.svg" class="action remove"
           title="Delete this group"
           @click.prevent="discard">
    </nav>
  </div>
  <div class="panel-section-list">
    <draggable v-model="children" :data-id="id"
               :options="{group: 'saved-tab'}"
               @sort="move">
      <saved-tab v-for="item of children" :key="item.id" v-bind="item"
                 :data-id="item.id">
      </saved-tab>
    </draggable>
  </div>
</div>
</template>

<script>
import {
    asyncEvent,
    getFolderNameISODate, genDefaultFolderName,
    stashOpenTabs, stashFrontTab, restoreTabs,
} from 'stash';

import Draggable from 'vuedraggable';
import EditableLabel from 'editable-label.vue';
import SavedTab from 'saved-tab.vue';

export default {
    components: {Draggable, EditableLabel, SavedTab},

    props: {
        title: String,
        children: Array,
        id: [String, Number],
        dateAdded: Number,
    },

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
            return stashOpenTabs(this.id);
        }),

        stashOne: asyncEvent(function() {
            return stashFrontTab(this.id);
        }),

        restoreAll: asyncEvent(async function() {
            // Figure out which tab WE are.  Do this before opening new tabs,
            // since that will disturb the browser's focus.
            let curtab = await browser.tabs.getCurrent();

            await restoreTabs(this.children.map(tab => tab.url));

            // If we ourselves are open in a tab (and not the sidebar or a
            // popup), close the tab so the user doesn't have to.
            if (curtab) await browser.tabs.remove([curtab.id]);
        }),

        discard: asyncEvent(async function() {
            await browser.bookmarks.removeTree(this.id);
        }),

        restoreAndDiscard: asyncEvent(async function() {
            // Figure out which tab WE are.  Do this before opening new tabs,
            // since that will disturb the browser's focus.
            let curtab = await browser.tabs.getCurrent();

            await restoreTabs(this.children.map(tab => tab.url));

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
            browser.bookmarks.update(this.id, {title}).then(() => {});
        },

        move: function(ev) {
            //console.log('move tab', ev);
            //console.log('item', ev.item.dataset.id);
            //console.log('from', ev.oldIndex, ev.from.dataset.id);
            //console.log('to', ev.newIndex, ev.to.dataset.id);

            browser.bookmarks.move(ev.item.dataset.id, {
                parentId: ev.to.dataset.id,
                index: ev.newIndex,
            }).then(() => {});
        },
    },
};
</script>

<style>
</style>

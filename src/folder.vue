<template>
<div>
  <div class="panel-section-header">
    <editable-label classes="folder" :value="userTitle"
                    :isDefaultValue="isTitleDefault"
                    @update:value="rename"></editable-label>
    <nav>
      <span class="action stash"
            title="Close and save all open tabs to this group"
            @click.prevent="stash">Stash</span>
      <span class="action restore" @click.prevent="restoreAll"
            title="Open all tabs in this group">Restore</span>
      <span class="action restore-remove"
            title="Open all tabs in the group and delete the group"
            @click.prevent="restoreAndDiscard">Restore/Del.</span>
      <span class="action remove" @click.prevent="discard"
            title="Delete this group">Delete</span>
    </nav>
  </div>
  <div class="panel-section-list">
    <saved-tab v-for="item of children" :key="item.id" v-bind="item">
    </saved-tab>
  </div>
</div>
</template>

<script>
import {
    asyncEvent,
    getFolderNameISODate, genDefaultFolderName,
    stashAllTabs, restoreTabs,
} from 'stash';

import EditableLabel from 'editable-label.vue';
import SavedTab from 'saved-tab.vue';

export default {
    components: {EditableLabel, SavedTab},

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
            return stashAllTabs(this.id);
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
    },
};
</script>

<style>
</style>

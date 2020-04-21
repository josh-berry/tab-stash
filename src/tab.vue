<template>
<a :class="{'action-container': true,
            'tab': true,
            'saved': !!bm,
            'open': tab && ! tab.hidden}"
   target="_blank" :href="url" :title="bestTitle"
   @click.prevent.stop="open">
  <img v-if="favIconUrl || (favicon && favicon.value)" class="icon"
       :src="favIconUrl || favicon.value"
       :srcset="(favIconUrl || favicon.value) + ' 2x'"
       referrerpolicy="no-referrer"
       alt="">
  <span class="text">{{bestTitle}}</span>
  <ButtonBox>
    <Button v-if="isBookmark"
            class="restore-remove" @action="openRemove"
            tooltip="Open this tab and delete it from the group" />
    <Button v-else
            class="stash one" @action="stash"
            :tooltip="`Stash this tab (hold ${altkey} to keep tab open)`" />
    <Button class="remove" @action="remove"
            :tooltip="isBookmark ? 'Delete this tab from the group'
                                 : 'Close this tab'" />
  </ButtonBox>
</a>
</template>

<script>
import {asyncEvent, altKeyName, bgKeyPressed} from './util';
import {
    getFolderNameISODate, mostRecentUnnamedFolderId,
    restoreTabs, stashTabs,
    closeTabs,
} from './stash';
import ButtonBox from './components/button-box.vue';
import Button from './components/button.vue';

export default {
    components: {ButtonBox, Button},

    props: {
        // Common
        id: [String, Number],
        parent: Object,
        index: Number,
        title: String,
        url: String,
        favicon: Object,
        related: Array,

        // Tabs only
        isTab: Boolean,
        hidden: Boolean,
        pinned: Boolean,
        active: Boolean,
        favIconUrl: String,

        // Bookmarks only
        isBookmark: Boolean,
    },

    computed: {
        altkey: altKeyName,

        tab: function() {
            if (this.isTab) return this;
            return this.related.find(t => t.isTab);
        },

        bm: function() {
            if (this.isBookmark) return this;
            return this.related.find(t => t.isBookmark);
        },

        bestTitle: function() {
            if (this.tab && this.tab.title) return this.tab.title;
            return this.bm.title;
        },
    },

    methods: {
        stash: asyncEvent(async function(ev) {
            console.assert(this.tab);
            await stashTabs([this.tab], {
                folderId: await mostRecentUnnamedFolderId(),
                close: ! ev.altKey,
            });
        }),

        open: asyncEvent(async function(ev) {
            const curtab = await browser.tabs.getCurrent();
            const bg = bgKeyPressed(ev);

            await restoreTabs([this.url], {background: bg});
        }),

        remove: asyncEvent(async function() {
            let tab = this.tab;
            if (this.isBookmark) {
                if (tab && tab.hidden) {
                    // So we don't momentarily put this tab into "Unstashed
                    // Tabs" after it's removed and before the garbage collector
                    // gets to it.
                    await browser.tabs.remove(tab.id);
                }
                await this._removeBM();

            } else {
                // This is an unstashed open tab.  Just close it.
                await closeTabs([tab]);
            }
        }),

        openRemove: asyncEvent(async function(ev) {
            const curtab = await browser.tabs.getCurrent();
            const bg = bgKeyPressed(ev);

            await restoreTabs([this.url], {background: bg});
            if (this.isBookmark) {
                await this._removeBM();
            }
            // If this is just a tab and not a bookmark, we don't remove the
            // tab, since openRemove indicates the user wanted to switch to the
            // tab.
        }),

        _removeBM: async function(ev) {
            const folder = this.parent;

            await browser.bookmarks.remove(this.id);

            // If we are the only thing in our parent folder, AND the parent
            // folder has a "default" name, remove the parent folder, so we
            // don't leave any empty unnamed stashes lying around.
            //
            // XXX this logic is mirrored (ish) in
            // folder.vue:_maybeCleanupEmptyFolder().  See the comment there for
            // further discussion.

            if (getFolderNameISODate(folder.title) === null) return;

            if (folder.children.length > 1) return;
            if (folder.children.length === 1
                && folder.children[0].id !== this.id) {
                return;
            }

            await browser.bookmarks.remove(folder.id);
        },
    },
};
</script>

<style>
</style>

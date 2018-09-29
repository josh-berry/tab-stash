<template>
<a :class="{'panel-list-item': true,
            'action-container': true,
            'tab': true,
            'saved': !!bm,
            'open': tab && ! tab.hidden}"
   target="_blank" :href="url" :title="bestTitle"
   @click.prevent.stop="open">
  <img v-if="favicon" class="icon"
       :src="favicon" :srcset="favicon ? favicon + ' 2x' : ''"
       referrerpolicy="no-referrer"
       alt="">
  <span class="text">{{bestTitle}}</span>
  <ButtonBox>
    <img v-if="isBookmark" src="icons/restore-del.svg"
         class="action restore-remove"
         title="Open this tab and delete it from the group"
         @click.prevent.stop="openRemove">
    <img v-else src="icons/stash-one-dark.svg" class="action stash one"
         :title="`Stash this tab (hold ${altkey} to keep tab open)`"
         @click.prevent.stop="stash">
    <img src="icons/delete.svg" class="action remove"
         :title="isBookmark ? 'Delete this tab from the group'
                            : 'Close this tab'"
         @click.prevent.stop="remove">
  </ButtonBox>
</a>
</template>

<script>
import {asyncEvent, altKeyName, bgKeyPressed} from './util';
import {
    mostRecentUnnamedFolderId, restoreTabs, stashTabs, bookmarkTabs,
    closeTabs,
} from './stash';
import ButtonBox from 'button-box.vue';

export default {
    components: {ButtonBox},

    props: {
        // Common
        id: [String, Number],
        parent: Object,
        index: Number,
        title: String,
        url: String,
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

        favicon: function() {
            try {
                // See if we have an open tab and a favicon URL we can use.
                if (this.tab && this.tab.favIconUrl) return this.tab.favIconUrl;

                // Fallback to Google if we can't pull a favicon URL from an
                // open tab.
                //
                // XXX use firefox internal for this if possible... not super
                // happy hitting Google for favicons since it leaks info about
                // what domains are in use :/
                let url = new URL(this.url);

                // Blacklist a bunch of things Google will have no idea about
                if (! url.host) return '';
                if (url.host.startsWith('127.')) return '';
                if (url.host.startsWith('192.168.')) return '';
                if (url.host.startsWith('10.')) return '';
                if (url.host.startsWith('172.16.')) return '';
                if (url.hostname === 'localhost') return '';
                if (url.hostname.endsWith('.local')) return '';

                return `https://www.google.com/s2/favicons?domain=${url.host}`;
            } catch (e) {
                console.warn("Failed to parse URL: ", this.url, e);
            }
            return '';
        },
    },

    methods: {
        stash: asyncEvent(async function(ev) {
            console.assert(this.tab);
            if (ev.altKey) {
                await bookmarkTabs(await mostRecentUnnamedFolderId(),
                                   [this.tab]);
            } else {
                await stashTabs(await mostRecentUnnamedFolderId(), [this.tab]);
            }
        }),

        open: asyncEvent(async function(ev) {
            let curtab = await browser.tabs.getCurrent();

            await restoreTabs([this.url], {background: bgKeyPressed(ev)});

            if (curtab && ! curtab.pinned) {
                await browser.tabs.remove([curtab.id]);
            }
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
                await browser.bookmarks.remove(this.id);

            } else {
                // This is an unstashed open tab.  Just close it.
                await closeTabs([tab]);
            }
        }),

        openRemove: asyncEvent(async function(ev) {
            let curtab = await browser.tabs.getCurrent();

            await restoreTabs([this.url], {background: bgKeyPressed(ev)});
            if (this.isBookmark) {
                await browser.bookmarks.remove(this.id);
            }
            // If this is just a tab and not a bookmark, we don't remove the
            // tab, since openRemove indicates the user wanted to switch to the
            // tab.

            if (curtab && ! curtab.pinned) {
                await browser.tabs.remove([curtab.id]);
            }
        }),
    },
};
</script>

<style>
</style>

<template>
<a :class="{'panel-list-item': true,
            'action-container': true,
            'tab': true,
            'saved': !!bm,
            'open': tab && ! tab.hidden}"
   target="_blank" :href="url" :title="title"
   :data-bmid="bm && bm.id" :data-tabid="tab && tab.id"
   @click.prevent="open">
  <img class="icon" :src="favicon" v-if="favicon">
  <span class="text">{{title}}</span>
  <img src="icons/delete.svg" class="action remove"
       :title="bm ? 'Delete this tab from the group' : 'Close this tab'"
       @click.prevent.stop="remove">
  <img v-if="bm" src="icons/restore-del.svg" class="action restore-remove"
       title="Open this tab and delete it from the group"
       @click.prevent.stop="openRemove">
  <img v-else src="icons/stash-one-dark.svg" class="action stash"
       title="Stash this tab"
       @click.prevent.stop="stash">
</a>
</template>

<script>
import {asyncEvent} from './util';
import {
    mostRecentUnnamedFolder, restoreTabs, stashTabs,
    refocusAwayFromTabs,
} from './stash';

export default {
    props: {
        id: [String, Number],
        tab: Object,
        bm: Object,
    },

    computed: {
        title: function() {
            if (this.tab) return this.tab.title;
            return this.bm.title;
        },

        url: function() {
            if (this.tab) return this.tab.url;
            return this.bm.url;
        },

        favicon: function() {
            try {
                // See if we have an open tab and a favicon URL we can use.
                if (this.tab && this.tab.favIconUrl) {
                    return this.tab.favIconUrl;
                }

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
        stash: asyncEvent(async function() {
            console.assert(! this.bm);
            await stashTabs(await mostRecentUnnamedFolder(), [this.tab]);
        }),
        open: asyncEvent(async function() {
            await restoreTabs([this.url]);
        }),
        remove: asyncEvent(async function() {
            if (this.bm) {
                await browser.bookmarks.remove(this.bm.id);
            } else {
                await refocusAwayFromTabs([this.tab]);
                await browser.tabs.remove(this.tab.id);
            }
        }),
        openRemove: asyncEvent(async function() {
            await restoreTabs([this.url]);
            if (this.bm) {
                await browser.bookmarks.remove(this.bm.id);
            }
            // If this is just a tab and not a bookmark, we don't remove the
            // tab, since openRemove indicates the user wanted to switch to the
            // tab.
        }),
    },
};
</script>

<style>
</style>

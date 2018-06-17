<template>
<a class="panel-list-item saved-tab action-container"
   target="_blank" :href="url" :title="title"
   @click.prevent="open">
  <img class="icon" :src="favicon" v-if="favicon">
  <span class="text">{{title}}</span>
  <img src="icons/delete.svg" class="action remove"
       title="Delete this tab from the group"
       @click.prevent.stop="remove">
  <img src="icons/restore-del.svg" class="action restore-remove"
       title="Open this tab and delete it from the group"
       @click.prevent.stop="openRemove">
</a>
</template>

<script>
import {
    asyncEvent,
    restoreTabs,
} from 'stash';

export default {
    props: {
        title: String,
        url: String,
        id: [String, Number],
        dateAdded: Number,
    },

    computed: {
        favicon: function() {
            try {
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
        }
    },

    methods: {
        open: asyncEvent(async function() {
            await restoreTabs([this.url]);
        }),
        remove: asyncEvent(async function() {
            await browser.bookmarks.remove(this.id);
        }),
        openRemove: asyncEvent(async function() {
            await restoreTabs([this.url]);
            await browser.bookmarks.remove(this.id);
        }),
    },
};
</script>

<style>
</style>

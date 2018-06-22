<template>
<a :class="{'panel-list-item': true,
            'action-container': true,
            'tab': true,
            'open': tab && ! tab.hidden}"
   target="_blank" :href="url" :title="tabTitle"
   @click.prevent="open">
  <img class="icon" :src="favicon" v-if="favicon">
  <span class="text">{{tabTitle}}</span>
  <img src="icons/delete.svg" class="action remove"
       title="Delete this tab from the group"
       @click.prevent.stop="remove">
  <img src="icons/restore-del.svg" class="action restore-remove"
       title="Open this tab and delete it from the group"
       @click.prevent.stop="openRemove">
</a>
</template>

<script>
import {asyncEvent} from './util';
import {restoreTabs} from './stash';

export default {
    props: {
        title: String,
        url: String,
        id: [String, Number],
        dateAdded: Number,
        tab: Object,
    },

    computed: {
        tabTitle: function() {
            if (this.tab && this.tab.title) return this.tab.title;
            return this.title;
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

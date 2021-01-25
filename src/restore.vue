<template>
<main>
    <aside class="notification-overlay">
        <Notification v-if="copied">Copied</Notification>
    </aside>

    <div class="icon-warning" />

    <h2 v-if="protocol === 'file:'">Restoring a Local File</h2>
    <h2 v-else>Suspicious Stashed Tab</h2>

    <p v-if="protocol === 'file:'">For security reasons, your browser won't
    allow Tab Stash to restore tabs that show files on your computer without
    your intervention.</p>

    <p v-else>For security reasons, your browser won't allow Tab Stash to
    restore privileged tabs without your intervention.</p>

    <p><strong>Please make sure this URL looks right.</strong> If it looks okay,
    you can restore the tab by copying and pasting the URL into the address
    bar:</p>

    <a ref="url" class="unsafe-url" :href="url" @click.prevent.stop="copy">{{url}}</a>
</main>
</template>

<script lang="ts">
import Vue from 'vue'

import launch from './launch-vue';

const Main = Vue.extend({
    components: {
        Notification: require('./components/notification.vue').default,
    },

    props: {
        url: String,
    },

    data: () => ({
        copied: false,
    }),

    computed: {
        protocol(): string {
            try {
                return new URL(this.url).protocol;
            } catch (e) { return ''; }
        },
    },

    methods: {
        copy() {
            const r = document.createRange();
            r.selectNodeContents(<Element>this.$refs.url);
            window.getSelection()!.removeAllRanges();
            window.getSelection()!.addRange(r);
            document.execCommand('copy');
            window.getSelection()!.removeAllRanges();

            this.copied = true;
            setTimeout(() => { this.copied = false; }, 3000);
        }
    },
});

export default Main;

launch(Main, async() => {
    const myurl = new URL(document.location.href);

    const url = myurl.searchParams.get('url');
    if (url) document.title = url;

    return {
        propsData: { url },
    };
});
</script>

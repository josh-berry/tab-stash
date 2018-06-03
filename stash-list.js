"use strict";

// GUI stuff.  Depends on both Vue and index.js already being loaded.

window.addEventListener('load', () => {
    renderStashedTabs().then((tabs) => {
        let vue = new Vue({
            template: `
              <folder-list :folders="folders">
              </folder-list>`,

            data: {folders: tabs},
        });
        vue.$mount('#app');

        let update = () => {
            // XXX Probably very inefficient to regenerate the whole tree on
            // every update, but this is OK for now...
            renderStashedTabs().then((tabs) => {
                vue.folders = tabs;
            });
        };

        browser.bookmarks.onChanged.addListener(update);
        //browser.bookmarks.onChildrenReordered.addListener(update);
        browser.bookmarks.onCreated.addListener(update);
        //browser.bookmarks.onImportEnded.addListener(update);
        browser.bookmarks.onMoved.addListener(update);
        browser.bookmarks.onRemoved.addListener(update);
    });
});

async function renderStashedTabs() {
    let root = (await browser.bookmarks.search({title: STASH_FOLDER}))[0];
    if (! root) return [];

    let [tree] = await browser.bookmarks.getSubTree(root.id);

    return tree.children
        .filter((c) => c.type === 'folder')
        .map((c) => ({
            id: c.id,
            title: c.title,
            children: c.children
                .filter((l) => l.type !== 'folder')
                .map((l) => ({
                    id: l.id,
                    title: l.title,
                    url: l.url,
                })),
        }));
}

Vue.component('folder-list', {
    props: {folders: Array},
    data: () => ({}),
    computed: {},
    template: `
        <div>
          <div v-for="f in folders" :key="f.title">
            <folder v-bind="f"></folder>
          </div>
        </div>
    `,
    methods: {},
});

Vue.component('folder', {
    props: {
        title: String,
        children: Array,
        id: [String, Number],
    },

    computed: {},

    template: `
        <div>
          <div class="panel-section-header">
            <editable-label classes="folder" :value="title"
                            @update:value="rename"></editable-label>
            <nav>
              <a @click.prevent="restoreAll" title="Restore All">R</a>
              <a @click.prevent="restoreAndDiscard" title="Restore and Discard">RD</a>
              <a @click.prevent="discard" title="Discard">D</a>
            </nav>
          </div>
        <div class="panel-section-list">
          <saved-tab v-for="item of children" :key="item.id" v-bind="item">
          </saved-tab>
        </div>
        </div>`,

    methods: {
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

        rename: function(title, resolve) {
            browser.bookmarks.update(this.id, {title})
                .then(resolve);
        },
    },
});

Vue.component('saved-tab', {
    props: {title: String, url: String, id: [String, Number]},

    template: `
        <div class="panel-list-item" @click.prevent="open">
          <a target="_blank" :href="url">
            <img class="icon" :src="favicon" v-if="favicon">
            <span class="text">{{title}}</span>
          </a>
        </div>`,

    computed: {
        favicon: function() {
            try {
                // XXX use firefox internal for this if possible... not super
                // happy hitting Google for favicons since it leaks info about
                // what domains are in use :/
                let url = new URL(this.url);
                if (url.host) return `https://www.google.com/s2/favicons?domain=${url.host}`;
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
    },
});

Vue.component('editable-label', {
    props: {classes: [Object, String], value: String},
    data: () => ({editing: false}),
    computed: {},
    template: `
      <input v-if="editing" type="text" :class="classes" :value="value"
             ref="input"
             @blur="commit" @keyup.enter.prevent="commit"
             @keyup.esc.prevent="editing = false">
      <span v-else :class="classes" @click="editing = true">{{value}}</span>
    `,
    updated: function() {
        if (this.$refs.input) this.$refs.input.focus();
    },
    methods: {
        commit: function() {
            if (this.$refs.input.value === this.value) {
                this.editing = false;
                return;
            }
            this.$emit('update:value', this.$refs.input.value,
                       () => {this.editing = false});
        },
    },
});

async function restoreTabs(urls) {
    // Remove duplicate URLs so we only try to restore each URL once.
    urls = Array.from(new Set(urls));

    // See which tabs are already open and remove them from the list
    let open = await browser.tabs.query({currentWindow: true, url: urls});
    urls = urls.filter(url => ! open.some(tab => tab.url === url));

    // For each URL that we're going to restore, figure out how--are we
    // restoring by reopening a closed tab, or by creating a new tab?
    let sessions = await browser.sessions.getRecentlyClosed();
    let strategies = urls.map(url => [
        url, sessions.find(sess => sess.tab && sess.tab.url === url)]);

    // Now restore tabs.  Done serially so we always restore in the same
    // positions.
    let ps = [];
    for (let [url, sess] of strategies) {
        console.log('restoring', url, sess);
        let p = sess
            ? browser.sessions.restore(sess.tab.sessionId).then(
                sess => browser.tabs.move([sess.tab.id], {index: 0xffffff}))
            : browser.tabs.create({active: false, url, index: 0xffffff});
        ps.push(p);
    }

    for (let p of ps) await p;
}

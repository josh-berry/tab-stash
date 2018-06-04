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
            dateAdded: c.dateAdded,
            children: c.children
                .filter((l) => l.type !== 'folder')
                .map((l) => ({
                    id: l.id,
                    title: l.title,
                    dateAdded: l.dateAdded,
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
        dateAdded: Number,
    },

    computed: {
        isTitleDefault: function() {
            return getFolderNameISODate(this.title);
        },
        userTitle: function() {
            return this.isTitleDefault
                ? `Saved ${(new Date(this.isTitleDefault)).toLocaleString()}`
                : this.title;
        },
    },

    template: `
        <div>
          <div class="panel-section-header">
            <editable-label classes="folder" :value="userTitle"
                            :isDefaultValue="isTitleDefault"
                            @update:value="rename"></editable-label>
            <nav>
              <span class="action restore" @click.prevent="restoreAll"
                    title="Restore All">R</span>
              <span class="action restore-remove"
                    @click.prevent="restoreAndDiscard"
                    title="Restore and Discard">RD</span>
              <span class="action remove" @click.prevent="discard"
                    title="Discard">D</span>
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
            if (title === '') {
                // Give it a default name based on when the folder was created
                title = genDefaultFolderName(new Date(this.dateAdded));
            }
            browser.bookmarks.update(this.id, {title})
                .then(resolve);
        },
    },
});

Vue.component('saved-tab', {
    props: {
        title: String,
        url: String,
        id: [String, Number],
        dateAdded: Number,
    },

    template: `
        <a class="panel-list-item saved-tab"
           target="_blank" :href="url"
           @click.prevent="open">
          <img class="icon" :src="favicon" v-if="favicon">
          <span class="text">{{title}}</span>
          <span class="action remove" @click.prevent.stop="remove">X</span>
        </a>`,

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
    },
});

Vue.component('editable-label', {
    props: {classes: [Object, String], value: String, isDefaultValue: Boolean},
    data: () => ({editing: false}),
    computed: {},
    template: `
      <input v-if="editing" type="text" :class="classes"
             :value="isDefaultValue ? '' : value"
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

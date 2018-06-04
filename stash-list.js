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
            return getFolderNameISODate(this.title) !== null;
        },
        userTitle: function() {
            return this.isTitleDefault
                ? `Saved ${(new Date(getFolderNameISODate(this.title))).toLocaleString()}`
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
              <span class="action stash"
                    title="Save all open tabs to this group and close them"
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
        </div>`,

    methods: {
        stash: asyncEvent(async function() {
            // Very similar to the browser action, sans showing the stashed-tabs
            // view, which the user is already looking at.
            let saved_tabs = await bookmarkOpenTabs(this.id);
            await hideAndDiscardTabs(saved_tabs);
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
          <span class="action remove"
                title="Delete this tab from the group"
                @click.prevent.stop="remove">X</span>
          <span class="action restore-remove"
                title="Open this tab and delete it from the group"
                @click.prevent.stop="openRemove">&raquo;</span>
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
        openRemove: asyncEvent(async function() {
            await restoreTabs([this.url]);
            await browser.bookmarks.remove(this.id);
        }),
    },
});

Vue.component('editable-label', {
    props: {
        // CSS classes to apply to the editable label, which is either a <span>
        // or <input> element.
        classes: [Object, String],

        // The value to show
        value: String,

        // If true, we show the user an empty text box instead of whatever is in
        // /value/.
        isDefaultValue: Boolean,
    },

    data: () => ({
        editing: false,
        oldValue: undefined,
        newValue: undefined,
    }),

    computed: {
        editValue: function() {
            // The value to populate in the text box.  (If the user has
            // specified a value already, we just use that.)
            if (this.newValue !== undefined) return this.newValue;
            if (this.isDefaultValue) return '';
            return this.value;
        },

        disabled: function() {
            // We disable the text box if we're in the middle of an update
            // operation...
            return this.oldValue !== undefined
                // ...and we haven't seen a change in the model yet.
                && this.value === this.oldValue;
        }
    },

    template: `
      <input v-if="editing" type="text" :class="classes"
             :value="editValue" :disabled="disabled"
             ref="input"
             @blur="commit" @keyup.enter.prevent="commit"
             @keyup.esc.prevent="editing = false">
      <span v-else :class="classes" @click="begin">{{value}}</span>
    `,

    updated: function() {
        // If we are just now showing the text box, make sure it's focused so
        // the user can start typing.
        if (this.$refs.input && ! this.disabled) this.$refs.input.focus();

        // All of this convoluted logic is to prevent the user from seeing a
        // momentary switch back to the "old" value before the model has
        // actually been updated.  Basically we save and show the user the new
        // value they entered (/newValue/), but with the text box disabled,
        // until we see SOME change to the actual model value (regardless of
        // what it is).
        //
        // At that point, we discard the old and new values and use whatever the
        // model provides, resetting our state to "not editing".
        if (this.editing
            && this.oldValue !== undefined
            && this.oldValue !== this.value)
        {
            this.editing = false;
            this.oldValue = undefined;
            this.newValue = undefined;
        }
    },
    methods: {
        begin: function() {
            this.editing = true;
        },
        commit: function() {
            if (this.$refs.input.value === this.editValue) {
                this.editing = false;
                return;
            }

            // This convoluted logic saves the old value (so we know when the
            // model has been changed), and the new value (so we can continue to
            // display it to the user), and then disables the text box and fires
            // the event.  At some time later, we expect something to magically
            // update the model, and the logic in "upddated" above will kick in
            // and move us back to not-editing state.
            //
            // If that doesn't happen, it probably means the user 
            this.oldValue = this.value;
            this.newValue = this.$refs.input.value;
            this.$emit('update:value', this.newValue);
        },
    },
});

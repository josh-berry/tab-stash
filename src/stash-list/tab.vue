<template>
<a :class="{'action-container': true,
            'tab': true,
            'saved': !!bm,
            'open': tab && ! tab.hidden}"
   target="_blank" :href="url" :title="bestTitle"
   @click.prevent.stop="open">
  <ItemIcon v-if="favIconUrl || (favicon && favicon.value)"
       :src="favIconUrl || favicon.value" />
  <span class="text">{{bestTitle}}</span>
  <ButtonBox>
    <Button v-if="isBookmark"
            class="restore-remove" @action="openRemove"
            :tooltip="`Open this tab and delete it from the group `
                    + `(hold ${bgKey} to open in background)`" />
    <Button v-else
            class="stash one" @action="stash"
            :tooltip="`Stash this tab (hold ${altkey} to keep tab open)`" />
    <Button class="remove" @action="remove"
            :tooltip="isBookmark ? 'Delete this tab from the group'
                                 : 'Close this tab'" />
  </ButtonBox>
</a>
</template>

<script lang="ts">
import Vue, {PropType} from 'vue';

import {asyncEvent, altKeyName, bgKeyName, bgKeyPressed} from '../util';
import {
    getFolderNameISODate, mostRecentUnnamedFolderId,
    restoreTabs, stashTabs,
    closeTabs,
} from '../stash';
import {Model} from '../model';
import {Tab, Bookmark, ModelLeaf, ModelParent} from '../model/browser';

export default Vue.extend({
    components: {
        Button: require('../components/button.vue').default,
        ButtonBox: require('../components/button-box.vue').default,
        ItemIcon: require('../components/item-icon').default,
    },

    inject: ['$model'],

    props: {
        // Common
        id: [String, Number],
        parent: Object as PropType<ModelParent>,
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
        bgKey: bgKeyName,

        tab(this: any): Tab | undefined {
            if (this.isTab) return this;
            return this.related.find((t: ModelLeaf) => t.isTab);
        },

        bm(this: any): Bookmark | undefined {
            if (this.isBookmark) return this;
            return this.related.find((t: ModelLeaf) => t.isBookmark);
        },

        bestTitle(this: any): string {
            if (this.tab && this.tab.title) return this.tab.title;
            return this.bm.title;
        },
    },

    methods: {
        // TODO make Vue injection play nice with TypeScript typing...
        model() { return (<any>this).$model as Model; },

        stash: asyncEvent(async function(this: any, ev) {
            console.assert(this.tab);
            await stashTabs([this.tab], {
                folderId: await mostRecentUnnamedFolderId(),
                close: ! ev.altKey,
            });
        }),

        open: asyncEvent(async function(this: any, ev) {
            const bg = bgKeyPressed(ev);

            if (this.isTab) {
                // Switch to the specific tab the user selected (not done using
                // restoreTabs() since this might pick a different tab if there
                // are duplicates).
                await browser.tabs.update(this.id, {active: true});
            } else {
                await restoreTabs([this.url], {background: bg});
            }
        }),

        remove: asyncEvent(async function(this: any) {
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

        openRemove: asyncEvent(async function(this: any, ev) {
            const bg = bgKeyPressed(ev);

            if (this.isBookmark) {
                await restoreTabs([this.url], {background: bg});
                await this._removeBM();
            } else {
                // The UI shouldn't let us openRemove a tab, but just in case...
                await browser.tabs.update(this.id, {active: true});
            }
        }),

        _removeBM: async function() {
            const folder = this.parent as Bookmark;

            await this.model().deleted_items.add({
                title: this.title,
                url: this.url,
                favIconUrl: this.favicon?.value,
            }, {
                folder_id: folder.id,
                title: folder.title!,
            });
            await browser.bookmarks.remove(this.id as string);

            // If we are the only thing in our parent folder, AND the parent
            // folder has a "default" name, remove the parent folder, so we
            // don't leave any empty unnamed stashes lying around.
            //
            // XXX this logic is mirrored (ish) in
            // folder.vue:_maybeCleanupEmptyFolder().  See the comment there for
            // further discussion.

            if (getFolderNameISODate(folder.title!) === null) return;

            if (folder.children!.length > 1) return;
            if (folder.children?.length === 1
                && folder.children![0]?.id !== this.id) {
                return;
            }

            await browser.bookmarks.remove(folder.id);
        },
    },
});
</script>

<style>
</style>

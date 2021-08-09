<template>
<a :class="{'action-container': true,
            'tab': true, // TODO fix the CSS classes...
            'saved': true,
            'open': hasOpenTab,
            'active': hasActiveTab,
            'selected': bookmark.$selected}"
   target="_blank" :href="bookmark.url" :title="bookmark.title"
   draggable="false" :data-id="bookmark.id"
   @click.prevent.stop="open">
  <item-icon class="action"
             :src="! bookmark.$selected ? favicon?.value?.favIconUrl : ''"
             :default-class="{'icon-tab': ! bookmark.$selected,
                              'icon-tab-selected': bookmark.$selected}"
             @click.prevent.stop="select" />
  <span class="text">{{bookmark.title}}</span>
  <ButtonBox>
    <Button class="restore-remove" @action="openRemove"
            :tooltip="`Open this tab and delete it from the group `
                    + `(hold ${bgKey} to open in background)`" />
    <Button class="remove" @action="remove"
            tooltip="Delete this tab from the group" />
  </ButtonBox>
</a>
</template>

<script lang="ts">
import {PropType, defineComponent} from 'vue';

import {altKeyName, bgKeyName, bgKeyPressed, required, logErrors} from '../util';
import {Model} from '../model';
import {Tab} from '../model/tabs';
import {Bookmark} from '../model/bookmarks';
import {FaviconEntry} from '../model/favicons';

export default defineComponent({
    components: {
        Button: require('../components/button.vue').default,
        ButtonBox: require('../components/button-box.vue').default,
        ItemIcon: require('../components/item-icon').default,
    },

    inject: ['$model'],

    props: {
        bookmark: required(Object as PropType<Bookmark>),
    },

    computed: {
        altkey: altKeyName,
        bgKey: bgKeyName,

        currentWindow(): number | undefined {
            return this.model().tabs.current_window;
        },

        related_tabs(): Tab[] {
            if (! this.bookmark.url) return [];
            const related = this.model().tabs.tabsWithURL(this.bookmark.url);
            return Array.from(related);
        },

        hasOpenTab(): boolean {
            return !! this.related_tabs.find(
                t => ! t.hidden && t.windowId === this.currentWindow);
        },
        hasActiveTab(): boolean {
            // TODO look only at the current window
            return !! this.related_tabs.find(
                t => t.active && t.windowId === this.currentWindow);
        },

        favicon(): FaviconEntry | null {
            if (! this.bookmark.url) return null;
            return this.model().favicons.get(this.bookmark.url);
        },
    },

    methods: {
        // TODO make Vue injection play nice with TypeScript typing...
        model() { return (<any>this).$model as Model; },

        select(ev: MouseEvent) { logErrors(async () => {
            await this.model().selection.toggleSelectFromEvent(
                ev, this.model().bookmarks, this.bookmark);
        })},

        open(ev: MouseEvent) { logErrors(async () => {
            if (! this.bookmark.url) return;
            const bg = bgKeyPressed(ev);

            await this.model().restoreTabs([this.bookmark.url], {background: bg});
        })},

        remove() { logErrors(async () => {
            await this.model().deleteBookmark(this.bookmark);
        })},

        openRemove(ev: MouseEvent) { logErrors(async () => {
            if (! this.bookmark.url) return;
            const bg = bgKeyPressed(ev);
            await this.model().restoreTabs([this.bookmark.url], {background: bg});
            await this.model().deleteBookmark(this.bookmark);
        })},
    },
});
</script>

<style>
</style>

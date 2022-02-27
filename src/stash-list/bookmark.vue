<template>
<div :class="{'action-container': true,
              'tab': true, // TODO fix the CSS classes...
              'saved': true,
              'open': hasOpenTab,
              'active': hasActiveTab,
              'selected': bookmark.$selected}"
     :title="bookmark.title" :data-id="bookmark.id"
     @click.prevent.stop="select">
  <item-icon class="action select"
             :src="! bookmark.$selected ? favicon?.value?.favIconUrl : ''"
             :default-class="{'icon-tab': ! bookmark.$selected,
                              'icon-tab-selected-inverse': bookmark.$selected}"
             @click.prevent.stop="select" />
  <a class="text" :href="bookmark.url" target="_blank" draggable="false" ref="link"
     @click.left.prevent.stop="open"
     @auxclick.middle.exact.prevent.stop="closeOrHideOrOpen">
     {{bookmark.title}}
  </a>
  <ButtonBox>
    <Button class="restore-remove" @action="openRemove"
            :tooltip="`Open this tab and delete it from the group `
                    + `(hold ${bgKey} to open in background)`" />
    <Button class="remove" @action="remove"
            tooltip="Delete this tab from the group" />
  </ButtonBox>
</div>
</template>

<script lang="ts">
import {PropType, defineComponent} from 'vue';

import {altKeyName, bgKeyName, bgKeyPressed, required} from '../util';
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

        targetWindow(): number | undefined {
            return this.model().tabs.targetWindow.value;
        },

        related_tabs(): Tab[] {
            if (! this.bookmark.url) return [];
            const related = this.model().tabs.tabsWithURL(this.bookmark.url);
            return Array.from(related);
        },

        hasOpenTab(): boolean {
            return !! this.related_tabs.find(
                t => ! t.hidden && t.windowId === this.targetWindow);
        },
        hasActiveTab(): boolean {
            // TODO look only at the current window
            return !! this.related_tabs.find(
                t => t.active && t.windowId === this.targetWindow);
        },

        favicon(): FaviconEntry | null {
            if (! this.bookmark.url) return null;
            return this.model().favicons.get(this.bookmark.url);
        },
    },

    methods: {
        // TODO make Vue injection play nice with TypeScript typing...
        model() { return (<any>this).$model as Model; },

        select(ev: MouseEvent) { this.model().attempt(async () => {
            await this.model().selection.toggleSelectFromEvent(
                ev, this.model().bookmarks, this.bookmark);
        })},

        open(ev: MouseEvent) { this.model().attempt(async () => {
            (<HTMLElement>this.$refs.a).blur();
            if (this.model().selection.selectedCount.value > 0) {
                this.select(ev);
                return;
            }

            if (! this.bookmark.url) return;
            const bg = bgKeyPressed(ev);

            await this.model().restoreTabs([this.bookmark.url], {background: bg});
        })},

        remove() { this.model().attempt(async () => {
            await this.model().deleteBookmark(this.bookmark);
        })},

        closeOrHideOrOpen(ev: MouseEvent) { this.model().attempt(async () => {
            const openTabs = this.related_tabs
                .filter((t) => ! t.hidden && t.windowId === this.targetWindow)
                .map((t) => t.id);

            // Remove keyboard focus after a middle click, otherwise focus will
            // remain within the element and it will appear to be highlighted.
            (<HTMLAnchorElement>this.$refs.link).blur();

            // If bookmark has no open tabs, open a new one in the background.
            if (openTabs.length < 1) {
                if (! this.bookmark.url) return;
                return await this.model().restoreTabs(
                    [this.bookmark.url], { background: true });
            }

            // Otherwise hide or close open tabs related to this bookmark.
            await this.model().hideOrCloseStashedTabs(openTabs);
        })},

        openRemove(ev: MouseEvent) { this.model().attempt(async () => {
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

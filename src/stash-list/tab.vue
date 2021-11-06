<template>
<div :class="{'action-container': true,
              'tab': true,
              'open': ! tab.hidden,
              'active': !!tab.active,
              'selected': tab.$selected}"
     :title="tab.title" :data-id="tab.id"
     @click.prevent.stop="select">
  <item-icon class="action select"
             :src="! tab.$selected ? tab.favIconUrl : ''"
             :default-class="{'icon-tab': ! tab.$selected,
                              'icon-tab-selected-inverse': tab.$selected}"
             @click.prevent.stop="select" />
  <a class="text" :href="tab.url" target="_blank" draggable="false" ref="a"
     @click.prevent.stop="open">{{tab.title}}</a>
  <ButtonBox>
    <Button class="stash one" @action="stash"
            :tooltip="`Stash this tab (hold ${altKey} to keep tab open)`" />
    <Button class="remove" @action="remove" tooltip="Close this tab" />
  </ButtonBox>
</div>
</template>

<script lang="ts">
import {PropType, defineComponent} from 'vue';
import browser from 'webextension-polyfill';

import {altKeyName, bgKeyName, required, logErrors} from '../util';
import {Model} from '../model';
import {Tab} from '../model/tabs';

export default defineComponent({
    components: {
        Button: require('../components/button.vue').default,
        ButtonBox: require('../components/button-box.vue').default,
        ItemIcon: require('../components/item-icon').default,
    },

    inject: ['$model'],

    props: {
        tab: required(Object as PropType<Tab>),
    },

    computed: {
        altKey: altKeyName,
        bgKey: bgKeyName,
        currentWindow(): number | undefined {
            return this.model().tabs.current_window;
        },
        isActive(): boolean {
            return this.tab.active && this.tab.windowId === this.currentWindow;
        },
    },

    methods: {
        // TODO make Vue injection play nice with TypeScript typing...
        model() { return (<any>this).$model as Model; },

        select(ev: MouseEvent) { logErrors(async () => {
            await this.model().selection.toggleSelectFromEvent(
                ev, this.model().tabs, this.tab);
        })},

        stash(ev: MouseEvent) { logErrors(async () => {
            await this.model().stashTabs([this.tab], {
                folderId: this.model().mostRecentUnnamedFolder()?.id,
                close: ! ev.altKey,
            });
        })},

        open(ev: MouseEvent) { logErrors(async () => {
            (<HTMLElement>this.$refs.a).blur();
            if (this.model().selection.selectedCount.value > 0) {
                this.select(ev);
                return;
            }
            await browser.tabs.update(this.tab.id, {active: true});
        })},

        remove() { logErrors(async () => {
            await this.model().tabs.remove([this.tab.id]);
        })},
    },
});
</script>

<style>
</style>

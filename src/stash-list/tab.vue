<template>
<a :class="{'action-container': true,
            'tab': true,
            'saved': !!bm,
            'open': ! tab.hidden,
            'active': !!tab.active}"
   target="_blank" :href="tab.url" :title="tab.title" :data-id="tab.id"
   @click.prevent.stop="open">
  <ItemIcon v-if="tab.favIconUrl" :src="tab.favIconUrl" />
  <span v-else class="icon" />
  <span class="text">{{tab.title}}</span>
  <ButtonBox>
    <Button class="stash one" @action="stash"
            :tooltip="`Stash this tab (hold ${altKey} to keep tab open)`" />
    <Button class="remove" @action="remove" tooltip="Close this tab" />
  </ButtonBox>
</a>
</template>

<script lang="ts">
import {PropType, defineComponent} from 'vue';

import {altKeyName, bgKeyName, bgKeyPressed, required, logErrors} from '../util';
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
    },

    methods: {
        // TODO make Vue injection play nice with TypeScript typing...
        model() { return (<any>this).$model as Model; },

        stash(ev: MouseEvent) { logErrors(async () => {
            await this.model().stashTabs([this.tab], {
                folderId: this.model().mostRecentUnnamedFolderId(),
                close: ! ev.altKey,
            });
        })},

        open(ev: MouseEvent) { logErrors(async () => {
            if (! this.tab.url) return;
            const bg = bgKeyPressed(ev);
            await this.model().restoreTabs([this.tab.url], {background: bg});
        })},

        remove() { logErrors(async () => {
            await this.model().tabs.closeTabs([this.tab.id]);
        })},
    },
});
</script>

<style>
</style>

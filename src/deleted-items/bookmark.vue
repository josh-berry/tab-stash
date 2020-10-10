<template>
    <div class="folder-item action-container">
        <ItemIcon v-if="item.favIconUrl" :src="item.favIconUrl" />
        <a class="text" :href="item.url" target="_blank"><span>{{item.title}}</span></a>
        <ButtonBox>
            <button class="action stash one" title="Restore"
                    @click.prevent.stop="restore"></button>
            <Menu class="menu" summaryClass="action remove last-toolbar-button"
                  title="Delete Forever" :openToRight="true" v-if="id">
                <button @click.prevent.stop="remove">Delete Forever</button>
            </Menu>
        </ButtonBox>
        <slot></slot>
    </div>
</template>

<script lang="ts">
import Vue, {PropType} from 'vue';

import {Model} from '../model';
import {DeletedBookmark} from '../model/deleted-items';
import {bookmarkTabs, mostRecentUnnamedFolderId} from '../stash';

export default Vue.extend({
    components: {
        ButtonBox: require('../components/button-box.vue').default,
        ItemIcon: require('../components/item-icon.vue').default,
        Menu: require('../components/menu.vue').default,
    },
    inject: ['$model'],

    props: {
        id: String,
        item: Object as PropType<DeletedBookmark>,
    },

    methods: {
        model(): Model { return (<any>this).$model; },
        async restore() {
            await bookmarkTabs(await mostRecentUnnamedFolderId(), [this.item]);
            if (this.id) await this.remove();
        },
        async remove() {
            // TODO: Make this work for bookmarks inside folders
            await this.model().deleted_items.drop(this.id);
        },
    },
});
</script>

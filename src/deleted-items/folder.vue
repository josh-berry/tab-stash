<template>
<div>
    <div class="folder-item action-container">
        <ItemIcon class="icon-folder" />
        <span class="text">{{item.title}}</span>
        <ButtonBox v-if="id">
            <button class="action stash" title="Restore"
                    @click.prevent.stop="restore"></button>
            <Menu class="menu" summaryClass="action remove last-toolbar-button"
                  title="Delete Forever" :openToRight="true">
                <button @click.prevent.stop="remove">Delete Forever</button>
            </Menu>
        </ButtonBox>
    </div>
    <ul class="folder-item-nesting">
        <Bookmark v-for="(child, index) of leafChildren" :key="index"
                  :item="child" class="folder-item">
            <span class="indent indent-spacer"></span>
        </Bookmark>
    </ul>
</div>
</template>

<script lang="ts">
import Vue, {PropType} from 'vue';

import {Model} from '../model';
import {DeletedFolder, DeletedItem} from '../model/deleted-items';
import {bookmarkTabs, rootFolder} from '../stash';

export default Vue.extend({
    components: {
        ButtonBox: require('../components/button-box.vue').default,
        ItemIcon: require('../components/item-icon.vue').default,
        Menu: require('../components/menu.vue').default,

        Bookmark: require('./bookmark.vue').default,
    },
    inject: ['$model'],

    props: {
        id: String,
        item: Object as PropType<DeletedFolder>,
    },

    computed: {
        leafChildren(): DeletedItem[] {
            return this.item.children.filter(i => ! ('children' in i));
        },
    },

    methods: {
        model(): Model { return (<any>this).$model; },

        async restore() {
            const root = await rootFolder();
            const folder = await browser.bookmarks.create({
                parentId: root.id,
                title: this.item.title,
                type: 'folder',
                index: 0,
            });
            await bookmarkTabs(folder.id, this.item.children);
            await this.remove();
        },

        async remove() { await this.model().deleted_items.drop(this.id); },
    },
});
</script>

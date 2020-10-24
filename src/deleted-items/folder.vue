<template>
<div v-if="loading" class="folder-item deleted loading">
    <span class="text status-text">{{loading}}...</span>
</div>
<div v-else>
    <div class="folder-item deleted action-container">
        <ItemIcon class="icon-folder" />
        <span class="text" :title="tooltip">{{item.title}}</span>
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
        <Bookmark v-for="(child, index) of leafChildren" :key="child.url+index"
                  :item="child" :parentId="id" :childIndex="index"
                  :deleted_at="deleted_at">
            <span class="indent indent-spacer"></span>
        </Bookmark>
        <li v-if="item.filtered_count" class="folder-item disabled">
            <span class="indent indent-spacer"></span>
            <span class="text status-text hidden-count">
                + {{item.filtered_count}} filtered
            </span>
        </li>
    </ul>
</div>
</template>

<script lang="ts">
import Vue, {PropType} from 'vue';

import {logErrors} from '../util';
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
        deleted_at: Date,
    },

    data: () => ({
        loading: '',
    }),

    computed: {
        leafChildren(): DeletedItem[] {
            return this.item.children.filter(i => ! ('children' in i));
        },
        tooltip(): string {
            return `${this.item.title}\nDeleted ${this.deleted_at.toLocaleString()}`;
        },
    },

    methods: {
        model(): Model { return (<any>this).$model; },

        run(what: string, f: () => Promise<void>) {
            if (this.loading != '') return;
            this.loading = what;
            const p = logErrors(f);
            p.finally(() => {this.loading = ''});
        },

        restore() { this.run("Restoring", async() => {
            const root = await rootFolder();
            const folder = await browser.bookmarks.create({
                parentId: root.id,
                title: this.item.title,
                type: 'folder',
                index: 0,
            });
            await bookmarkTabs(folder.id, this.item.children);
            await this.remove();
            await this.model().deleted_items.drop(this.id);
        })},

        remove() { this.run("Deleting Forever", async() => {
            await this.model().deleted_items.drop(this.id);
        })},
    },
});
</script>

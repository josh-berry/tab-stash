<template>
<div v-if="loading" class="folder-item deleted loading">
    <span class="text status-text">{{loading}}...</span>
</div>
<div v-else class="folder-item deleted action-container">
    <ItemIcon v-if="item.favIconUrl" :src="item.favIconUrl" />
    <a class="text" :href="item.url" target="_blank" :title="tooltip"><span>{{item.title}}</span></a>
    <ButtonBox>
        <Button class="stash one" tooltip="Restore" @action="restore" />
        <Menu class="menu" summaryClass="action remove last-toolbar-button"
                title="Delete Forever" :openToRight="true"
                v-if="id !== undefined || (parentId !== undefined && childIndex !== undefined)">
            <a @click.prevent.stop="remove">Delete Forever</a>
        </Menu>
    </ButtonBox>
    <slot></slot>
</div>
</template>

<script lang="ts">
import Vue, {PropType} from 'vue';

import {logErrors} from '../util';
import {Model} from '../model';
import {DeletedBookmark} from '../model/deleted-items';
import {bookmarkTabs, mostRecentUnnamedFolderId} from '../stash';

export default Vue.extend({
    components: {
        Button: require('../components/button.vue').default,
        ButtonBox: require('../components/button-box.vue').default,
        ItemIcon: require('../components/item-icon.vue').default,
        Menu: require('../components/menu.vue').default,
    },
    inject: ['$model'],

    props: {
        id: String,
        item: Object as PropType<DeletedBookmark>,
        deleted_at: Date,
        parentId: String,
        childIndex: Number,
    },

    data: () => ({
        loading: '',
    }),

    computed: {
        tooltip(): string {
            return `${this.item.title}\nDeleted ${this.deleted_at.toLocaleString()}`;
        }
    },

    methods: {
        model(): Model { return (<any>this).$model; },

        // TODO duplicated in folder.vue; find a Vue and TypeScript-friendly way
        // to refactor this
        run(what: string, f: () => Promise<void>) {
            if (this.loading != '') return;
            this.loading = what;
            const p = logErrors(f);
            p.finally(() => {this.loading = ''});
        },

        restore() { this.run("Restoring", async() => {
            await bookmarkTabs(await mostRecentUnnamedFolderId(), [this.item]);
            await this._remove();
        })},

        async remove() { this.run("Deleting Forever", () => this._remove()); },

        async _remove() {
            if (this.id) {
                await this.model().deleted_items.drop(this.id);
            } else {
                await this.model().deleted_items.dropChildItem(
                    this.parentId, this.childIndex);
            }
        },
    },
});
</script>

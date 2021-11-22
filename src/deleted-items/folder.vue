<template>
<div v-if="loading" class="folder-item deleted loading">
    <span class="item-icon icon spinner size-icon" />
    <span class="text status-text">{{loading}}...</span>
</div>
<div v-else>
    <div class="folder-item deleted action-container">
        <span class="item-icon icon icon-folder" />
        <span class="text" :title="tooltip">{{deletion.item.title}}</span>
        <ButtonBox>
            <Button class="stash" tooltip="Restore" @action="restore" />
            <Menu class="menu" summaryClass="action remove last-toolbar-button"
                  title="Delete Forever" inPlace>
                <button @click.prevent.stop="remove">Delete Forever</button>
            </Menu>
        </ButtonBox>
    </div>
    <ul class="folder-item-nesting">
        <Bookmark v-for="(child, index) of leafChildren" :key="child.url+index"
                  :parent="deletion" :child="child" :childIndex="index">
            <span class="indent"></span>
        </Bookmark>
        <li v-if="item.filtered_count" class="folder-item disabled">
            <span class="indent" />
            <span class="icon" />
            <span class="text status-text hidden-count">
                + {{item.filtered_count}} filtered
            </span>
        </li>
    </ul>
</div>
</template>

<script lang="ts">
import {PropType, defineComponent} from 'vue';

import {required} from '../util';
import {Model} from '../model';
import {DeletedFolder, DeletedItem, Deletion} from '../model/deleted-items';

export default defineComponent({
    components: {
        Button: require('../components/button.vue').default,
        ButtonBox: require('../components/button-box.vue').default,
        Menu: require('../components/menu.vue').default,

        Bookmark: require('./bookmark.vue').default,
    },
    inject: ['$model'],

    props: {
        deletion: required(Object as PropType<Deletion>),
    },

    data: () => ({
        loading: '',
    }),

    computed: {
        item(): DeletedFolder { return this.deletion.item as DeletedFolder; },
        deletedAt(): string { return this.deletion.deleted_at.toLocaleString() },
        leafChildren(): DeletedItem[] {
            return this.item.children.filter(i => ! ('children' in i));
        },
        tooltip(): string {
            return `${this.item.title}\nDeleted ${this.deletedAt}`;
        },
    },

    methods: {
        model(): Model { return (<any>this).$model; },

        run(what: string, f: () => Promise<void>) {
            if (this.loading != '') return;
            this.loading = what;
            const p = this.model().attempt(f);
            p.finally(() => {this.loading = ''});
        },

        restore() { this.run("Restoring", async() => {
            await this.model().undelete(this.deletion);
        })},

        remove() { this.run("Deleting Forever", async() => {
            await this.model().deleted_items.drop(this.deletion.key);
        })},
    },
});
</script>

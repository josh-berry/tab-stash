<template>
<div v-if="loading" class="folder-item deleted loading">
    <span class="text status-text">{{loading}}...</span>
</div>
<div v-else>
    <div class="folder-item deleted action-container">
        <ItemIcon class="icon-folder" />
        <span class="text" :title="tooltip">{{item.title}}</span>
        <ButtonBox v-if="id">
            <Button class="action stash" title="Restore"
                    @click.prevent.stop="restore"></Button>
            <Menu class="menu" summaryClass="action remove last-toolbar-button"
                  title="Delete Forever" :openToRight="true">
                <a @click.prevent.stop="remove">Delete Forever</a>
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

export default Vue.extend({
    components: {
        Button: require('../components/button.vue').default,
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
            await this.model().deleted_items.undelete(this.id);
        })},

        remove() { this.run("Deleting Forever", async() => {
            await this.model().deleted_items.drop(this.id);
        })},
    },
});
</script>

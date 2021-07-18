<template>
<div v-if="loading" class="folder-item deleted loading">
    <span class="text status-text">{{loading}}...</span>
</div>
<div v-else class="folder-item deleted action-container">
    <ItemIcon v-if="item.favIconUrl" :src="item.favIconUrl" />
    <span v-else class="icon" />
    <a class="text" :href="item.url" target="_blank" :title="tooltip"><span>{{item.title}}</span></a>
    <ButtonBox>
        <Button class="stash one" tooltip="Restore" @action="restore" />
        <Menu class="menu" summaryClass="action remove last-toolbar-button"
                title="Delete Forever" :openToRight="true">
            <a @click.prevent.stop="remove">Delete Forever</a>
        </Menu>
    </ButtonBox>
    <slot></slot>
</div>
</template>

<script lang="ts">
import {PropType, defineComponent} from 'vue';

import {logErrors} from '../util';
import {Model} from '../model';
import {DeletedBookmark, Deletion} from '../model/deleted-items';

export default defineComponent({
    components: {
        Button: require('../components/button.vue').default,
        ButtonBox: require('../components/button-box.vue').default,
        ItemIcon: require('../components/item-icon.vue').default,
        Menu: require('../components/menu.vue').default,
    },
    inject: ['$model'],

    props: {
        deletion: Object as PropType<Deletion | undefined>,

        parent: Object as PropType<Deletion | undefined>,
        child: Object as PropType<DeletedBookmark | undefined>,
        childIndex: Number,
    },

    data: () => ({
        loading: '',
    }),

    computed: {
        item(): DeletedBookmark {
            if (this.deletion) return this.deletion.item as DeletedBookmark;
            return this.child!;
        },
        deleted_at(): string {
            if (this.deletion) return this.deletion.deleted_at.toLocaleString();
            return this.parent!.deleted_at.toLocaleString();
        },

        tooltip(): string {
            const t = `${this.item.title}\n`;
            if (this.deletion?.deleted_from) {
                return `${t}Deleted at ${this.deleted_at} from "${this.deletion.deleted_from.title}"`;
            } else {
                return `${t}Deleted ${this.deleted_at}`;
            }
        },
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
            if (this.parent) {
                // We are restoring an individual child of a deleted parent
                // folder.
                await this.model().undeleteChild(this.parent, this.childIndex!);

            } else if (this.deletion) {
                // We are restoring a top-level deletion.
                await this.model().undelete(this.deletion);
            }
        })},

        async remove() { this.run("Deleting Forever", () => {
            if (this.deletion) {
                return this.model().deleted_items.drop(this.deletion.key);
            } else {
                return this.model().deleted_items.dropChildItem(
                    this.parent!.key, this.childIndex!);
            }
        })},
    },
});
</script>

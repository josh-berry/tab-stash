<template>
<Menu ref="menu" class="menu selection-menu" @open="onOpenMenu">
    <template #summary>
        <div class="count">{{selectedCount}}</div>
        <div class="icon icon-move-menu-inverse"></div>
    </template>

    <div :class="{[$style.new_stash]: true}">
        <input ref="search" type="search" placeholder="Search or create group"
                v-model="searchText"
                @click.stop=""
                @keypress.enter.prevent.stop="moveToSearch(); closeMenu();"/>
        <input type="button" class="action stash newgroup" tabindex="0"
                :title="createTooltip" @click="create" />
        <div class="status-text">
            Hit Enter to {{searchStatus}}
        </div>
    </div>

    <hr/>

    <div :class="$style.list">
        <a v-for="(folder, index) of stashFolders"
            :class="{'selected': (index === 0 && searchText !== '')}"
            :title="`Move to &quot;${friendlyFolderName(folder.title)}&quot;`"
            tabindex="0" @click.prevent="moveTo(folder.id)"
            >{{friendlyFolderName(folder.title)}}</a>
    </div>

    <hr/>

    <a tabindex="0" title="Open all stashed tabs in the window"
        @click.prevent="openInWindow"><span class="icon icon-restore"></span> Open</a>
    <a tabindex="0" title="Open tabs and delete them from the stash"
        @click.prevent="moveToWindow"><span class="icon icon-restore-del"></span> Unstash</a>
    <hr/>
    <a tabindex="0" title="Delete stashed tabs and close unstashed tabs"
        @click.prevent="remove"><span class="icon icon-delete"></span> Delete or Close</a>
</Menu>
</template>

<script lang="ts">
import {defineComponent} from "@vue/runtime-core";

import {filterMap, logErrors, textMatcher} from "../util";
import {Model} from "../model";
import {Folder, NodeID, friendlyFolderName} from "../model/bookmarks";

export default defineComponent({
    components: {
        Menu: require('../components/menu.vue').default,
    },

    props: {},

    data: () => ({
        searchText: '',
    }),

    inject: ['$model'],

    computed: {
        selectedCount(): number {
            return this.model().selection.selected_count.value;
        },

        stashFolders(): Folder[] {
            const bookmarks = this.model().bookmarks;
            const stash_root = bookmarks.stash_root.value;
            if (! stash_root) return [];
            return filterMap(stash_root.children, id => {
                const node = bookmarks.node(id);
                if ('children' in node) return node as Folder;
                return undefined;
            }).filter(node => this.filter(node.title));
        },

        filter(): (text: string) => boolean {
            return textMatcher(friendlyFolderName(this.searchText));
        },

        createTooltip(): string {
            const what = this.searchText !== '' ? `"${this.searchText}"` : `a new group`;
            return `Create ${what}`;
        },

        searchStatus(): string {
            if (this.searchText === '') return `create a new group`;
            if (this.stashFolders.length === 0) return `create "${this.searchText}"`;
            return `move to "${friendlyFolderName(this.stashFolders[0].title)}"`;
        },
    },

    methods: {
        model(): Model { return (<any>this).$model as Model; },
        friendlyFolderName,

        closeMenu() { (<any>this.$refs.menu).close(); },

        onOpenMenu() {
            this.searchText = '';
            (<HTMLElement>this.$refs.search).focus();
        },

        create() { logErrors(async() => {
            const model = this.model();
            let folder;
            if (! this.searchText) {
                folder = await model.bookmarks.createUnnamedFolder();
            } else {
                const stash_root = await model.bookmarks.ensureStashRoot();
                folder = await model.bookmarks.create({
                    parentId: stash_root.id,
                    title: this.searchText,
                    index: 0,
                });
            }
            this.moveTo(folder.id);
        }); },

        moveToSearch() {
            if (this.searchText === '' || this.stashFolders.length === 0) {
                this.create();
            } else {
                const folder = this.stashFolders[0];
                this.moveTo(folder.id);
            }
        },

        moveTo(id: NodeID) { logErrors(async() => {
            const model = this.model();
            await model.putItemsInFolder({
                move: true,
                items: Array.from(model.selectedItems()),
                toFolderId: id,
            });
        }); },

        openInWindow() { logErrors(async() => {
            const model = this.model();
            if (model.tabs.current_window === undefined) return;

            await model.putItemsInWindow({
                move: false,
                items: Array.from(model.selectedItems()),
                toWindowId: model.tabs.current_window,
            });
        }); },

        moveToWindow() { logErrors(async() => {
            const model = this.model();
            if (model.tabs.current_window === undefined) return;

            await model.putItemsInWindow({
                move: true,
                items: Array.from(model.selectedItems()),
                toWindowId: model.tabs.current_window,
            });
        }); },

        remove() { logErrors(async() => {
            const model = this.model();
            const ids = Array.from(model.selectedItems()).map(i => i.id);
            await model.deleteItems(ids);
        }); },
    }
});

</script>

<style module>
.list {
    overflow-x: hidden;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding-left: 0 !important;
    padding-right: 0 !important;
}

.new_stash {
    padding: 0 var(--menu-mw);

    display: grid;
    grid-template-columns: 1fr 0fr;
    column-gap: var(--ctrl-mw);
    row-gap: var(--menu-mh);
}

.new_stash :global(.status-text) {
    grid-row: 2;
    grid-column: 1 / 3;

    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
}
</style>

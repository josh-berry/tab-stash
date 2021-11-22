<template>
<Menu ref="menu" class="menu selection-menu" modalClass="action-container"
      @open="onOpenMenu">
    <template #summary>
        <div class="count">{{selectedCount}}</div>
        <div class="icon icon-move-menu-inverse"></div>
    </template>

    <button tabindex="0" title="Open stashed tabs"
            @click.prevent="copyToWindow">
        <span class="icon icon-restore"></span>
        <span>Open</span>
    </button>
    <button tabindex="0" title="Open tabs and delete them from the stash"
            @click.prevent="moveToWindow">
        <span class="icon icon-restore-del"></span>
        <span>Unstash</span>
    </button>

    <hr/>

    <input ref="search" type="search" placeholder="Search or create group"
            v-model="searchText"
            @click.stop=""
            @keypress.enter.prevent.stop="moveToSearch($event); closeMenu();"/>

    <button :class="{'selected': searchText === '' || stashFolders.length === 0}"
            :title="createTooltip"
            @click.prevent="create">
        <span class="icon icon-new-empty-group"></span>
        <span>{{ createTitle }}</span>
    </button>

    <hr/>

    <div :class="$style.list" tabindex="-1">
        <button v-for="(folder, index) of stashFolders"
                :class="{'selected': (index === 0 && searchText !== '')}"
                :title="`Move to &quot;${friendlyFolderName(folder.title)}&quot; (hold ${altKey} to copy)`"
                @click.prevent="moveTo($event, folder.id)"
            >{{friendlyFolderName(folder.title)}}</button>
    </div>

    <hr/>

    <button title="Delete stashed tabs and close unstashed tabs"
            @click.prevent="remove">
       <span class="icon icon-delete"></span>
       <span>Delete or Close</span>
    </button>
</Menu>
</template>

<script lang="ts">
import {defineComponent} from "@vue/runtime-core";

import {altKeyName, filterMap, textMatcher} from "../util";
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
        altKey: altKeyName,

        selectedCount(): number {
            return this.model().selection.selectedCount.value;
        },

        stashFolders(): Folder[] {
            const bookmarks = this.model().bookmarks;
            const stash_root = bookmarks.stash_root.value;
            if (! stash_root) return [];
            return filterMap(stash_root.children, id => {
                const node = bookmarks.node(id);
                if (node && 'children' in node) return node as Folder;
                return undefined;
            }).filter(node => this.filter(node.title));
        },

        filter(): (text: string) => boolean {
            return textMatcher(friendlyFolderName(this.searchText));
        },

        createTitle(): string {
            if (this.searchText === '') return 'Move to New Group';
            return `Move to "${this.searchText}"`;
        },

        createTooltip(): string {
            const copy = `(hold ${this.altKey} to copy)`;
            if (this.searchText === '') return `Move to a new group ${copy}`;
            return `Move to new group "${this.searchText} ${copy}"`;
        },
    },

    methods: {
        model(): Model { return (<any>this).$model as Model; },
        attempt(fn: () => Promise<void>) { this.model().attempt(fn); },

        friendlyFolderName,

        closeMenu() { (<any>this.$refs.menu).close(); },

        onOpenMenu() {
            this.searchText = '';
            (<HTMLElement>this.$refs.search).focus();
        },

        create(ev: MouseEvent | KeyboardEvent) { this.attempt(async() => {
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
            this.moveTo(ev, folder.id);
        }); },

        moveToSearch(ev: MouseEvent | KeyboardEvent) {
            if (this.searchText === '' || this.stashFolders.length === 0) {
                this.create(ev);
            } else {
                const folder = this.stashFolders[0];
                this.moveTo(ev, folder.id);
            }
        },

        moveTo(ev: MouseEvent | KeyboardEvent, id: NodeID) {
            this.attempt(() => this.model().putSelectedInFolder({
                move: ! ev.altKey,
                toFolderId: id,
            }));
        },

        copyToWindow() {
            this.attempt(() => this.model().putSelectedInWindow({move: false}));
        },

        moveToWindow() {
            this.attempt(() => this.model().putSelectedInWindow({move: true}));
        },

        remove() { this.attempt(async() => {
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
</style>

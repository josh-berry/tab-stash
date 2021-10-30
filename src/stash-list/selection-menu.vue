<template>
<Menu class="menu selection-menu" @open="onOpenMenu">
    <template #summary>
        <div class="count">{{selected_count}}</div>
        <div class="icon icon-move-menu-inverse"></div>
    </template>

    <div :class="{[$style.new_stash]: true}">
        <input ref="search" type="search" placeholder="Search or create group"
                v-model="searchText"
                @click.stop=""
                @keypress.esc="searchText = ''"
                @keypress.enter.prevent.stop="moveToSearch"/>
        <input type="button" class="action stash newgroup" tabindex="0"
                :title="createTooltip" @click="moveToNew" />
        <div class="status-text">
            Hit Enter to {{searchStatus}}
        </div>
    </div>

    <hr/>

    <div :class="$style.list">
        <a v-for="(folder, index) of stash_folders"
            :class="{'selected': (index === 0 && searchText !== '')}"
            title="Move to &quot;{{friendlyFolderName(folder.title)}}&quot;"
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

import {filterMap, textMatcher} from "../util";
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
        selected_count(): number {
            return this.model().selection.selected_count.value;
        },

        stash_folders(): Folder[] {
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
            const what = this.searchText !== '' ? `"${this.searchText}"` : `a new stash`;
            return `Create ${what}`;
        },

        searchStatus(): string {
            if (this.searchText === '') return `create a new group`;
            if (this.stash_folders.length === 0) return `create "${this.searchText}"`;
            return `move to "${friendlyFolderName(this.stash_folders[0].title)}"`;
        },
    },

    methods: {
        model(): Model { return (<any>this).$model as Model; },
        friendlyFolderName,

        onOpenMenu() {
            (<HTMLElement>this.$refs.search).focus();
        },

        moveToNew() {

        },

        moveToSearch() {
            // should mirror stash_menu_msg
        },

        moveTo(id: NodeID) {
            console.log(id);
        },

        openInWindow() {

        },

        moveToWindow() {

        },

        remove() {

        },
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

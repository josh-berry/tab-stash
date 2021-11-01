<template>
<section :class="{folder: true,
              'action-container': true,
              collapsed: collapsed,
              hidden: hideIfEmpty && visibleChildren.length == 0,
              }"
          :data-id="folder.id">
  <header>
    <Button :class="{collapse: ! collapsed, expand: collapsed}"
            tooltip="Hide the tabs for this group"
            @action="collapsed = ! collapsed" />
    <ButtonBox class="folder-actions">
      <Button class="stash here" @action="stash"
              :tooltip="`Stash all (or selected) open tabs to this group `
                        + `(hold ${altkey} to keep tabs open)`" />
      <Button class="stash one here" @action="stashOne"
              :tooltip="`Stash the active tab to this group `
                        + `(hold ${altkey} to keep tabs open)`" />
      <Button class="restore" @action="restoreAll"
              :tooltip="`Open all tabs in this group `
                      + `(hold ${bgKey} to open in background)`" />
      <Button class="restore-remove" @action="restoreAndRemove"
              :tooltip="`Open all tabs in the group and delete the group `
                      + `(hold ${bgKey} to open in background)`" />
      <Button v-if="! collapsed" class="remove" @action="remove"
              tooltip="Delete this group" />
    </ButtonBox>
    <!-- This is at the end so it gets put in front of the buttons etc.
         Important to ensure the focused box-shadow gets drawn over the buttons,
         rather than behind them. -->
    <editable-label :class="{'folder-name': true, 'ephemeral': true}"
                    :value="nonDefaultTitle"
                    :defaultValue="defaultTitle"
                    :edit="rename"></editable-label>
  </header>
  <div class="contents">
    <dnd-list class="tabs" v-model="allChildren" item-key="id"
              :accepts="accepts" :drag="drag" :drop="drop" :mimic-height="true">
      <template #item="{item}">
        <bookmark v-if="! ('children' in item)" :bookmark="item"
             :class="{hidden: (filter && ! filter(item))
                        || (userFilter && ! userFilter(item)),
                      'folder-item': true}" />
      </template>
    </dnd-list>
    <div class="folder-item disabled" v-if="filterCount > 0">
      <span class="icon" /> <!-- spacer -->
      <span class="text status-text hidden-count">
        + {{filterCount}} filtered
      </span>
    </div>
  </div>
</section>
</template>

<script lang="ts">
import browser from 'webextension-polyfill';
import {PropType, defineComponent} from 'vue';

import {
    altKeyName, bgKeyName, bgKeyPressed, logErrors, required
} from '../util';
import {DragAction, DropAction} from '../components/dnd-list';

import {Model, StashItem} from '../model';
import {
    Node, Bookmark, Folder, genDefaultFolderName, getDefaultFolderNameISODate, friendlyFolderName,
} from '../model/bookmarks';
import {BookmarkMetadataEntry} from '../model/bookmark-metadata';

const DROP_FORMATS = [
    'application/x-tab-stash-items',
];

export default defineComponent({
    components: {
        Button: require('../components/button.vue').default,
        ButtonBox: require('../components/button-box.vue').default,
        DndList: require('../components/dnd-list.vue').default,
        EditableLabel: require('../components/editable-label.vue').default,
        Bookmark: require('./bookmark.vue').default,
    },

    inject: ['$model'],

    props: {
        // View filter functions
        userFilter: Function as PropType<(item: Bookmark) => boolean>,
        hideIfEmpty: Boolean,

        // Bookmark folder
        folder: required(Object as PropType<Folder>),

        metadata: required(Object as PropType<BookmarkMetadataEntry>),
    },

    computed: {
        altkey: altKeyName,
        bgKey: bgKeyName,

        accepts() { return DROP_FORMATS; },

        allChildren(): readonly Node[] {
            return this.folder.children.map(cid => this.model().bookmarks.node(cid));
        },

        collapsed: {
            get(): boolean { return !! this.metadata.value?.collapsed; },
            set(collapsed: boolean) {
                this.model().bookmark_metadata.setCollapsed(
                    this.metadata.key, collapsed);
            },
        },

        /** Returns a "default" name to use if no explicit name is set.  This
         * default is typically a timestamp with one of two sources--if the
         * folder has a title that looks like a "default" title, we use that.
         * Otherwise we generate the default name from the folder's creation
         * time.
         *
         * This approach handles unnamed folders which were synced from
         * elsewhere and thus have a creation time that isn't their actual
         * creation time. */
        defaultTitle(): string {
            if (getDefaultFolderNameISODate(this.folder.title) !== null) {
                return friendlyFolderName(this.folder.title);
            } else {
                return `Saved ${(new Date(this.folder.dateAdded || 0)).toLocaleString()}`;
            }
        },
        nonDefaultTitle(): string | undefined {
            return getDefaultFolderNameISODate(this.folder.title) !== null
                ? undefined : this.folder.title;
        },

        filteredChildren(): Bookmark[] {
            return this.allChildren.filter(c => 'url' in c) as Bookmark[];
        },
        visibleChildren(): Bookmark[] {
            if (this.userFilter) {
                return this.filteredChildren.filter(this.userFilter);
            } else {
                return this.filteredChildren;
            }
        },
        filterCount(): number {
            return this.filteredChildren.length - this.visibleChildren.length;
        },
    },

    methods: {
        // TODO make Vue injection play nice with TypeScript typing...
        model() { return (<any>this).$model as Model; },

        async stash(ev: MouseEvent | KeyboardEvent) {logErrors(async() => {
            // Stashing possibly-selected open tabs into the current group.
            const win_id = this.model().tabs.current_window;
            if (! win_id) return;
            await this.model().stashTabsInWindow(
                win_id, {folderId: this.folder.id, close: ! ev.altKey});
        })},

        async stashOne(ev: MouseEvent | KeyboardEvent) {logErrors(async() => {
            const tab = this.model().tabs.activeTab();
            if (! tab) return;
            await this.model().stashTabs([tab],
                {folderId: this.folder.id, close: ! ev.altKey});
        })},

        async restoreAll(ev: MouseEvent | KeyboardEvent) {logErrors(async () => {
            await this.model().restoreTabs(
                this.filteredChildren.map(c => c.url),
                {background: bgKeyPressed(ev)});
        })},

        async remove() {logErrors(async() => {
            await this.model().deleteBookmarkTree(this.folder.id);
        })},

        async restoreAndRemove(ev: MouseEvent | KeyboardEvent) {logErrors(async() => {
            const bg = bgKeyPressed(ev);

            await this.model().restoreTabs(
                this.filteredChildren.map(c => c.url),
                {background: bg});
            await this.model().deleteBookmarkTree(this.folder.id);
        })},

        async rename(title: string) {
            if (title === '') {
                if (getDefaultFolderNameISODate(this.folder.title) !== null) {
                    // It already has a default name; leave it alone so we don't
                    // lose track of when the folder was actually created.
                    return;
                }

                // Else give it a default name based on the creation time
                title = genDefaultFolderName(new Date(this.folder.dateAdded || 0));
            }

            await browser.bookmarks.update(this.folder.id, {title});
        },

        drag(ev: DragAction<Bookmark>) {
            const items = ev.value.$selected
                ? Array.from(this.model().selectedItems())
                : [ev.value];
            ev.dataTransfer.setData('application/x-tab-stash-items',
                JSON.stringify(items));
        },

        async drop(ev: DropAction) {
            const data = ev.dataTransfer.getData('application/x-tab-stash-items');
            const items = JSON.parse(data) as StashItem[];

            await this.model().putItemsInFolder({
                items,
                toFolderId: this.folder.id,
                toIndex: ev.toIndex,
                move: true,
            });
        },
    },
});
</script>

<style>
</style>

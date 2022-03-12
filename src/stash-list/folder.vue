<template>
<section :class="{folder: true, 'action-container': true,
         'has-open-tabs': openTabsCount > 0,
         collapsed: collapsed}"
         :data-id="folder.id">
  <header>
    <Button :class="{collapse: ! collapsed, expand: collapsed}"
            tooltip="Hide the tabs for this group"
            @action="collapsed = ! collapsed" />
    <ButtonBox v-if="selectedCount === 0" class="folder-actions">
      <Button class="stash here" @action="stash"
              :tooltip="`Stash all (or highlighted) open tabs to this group (hold ${altKey} to keep tabs open)`" />
      <Button class="stash one here" @action="stashOne"
              :tooltip="`Stash the active tab to this group `
                        + `(hold ${altKey} to keep tabs open)`" />
      <Button class="restore" @action="restoreAll"
              :tooltip="`Open all tabs in this group `
                      + `(hold ${bgKey} to open in background)`" />
      <Button class="restore-remove" @action="restoreAndRemove"
              :tooltip="`Open all tabs in the group and delete the group `
                      + `(hold ${bgKey} to open in background)`" />
      <Button class="remove" @action="remove" tooltip="Delete this group" />
    </ButtonBox>
    <ButtonBox v-else class="folder-actions">
        <Button class="stash here" @action="move"
                :tooltip="`Move ${selectedCount} selected tab(s) to this group (hold ${altKey} to copy)`" />
    </ButtonBox>
    <!-- This is at the end so it gets put in front of the buttons etc.
         Important to ensure the focused box-shadow gets drawn over the buttons,
         rather than behind them. -->
    <editable-label
        class="folder-name ephemeral"
        :value="nonDefaultTitle"
        :defaultValue="defaultTitle"
        :tooltip="tooltip"
        :edit="rename"></editable-label>
  </header>
  <div class="contents">
    <dnd-list class="tabs" v-model="childrenWithTabs" item-key="id" :item-class="childClasses"
              :accepts="accepts" :drag="drag" :drop="drop" :mimic-height="true">
      <template #item="{item}">
        <bookmark v-if="isValidChild(item.node)" :bookmark="item.node" :relatedTabs="item.tabs"
                  :class="{'folder-item': true, 'no-match': ! item.node.$visible}" />
      </template>
    </dnd-list>
    <div class="folder-item" v-if="filterCount > 0"
         @click.prevent.stop="showFiltered = ! showFiltered">
      <span class="indent" />
      <span class="text status-text hidden-count">
        {{showFiltered ? '-' : '+'}} {{filterCount}} filtered
      </span>
    </div>
  </div>
</section>
</template>

<script lang="ts">
import browser from 'webextension-polyfill';
import {PropType, defineComponent} from 'vue';

import {altKeyName, bgKeyName, bgKeyPressed, required} from '../util';
import {DragAction, DropAction} from '../components/dnd-list';

import {copyIf, Model, StashItem} from '../model';
import {
    Node, NodeID, Bookmark, Folder, genDefaultFolderName, getDefaultFolderNameISODate, friendlyFolderName,
} from '../model/bookmarks';
import {BookmarkMetadataEntry} from '../model/bookmark-metadata';
import {Tab} from '../model/tabs';

type NodeWithTabs = { node: Node, id: NodeID, tabs: Tab[]};

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
        // Bookmark folder
        folder: required(Object as PropType<Folder>),

        metadata: required(Object as PropType<BookmarkMetadataEntry>),
    },

    data: () => ({
        showFiltered: false,
    }),

    computed: {
        altKey: altKeyName,
        bgKey: bgKeyName,

        accepts() { return DROP_FORMATS; },

        targetWindow(): number | undefined {
            return this.model().tabs.targetWindow.value;
        },

        childrenWithTabs(): readonly NodeWithTabs[] {
            const mtabs = this.model().tabs;
            return this.children
                .map(n => ({
                    id: n.id,
                    node: n,
                    tabs: 'url' in n && n.url
                        ? Array.from(mtabs.tabsWithURL(n.url))
                            .filter(t => t.windowId === this.targetWindow)
                        : []
                }));
        },

        childTabStats(): { open: number, discarded: number, hidden: number } {
            let open = 0, discarded = 0, hidden = 0;
            for (const nwt of this.childrenWithTabs) {
                for (const tab of nwt.tabs) {
                    if (tab.windowId !== this.targetWindow) {
                        continue;
                    }
                    if (tab.hidden) {
                        hidden += 1;
                    } else if (tab.discarded) {
                        discarded += 1;
                    } else {
                        open += 1;
                    }
                }
            }
            return { open, discarded, hidden };
        },

        openTabsCount(): number {
            return this.childTabStats.open + this.childTabStats.discarded;
        },

        children(): readonly Node[] {
            return this.model().bookmarks.childrenOf(this.folder);
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
        tooltip(): string {
            const st = this.childTabStats;
            const child_count = this.validChildren.length;
            const statstip = `${child_count} stashed tab${
                child_count != 1 ? 's' : ''} (${st.open} open, ${
                st.discarded} unloaded, ${st.hidden} hidden)`;
            return `${this.nonDefaultTitle ?? this.defaultTitle}\n${statstip}`;
        },

        validChildren(): Bookmark[] {
            return this.children.filter(c => this.isValidChild(c)) as Bookmark[];
        },
        visibleChildren(): Bookmark[] {
            return this.validChildren.filter(c => c.$visible);
        },
        filterCount(): number {
            return this.validChildren.length - this.visibleChildren.length;
        },

        selectedCount(): number {
            return this.model().selection.selectedCount.value;
        },
    },

    methods: {
        // TODO make Vue injection play nice with TypeScript typing...
        model() { return (<any>this).$model as Model; },
        attempt(fn: () => Promise<void>) { this.model().attempt(fn); },

        childClasses(nodet: NodeWithTabs): Record<string, boolean> {
            const node = nodet.node;
            return {hidden: ! (
                this.isValidChild(node) && (this.showFiltered || node.$visible))};
        },

        isValidChild(node: Node): boolean { return 'url' in node; },

        stash(ev: MouseEvent | KeyboardEvent) {
            const model = this.model();
            const win_id = model.tabs.targetWindow.value;
            if (! win_id) return;

            model.attempt(async () => await model.putItemsInFolder({
                items: copyIf(ev.altKey, model.stashableTabsInWindow(win_id)),
                toFolderId: this.folder.id,
            }));
        },

        async stashOne(ev: MouseEvent | KeyboardEvent) {this.attempt(async() => {
            const tab = this.model().tabs.activeTab();
            if (! tab) return;
            await this.model().putItemsInFolder({
                items: copyIf(ev.altKey, [tab]),
                toFolderId: this.folder.id,
            });
        })},

        move(ev: MouseEvent | KeyboardEvent) {
            const model = this.model();
            const win_id = model.tabs.targetWindow.value;
            if (! win_id) return;

            model.attempt(() => model.putSelectedInFolder({
                copy: ev.altKey,
                toFolderId: this.folder.id,
            }));
        },

        async restoreAll(ev: MouseEvent | KeyboardEvent) {this.attempt(async () => {
            await this.model().restoreTabs(
                this.validChildren.map(c => c.url),
                {background: bgKeyPressed(ev)});
        })},

        async remove() {this.attempt(async() => {
            await this.model().deleteBookmarkTree(this.folder.id);
        })},

        async restoreAndRemove(ev: MouseEvent | KeyboardEvent) {this.attempt(async() => {
            const bg = bgKeyPressed(ev);

            await this.model().restoreTabs(
                this.validChildren.map(c => c.url),
                {background: bg});
            await this.model().deleteBookmarkTree(this.folder.id);
        })},

        async rename(title: string) { this.attempt(async() => {
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
        })},

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

            const model = this.model();
            await model.attempt(() => this.model().putItemsInFolder({
                items,
                toFolderId: this.folder.id,
                toIndex: ev.toIndex,
            }));
        },
    },
});
</script>

<style>
</style>

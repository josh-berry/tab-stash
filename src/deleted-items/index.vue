<template>
<main>
    <header class="page action-container">
        <a class="action back" title="Back to Tab Stash"
           :href="pageref('stash-list.html')"></a>
        <input slot="after" type="search" ref="search" class="ephemeral"
               placeholder="Search Deleted Items on This Computer"
               @keyup.esc.prevent="searchtext=''; $refs.search.blur()"
               v-model="searchtext">
    </header>
    <div class="folder-list one-column">
        <div v-for="group of filter_results" :key="group.title" class="folder">
            <div class="header">
                <div class="folder-name disabled">Deleted {{group.title}}</div>
            </div>
            <ul class="contents">
                <li v-for="rec of group.records" :key="rec.key">
                    <Folder v-if="rec.item.children" 
                            :id="rec.key" :item="rec.item"
                            :deleted_at="rec.deleted_at" />
                    <Bookmark v-else :id="rec.key" :item="rec.item"
                              :deleted_at="rec.deleted_at" />
                </li>
                <li v-if="group.filter_count > 0" class="folder-item disabled">
                    <span class="text status-text hidden-count">
                        + {{group.filter_count}} filtered
                    </span>
                </li>
            </ul>
        </div>
    </div>
    <LoadMore :identifier="searchtext" @infinite="loadMore">
        <footer slot="no-results" class="page footer status-text">
            No deleted items found on this computer.
        </footer>
        <footer slot="no-more" class="page footer status-text">
            No more deleted items on this computer.
        </footer>
    </LoadMore>
</main>
</template>

<script lang="ts">
import Vue, {PropType} from 'vue';
import LoadMore, {StateChanger} from 'vue-infinite-loading';

import {filterMap, logErrors, textMatcher} from '../util';
import launch, {pageref} from '../launch-vue';
import ui_model from '../ui-model';
import {Model} from '../model';
import * as DI from '../model/deleted-items';

const date_formatter = new Intl.DateTimeFormat();

type RecordGroup = FilterCount<{title: string, records: FilteredDeletion[]}>;
type FilteredDeletion = DI.Deletion & {item: FilteredDeletedItem};
type FilteredDeletedItem = FilterCount<DI.DeletedItem>;

type FilterCount<F> = F & {filter_count?: number};

const Main = Vue.extend({
    components: {
        LoadMore,
        Bookmark: require('./bookmark.vue').default,
        ButtonBox: require('../components/button-box.vue').default,
        Folder: require('./folder.vue').default,
        ItemIcon: require('../components/item-icon.vue').default,
        PageHeader: require('../page-header.vue').default,
    },

    props: {
        state: Object as PropType<DI.State>,
    },

    data() { return {
        searchtext: '',
    }},

    computed: {
        record_groups(): RecordGroup[] {
            const ret: RecordGroup[] = [];
            let cutoff = this.startOfToday();
            let records: DI.Deletion[] = [];

            for (const r of this.state.entries) {
                while (r.deleted_at.valueOf() < cutoff.valueOf()) {
                    if (records.length > 0) {
                        ret.push({title: cutoff.toLocaleDateString(), records});
                    }
                    records = [];
                    cutoff = new Date(cutoff.valueOf() - 24*60*60*1000);
                }
                records.push(r);
            }
            if (records.length > 0) {
                ret.push({title: cutoff.toLocaleDateString(), records});
            }

            return ret;
        },

        text_matcher(): (txt: string) => boolean {
            return textMatcher(this.searchtext);
        },

        filter_results(): RecordGroup[] {
            if (! this.searchtext) return this.record_groups;

            const mapitem = (i: FilteredDeletedItem): FilteredDeletedItem | undefined => {
                if (this.text_matcher(i.title)) return i;
                if ('url' in i && this.text_matcher(i.url)) return i;

                if ('children' in i) {
                    const mapped: FilteredDeletedItem = {
                        title: i.title,
                        children: filterMap(i.children, mapitem),
                    };
                    if (mapped.children.length === 0) return undefined;

                    mapped.filter_count = i.children.length - mapped.children.length;
                    return mapped;
                }

                return undefined;
            };

            return filterMap(this.record_groups, rg => {
                const filtered = filterMap(rg.records, r => {
                    const i = mapitem(r.item);
                    if (i) return {
                        key: r.key,
                        deleted_at: r.deleted_at,
                        item: i,
                    };
                    return undefined;
                });
                if (filtered.length === 0) return undefined;

                return {
                    title: rg.title,
                    records: filtered,
                    filter_count: rg.records.length - filtered.length,
                };
            });
        },
    },

    methods: {
        // Dummy which is overridden in launch() below...
        model(): Model { return (<any>this).$model; },
        pageref,

        loadMore(state: StateChanger) { logErrors(async() => {
            await this.model().deleted_items.loadMore();
            if (this.state.entries.length > 0) state.loaded();
            if (this.state.fullyLoaded) state.complete();
        })},

        startOfToday(): Date {
            const d = new Date();
            d.setMilliseconds(0);
            d.setSeconds(0);
            d.setMinutes(0);
            d.setHours(0);
            return d;
        },

        friendlyDay(d: Date): string {
            return date_formatter.format(d);
        }
    },
});

export default Main;

launch(Main, async() => {
    const model = await ui_model();
    return {
        propsData: {
            state: model.state.deleted_items,
        },
        provide: {
            $model: model,
        },
        methods: {
            model() { return model; },
        },
    };
});
</script>

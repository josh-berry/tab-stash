<template>
<main>
    <PageHeader>Deleted Items</PageHeader>
    <div class="folder-list one-column">
        <div v-for="group of record_groups" :key="group.title" class="folder">
            <div class="header">
                <div class="folder-name">{{group.title}}</div>
            </div>
            <ul class="contents">
                <li v-for="rec of group.records" :key="rec.key">
                    <Folder v-if="rec.item.children" 
                            :id="rec.key" :item="rec.item" />
                    <Bookmark v-else :id="rec.key" :item="rec.item" />
                </li>
            </ul>
        </div>
    </div>
    <LoadMore @infinite="loadMore">
        <footer slot="no-results" class="page footer status-text">
            No deleted items found.
        </footer>
        <footer slot="no-more" class="page footer status-text">
            No more deleted items.
        </footer>
    </LoadMore>
</main>
</template>

<script lang="ts">
import Vue, {PropType} from 'vue';
import LoadMore, {StateChanger} from 'vue-infinite-loading';

import launch from '../launch-vue';
import ui_model from '../ui-model';
import {Model} from '../model';
import * as DI from '../model/deleted-items';
import { logErrors } from '../util';

const date_formatter = new Intl.DateTimeFormat();

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

    computed: {
        record_groups(): {title: string, records: DI.Deletion[]}[] {
            const ret: {title: string, records: DI.Deletion[]}[] = [];
            let cutoff = this.startOfToday();
            let records: DI.Deletion[] = [];

            for (const r of this.state.entries) {
                if (r.deleted_at.valueOf() < cutoff.valueOf()) {
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
    },

    methods: {
        // Dummy which is overridden in launch() below...
        model(): Model { return (<any>this).$model; },

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

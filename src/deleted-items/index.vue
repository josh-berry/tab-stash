<template>
<main>
    <PageHeader>Deleted Items</PageHeader>
    <div class="folder-list">
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
</main>
</template>

<script lang="ts">
import Vue, {PropType} from 'vue';
import launch from '../launch-vue';
import ui_model from '../ui-model';
import {State, Deletion} from '../model/deleted-items';

const date_formatter = new Intl.DateTimeFormat();

const Main = Vue.extend({
    components: {
        Bookmark: require('./bookmark.vue').default,
        ButtonBox: require('../components/button-box.vue').default,
        Folder: require('./folder.vue').default,
        ItemIcon: require('../components/item-icon.vue').default,
        PageHeader: require('../page-header.vue').default,
    },

    props: {
        state: Object as PropType<State>,
    },

    computed: {
        record_groups(): {title: string, records: Deletion[]}[] {
            const ret: {title: string, records: Deletion[]}[] = [];
            let cutoff = this.startOfToday();
            let records: Deletion[] = [];

            for (const r of Array.from(this.state.entries).reverse()) {
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
    };
});
</script>

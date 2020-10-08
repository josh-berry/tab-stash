<template>
<main :class="$style.main">
    <header>
        <h1>Deleted Items</h1>
    </header>
    <div v-for="rec of sorted_records" :key="rec.key">
        <div v-if="! rec.item.children">
            <a :href="rec.item.url">{{rec.item.title}}</a>
        </div>
        <div v-else>
            <div>{{rec.item.title}}</div>
            <ul>
                <li v-for="child of rec.item.children" :key="child.url">
                    <a :href="child.url">{{child.title}}</a>
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
import {Deletion} from '../model/deleted-items';

const Main = Vue.extend({
    components: {},

    props: {
        records: Array as PropType<Deletion[]>
    },

    computed: {
        sorted_records() {
            return Array.from(this.records).sort((a, b) =>
                b.deleted_at.valueOf() - a.deleted_at.valueOf());
        },
    },
});

export default Main;

launch(Main, async() => {
    const model = await ui_model();
    return {
        propsData: {
            records: model.state.deleted_items.entries,
        },
        provide: {
            $model: model,
        },
    };
});
</script>

<style module>
/* override tab-stash.css */
:global(.folder .contents) {
    user-select: text;
    -moz-user-select: text;
}
</style>

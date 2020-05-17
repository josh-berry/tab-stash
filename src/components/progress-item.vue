<template>
    <div :class="{'progress-item': true, [$style.toplevel]: true}">
        <span :class="$style.item">
            <progress :class="$style.progress"
                      :max="progress.max" :value="progress.value" />
            <label :class="$style.status">{{progress.status}}</label>
        </span>
        <ul v-if="progress.children.length > 0" :class="$style.children">
            <Self v-for="c of progress.children" :key="c.id" :progress="c" />
        </ul>
    </div>
</template>

<script lang="ts">
import Vue, { VueConstructor } from 'vue';

const Self = (): Promise<{default: VueConstructor}> =>
    import('./progress-item.vue');

export default Vue.extend({
    components: {
        Self,
    },
    props: {
        progress: Object,
    },
});
</script>

<style module>
.toplevel, .children {
    display: grid;
    grid-template-columns: 1fr;
}
.item {
    display: grid;
    grid-template-columns: 1fr 2fr;
}

.progress { min-width: 32px; }

.status {
    display: inline-block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: inherit;
}
</style>

<template>
    <div :class="{'progress-item': true, [$style.toplevel]: true}">
        <span :class="$style.item">
            <progress :class="$style.progress"
                      :max="task.max" :value="task.value" />
            <label :class="$style.status">{{task.status}}</label>
        </span>
        <ul v-if="task.children.length > 0" :class="$style.children">
            <Self v-for="c of task.children" :key="c.id" :task="c" />
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
        task: Object,
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

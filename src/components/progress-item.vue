<template>
    <div class="progress-item">
        <div>
            <progress :max="progress.max" :value="progress.value" />
            <label>{{progress.status}}</label>
        </div>
        <ul v-if="progress.children.length > 0">
            <Self v-for="c of progress.children" :key="c.id" :progress="c" />
        </ul>
    </div>
</template>

<script lang="ts">
import {defineComponent} from 'vue';

export default defineComponent({
    name: 'Self',
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

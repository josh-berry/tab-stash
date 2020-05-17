<template>
<Dialog :class="{progress: true, [$style.progress]: true, cancellable: cancel}">
    <ProgressItem :progress="progress" />
    <button v-if="cancel" @click.prevent.stop="cancel()">
        Cancel
    </button>
</Dialog>
</template>

<script lang="ts">
import Vue from 'vue';

export default Vue.extend({
    components: {
        Dialog: require('./dialog.vue').default,
        ProgressItem: require('./progress-item.vue').default,
    },
    props: {
        cancel: Function,
        progress: Object,
    },
    methods: {
    }
});
</script>

<style module>
.progress:not(:global(.cancellable)) {
    cursor: wait;
}
.progress:global(.cancellable) {
    cursor: progress;
}

.progress > :global(.dialog) {
    display: grid;
    grid-template-rows: 1fr;
}

.task {
    display: grid;
    grid-template-columns: 1fr 1fr;
}
</style>

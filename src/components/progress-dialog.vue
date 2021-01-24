<template>
<Dialog :class="{progress: true, cancellable: cancel}">
    <ProgressItem class="toplevel" :progress="progress" />
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

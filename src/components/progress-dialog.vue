<template>
<Dialog :class="{progress: true, cancellable: cancel}"
        :backdropClass="{progress: true, cancellable: cancel}"
        @close.capture.prevent.stop="">
    <ProgressItem class="toplevel" :progress="progress" />
    <button v-if="cancel" :disabled="cancelled" :class="{'disabled': cancelled}"
            @click.prevent.stop="doCancel">
        Cancel
    </button>
</Dialog>
</template>

<script lang="ts">
import {defineComponent} from 'vue';

export default defineComponent({
    components: {
        Dialog: require('./dialog.vue').default,
        ProgressItem: require('./progress-item.vue').default,
    },
    emits: ['close'],
    props: {
        cancel: Function,
        progress: Object,
    },
    data() { return {
        cancelled: false,
    }},
    methods: {
        doCancel() {
            if (! this.cancel) return;
            this.cancel();
            this.cancelled = true;
        }
    },
});
</script>

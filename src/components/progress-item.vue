<template>
    <div class="progress-item">
        <progress :max="progress.max" :value="progress.value" />
        <label>{{progress.status}}</label>
        <ul v-if="progress.children.length > 0">
            <li v-for="c of progress.children" :key="c.id"><Self :progress="c" /></li>
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

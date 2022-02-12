<template>
    <div class="progress-item">
        <progress
            :max="progress.max !== 0 ? progress.max : undefined"
            :value="progress.max !== 0 ? progress.value : undefined" />
        <label>{{progress.status}}</label>
        <ul v-if="progress.children.length > 0">
            <li v-for="c of progress.children" :key="c.id"><Self :progress="c" /></li>
        </ul>
    </div>
</template>

<script lang="ts">
import {PropType, defineComponent} from 'vue';

import {required} from '../util';
import {Progress} from '../util/progress';

export default defineComponent({
    name: 'Self',
    props: {
        progress: required(Object as PropType<Progress>),
    },
});
</script>

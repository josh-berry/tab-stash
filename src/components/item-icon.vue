<template>
<img v-if="src" :src="src" :srcset="src + ' 2x'"
     referrerpolicy="no-referrer" alt="" />
<span v-else :class="defaultClass" />
</template>

<script lang="ts">
import {defineComponent} from 'vue';

export default defineComponent({
    props: {
        src: String,
        defaultClass: Object,
    },
});
</script>

<template>
<img v-if="src" class="icon"
     :src="src" :srcset="src + ' 2x'"
     referrerpolicy="no-referrer" alt="">
<span v-else class="icon"></span>
</template>

<script lang="ts">
import {defineComponent} from 'vue';

export default defineComponent({
    props: {
        src: String,
    },
});
</script>

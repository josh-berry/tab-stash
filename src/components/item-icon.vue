<template>
<img v-if="src" class="icon"
     :src="src" :srcset="src + ' 2x'"
     referrerpolicy="no-referrer" alt="">
<span v-else class="icon"></span>
</template>

<script lang="ts">
import Vue from 'vue';

export default Vue.extend({
    props: {
        src: String,
    },
});
</script>

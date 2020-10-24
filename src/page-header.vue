<template>
  <header>
    <h1><slot></slot></h1>

    <div>
      <a :href="pageref('stash-list.html')">&#x2190; Back to Tab Stash</a>
    </div>

    <slot name="after"></slot>
  </header>
</template>

<script lang="ts">
import Vue from 'vue';

import {pageref} from './launch-vue';

export default Vue.extend({
    methods: {
        pageref,
    },
});
</script>

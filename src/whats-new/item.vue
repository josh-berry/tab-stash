<template>
<li :title="subtext">
  <span :class="{[v.toLowerCase().replace(':', '')]: true}">{{v}}</span>
  <slot/>
  <span v-if="issue !== undefined" class="issue">
      [<span v-for="(i, idx) of issues" :key="i"><a :key="i"
          :href="`https://github.com/josh-berry/tab-stash/issues/${i}`"
          >#{{i}}</a><span v-if="idx < issues.length - 1">, </span></span>]
  </span>
</li>
</template>

<script lang="ts">
import Vue from 'vue';

export default Vue.extend({
    props: {
        v: String, // v is for "verb"
        subtext: String,
        issue: [Array, Number],
    },
    computed: {
        issues() {
            if (this.issue instanceof Array) return this.issue;
            return [this.issue];
        },
    },
});
</script>

<style>
</style>

<template>
<li :title="subtext">
  <span v-if="v" :class="{[v.toLowerCase().replace(':', '')]: true}">{{v}}</span>
  <span v-if="v">&nbsp;</span>
  <span><slot/></span>
  <span v-if="issue !== undefined" class="issue">
      [<span v-for="(i, idx) of issues" :key="i"><a :key="i"
          :href="`https://github.com/josh-berry/tab-stash/issues/${i}`"
          >#{{i}}</a><span v-if="idx < issues.length - 1">, </span></span>]
  </span>
</li>
</template>

<script lang="ts">
import {PropType, defineComponent} from 'vue';

export default defineComponent({
    props: {
        v: String, // v is for "verb"
        subtext: String,
        issue: [Array, Number] as PropType<number | number[]>,
    },
    computed: {
        issues(): number[] {
            if (this.issue instanceof Array) return this.issue;
            return [this.issue as number];
        },
    },
});
</script>

<style>
</style>

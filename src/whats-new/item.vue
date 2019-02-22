<template>
<li :title="subtext">
  <span :class="{[v.toLowerCase()]: true}">{{v}}</span>
  <slot/>
  <a v-if="issue !== undefined" class="issue"
     :href="`https://github.com/josh-berry/tab-stash/issues/${issue}`"
     >[#{{issue}}]</a>
</li>
</template>

<script>
export default {
    props: {
        v: String, // v is for "verb"
        subtext: String,
        issue: Number,
    }
}
</script>

<style>
</style>

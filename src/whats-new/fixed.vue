<template>
  <li :title="subtext"><span class="fixed">Fixed</span> <slot/></li>
</template>

<script>
export default {
    props: {subtext: String},
}
</script>

<style>
</style>

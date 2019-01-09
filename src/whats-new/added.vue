<template>
  <li :title="subtext"><span class="added">Added</span> <slot/></li>
</template>

<script>
export default {
    props: {subtext: String},
}
</script>

<style>
</style>

<template>
  <li :title="subtext"><span class="improved">Improved</span> <slot/></li>
</template>

<script>
export default {
    props: {subtext: String},
}
</script>

<style>
</style>

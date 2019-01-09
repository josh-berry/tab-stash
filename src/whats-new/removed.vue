<template>
  <li :title="subtext"><span class="removed">Removed</span> <slot/></li>
</template>

<script>
export default {
    props: {subtext: String},
}
</script>

<style>
</style>

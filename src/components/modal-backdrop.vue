<template>
<aside :class="{'modal-backdrop': true, [$style.modal]: true}"
       v-on="$listeners">
  <slot></slot>
</aside>
</template>

<script>
export default {}
</script>

<style module>
.modal {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 99;
    cursor: default;
    background: transparent;
    overflow: hidden;

    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    margin: 0;
}
</style>

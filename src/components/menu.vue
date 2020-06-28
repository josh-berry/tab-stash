<template>
<details ref="details" @toggle="toggle" @focusout="focusout">
  <summary :class="summaryClass"><slot name="summary">{{name}}</slot></summary>
  <nav ref="inner" tabIndex="0" @click="close">
    <slot></slot>
  </nav>
</details>
</template>

<script>
export default {
    props: {
        name: String,
        summaryClass: [String, Object],
    },
    methods: {
        toggle: function() {
            if (this.$refs.details.open) {
                this.$refs.details.focus({preventScroll: true});
                this.$refs.inner.scrollIntoView(
                    false, {block: 'nearest', inline: 'nearest'});
            }
        },
        focusout: function() {
            if (this.$refs.inner.closest("details:focus-within") !== this.$refs.details) {
                this.$refs.details.open = false;
            }
        },
        close: function() {
            this.$refs.details.open = false;
        },
    },
}
</script>

<style scoped>
details {
    display: inline-block;
    position: relative;
}

details > summary {
    display: inline-block;
}

details > nav {
    z-index: 100;
    position: absolute;
}

details[open] > summary::before {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 99;
    display: block;
    cursor: default;
    content: " ";
    background: transparent;
}

details:not([open]) > nav {
    display: none;
}
</style>

<template>
<details ref="details" :class="$style.details"
         @toggle="toggle" @keydown.esc.prevent="close">
  <!-- NOTE: This isn't quite the same as <modal-backdrop> because it doesn't
       contain the thing we're showing. -->
  <div :class="$style.modal" @click="close"></div>
  <summary :class="{[$style.summary]: true, [summaryClass]: true}"><slot name="summary">{{name}}</slot></summary>
  <nav ref="inner" :class="$style.nav" tabIndex="0" @click="close" @focusout="focusout">
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
                this.$refs.inner.focus({preventScroll: true});
                this.$refs.inner.scrollIntoView(
                    false, {block: 'nearest', inline: 'nearest'});
            }
        },
        focusout: function() {
            if (this.$refs.inner.closest("details:focus-within") !== this.$refs.details) {
                this.close();
            }
        },
        close: function() {
            this.$refs.details.open = false;
            // Clear focus, since otherwise we will wind up with a focus outline
            // around the <summary>.
            //this.$refs.details.blur();
        },
    },
}
</script>

<style module>
.details {
    display: inline-block;
    position: relative;
}

.summary {
    display: inline-block;
}

.nav {
    z-index: 100;
    position: absolute;
}

.details[open] > .modal {
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
</style>

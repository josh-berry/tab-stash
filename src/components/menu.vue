<template>
<details ref="details" :class="$style.details"
         @toggle="toggle" @keydown.esc.prevent.stop="close">
  <!-- NOTE: This isn't quite the same as <modal-backdrop> because it doesn't
       contain the thing we're showing. -->
  <div :class="$style.modal" @click.prevent.stop="close"></div>
  <summary :class="{[$style.summary]: true, [summaryClass]: true}"><slot name="summary">{{name}}</slot></summary>
  <nav ref="inner" :class="$style.nav" tabIndex="0" @click.stop="close" @focusout="focusout">
    <slot></slot>
  </nav>
</details>
</template>

<script lang="ts">
import Vue from 'vue';

export default Vue.extend({
    props: {
        name: String,
        summaryClass: String,
    },
    methods: {
        toggle() {
            if ((<HTMLDetailsElement>this.$refs.details).open) {
                (<HTMLElement>this.$refs.inner).focus({preventScroll: true});
                (<HTMLElement>this.$refs.inner).scrollIntoView(
                    {block: 'nearest', inline: 'nearest'});
            }
        },
        focusout() {
            if ((<HTMLElement>this.$refs.inner).closest("details:focus-within")
                    !== this.$refs.details)
            {
                this.close();
            }
        },
        close() {
            (<HTMLDetailsElement>this.$refs.details).open = false;
        },
    },
});
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

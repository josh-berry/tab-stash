<template>
<details ref="details" :open="open" :class="{
            [$style.details]: true, [horizontal]: true, [vertical]: true,
         }"
         @toggle="onToggle" @keydown.esc.prevent.stop="close"
         @click.prevent.stop="toggle">

  <!-- NOTE: The above non-standard click handling is needed to prevent clicks
       on the <summary> from propagating out of the <details> (and no, putting a
       handler on the <summary> itself doesn't work in FF at least, which is
       mystifying...) -->

  <!-- NOTE: This isn't quite the same as <modal-backdrop> because it doesn't
       contain the thing we're showing. -->
  <div v-if="open" :class="$style.modal" tabindex="-1" @click.prevent.stop="close" />

  <summary ref="summary" :class="{[$style.summary]: true, [summaryClass]: true}">
    <slot name="summary">{{name}}</slot>
  </summary>

  <div v-if="open" ref="bounds" :style="bounds" :class="{
            'menu-bounds': true, [$style.bounds]: true,
            [vertical]: true, [horizontal]: true
        }">
    <nav ref="menu" :class="$style.menu" tabIndex="0"
         @click.stop="close" @focusout="onFocusOut">
      <slot></slot>
    </nav>
  </div>

</details>
</template>

<script lang="ts">
import {defineComponent} from 'vue';

export default defineComponent({
    props: {
        name: String,
        summaryClass: String,
    },

    data: () => ({
        viewport: undefined as DOMRect | undefined,
        origin: undefined as DOMRect | undefined,
        vertical: 'below' as 'above' | 'below',
        horizontal: 'left' as 'left' | 'right',
        open: false,
    }),

    computed: {
        vertical_bound(): string {
            if (this.vertical === 'below') {
                return `padding-top: ${this.origin?.bottom || 0}px;`;
            } else {
                return `padding-bottom: ${this.viewport!.height - this.origin!.top}px;`;
            }
        },
        horizontal_bound(): string {
            if (this.horizontal === 'left') {
                return `padding-left: ${this.origin?.left}px;`;
            } else {
                return `padding-right: ${this.viewport!.width - this.origin!.right}px;`;
            }
        },
        bounds(): string {
            return `${this.horizontal_bound} ${this.vertical_bound}`;
        },
    },

    methods: {
        updatePosition() {
            const summary = this.$refs.summary as HTMLElement;

            this.viewport = document.body.getBoundingClientRect();
            const pos = summary.getBoundingClientRect();
            const center = {
                x: this.viewport.width / 2,
                y: this.viewport.height / 2,
            };

            this.origin = pos;
            this.vertical = pos.bottom < center.y ? 'below' : 'above';
            this.horizontal = pos.right < center.x ? 'left' : 'right';
        },

        toggle() {
            // Do this first to avoid flickering
            this.updatePosition();
            this.open = ! this.open;
        },

        close() {
            this.open = false;
        },

        onToggle() {
            this.open = (<HTMLDetailsElement>this.$refs.details).open;
            if (this.open) {
                // Just in case it was opened by some other means than toggle()
                this.updatePosition();
                this.$emit('open');
            } else {
                this.$emit('close');
            }
        },

        onFocusOut() {
            if ((<HTMLElement>this.$refs.menu).closest("details:focus-within")
                    !== this.$refs.details)
            {
                this.close();
            }
        },
    },
});
</script>

<style module>
.details { display: inline-block; }
.summary { display: inline-block; }

.modal {
    position: fixed;
    left: 0;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 99;

    display: block;
    cursor: default;
    content: " ";
    background: transparent;
}

.bounds {
    position: fixed;
    left: 0;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 100;

    overflow: hidden;
    box-sizing: border-box;
    display: grid;
    grid-template-rows: 1fr;
    grid-template-columns: 1fr;
}
.bounds:global(.above) { align-items: end; }
.bounds:global(.below) { align-items: start; }
.bounds:global(.left) { justify-items: start; }
.bounds:global(.right) { justify-items: end; }

.menu {
    box-sizing: border-box;
    max-width: 100%;
    max-height: 100%;
}
</style>

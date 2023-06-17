<template>
  <details
    ref="details"
    :open="isOpen"
    :class="{
      [$style.details]: true,
      above: vertical === 'above',
      below: vertical === 'below',
      left: horizontal === 'left',
      right: horizontal === 'right',
    }"
    @toggle="onToggle"
    @click.prevent.stop="open"
  >
    <summary
      ref="summary"
      :class="{[$style.summary]: true, [summaryClass ?? '']: true}"
      tabindex="0"
    >
      <slot name="summary">{{ name }}</slot>
    </summary>

    <component
      v-if="isOpen || persist"
      :is="inPlace ? 'div' : 'teleport'"
      to="body"
    >
      <div
        :style="isOpen ? '' : 'display: none'"
        :class="{
          [$style.modal]: true,
          'menu-modal': true,
          [modalClass ?? '']: true,
        }"
        tabindex="-1"
        @keydown.esc.prevent.stop="close"
        @click.prevent.stop="close"
      >
        <div
          ref="bounds"
          :style="bounds"
          :class="{
            'menu-bounds': true,
            [$style.bounds]: true,
            above: vertical === 'above',
            below: vertical === 'below',
            left: horizontal === 'left',
            right: horizontal === 'right',
          }"
        >
          <nav
            ref="menu"
            :class="$style.menu"
            tabIndex="0"
            @click.stop="close"
            @focusout="onFocusOut"
          >
            <slot></slot>
          </nav>
        </div>
      </div>
    </component>
  </details>
</template>

<script lang="ts">
import {Teleport, defineComponent, type Component, type PropType} from "vue";

export default defineComponent({
  components: {
    // Cast: work around https://github.com/vuejs/vue-next/issues/2855
    Teleport: Teleport as unknown as Component,
  },

  props: {
    name: String,
    summaryClass: String,
    modalClass: String,
    inPlace: Boolean,
    persist: Boolean,
    hPosition: String as PropType<"left" | "right">,
    vPosition: String as PropType<"above" | "below">,
  },

  data: () => ({
    viewport: undefined as DOMRect | undefined,
    origin: undefined as DOMRect | undefined,
    vertical: undefined as "above" | "below" | undefined,
    horizontal: undefined as "left" | "right" | undefined,
    isOpen: false,
  }),

  computed: {
    vertical_bound(): string {
      if (this.vertical === "below") {
        return `padding-top: ${this.origin?.bottom || 0}px;`;
      } else {
        return `padding-bottom: ${this.viewport!.height - this.origin!.top}px;`;
      }
    },
    horizontal_bound(): string {
      if (this.horizontal === "left") {
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
      const focus = {
        x: this.viewport.width / 2,
        y: (2 * this.viewport.height) / 3,
      };

      this.origin = pos;
      this.vertical =
        this.vPosition ?? (pos.bottom < focus.y ? "below" : "above");
      this.horizontal =
        this.hPosition ?? (pos.right < focus.x ? "left" : "right");
    },

    open() {
      // Do this first to avoid flickering
      this.updatePosition();
      this.isOpen = true;
      this.$nextTick(() => {
        // Make sure the focus is within the menu so we can detect when
        // focus leaves the menu, and close it automatically.
        (<HTMLElement>this.$refs.menu).focus();
        this.$emit("open");
      });
    },

    close() {
      // Move the focus out of the menu before we try to close it,
      // otherwise Firefox gets confused about where the focus is and will
      // forget to turn off :focus-within attributes on some parent
      // elements... (this seems to be a Firefox bug)
      (<HTMLElement>this.$refs.summary).focus();
      this.$nextTick(() => {
        this.isOpen = false;
        this.vertical = undefined;
        this.horizontal = undefined;
        this.$emit("close");
        (<HTMLElement>this.$refs.summary).blur();
      });
    },

    onToggle() {
      const details = this.$refs.details as HTMLDetailsElement;
      if (details.open) {
        this.open();
      } else {
        this.close();
      }
    },

    onFocusOut() {
      if ((<any>globalThis).close_menu_on_blur === false) return;
      const menu = this.$refs.menu as HTMLElement;
      const bounds = this.$refs.bounds as HTMLElement;
      if (menu.closest(".menu-bounds:focus-within") !== bounds) {
        this.close();
      }
    },
  },
});
</script>

<style module>
.details {
  display: inline-block;
}
.summary {
  display: inline-block;
}

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
  overflow: hidden;
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
.bounds:global(.above) {
  align-items: end;
}
.bounds:global(.below) {
  align-items: start;
}
.bounds:global(.left) {
  justify-items: start;
}
.bounds:global(.right) {
  justify-items: end;
}

.menu {
  box-sizing: border-box;
  max-width: 100%;
  max-height: 100%;
}
</style>

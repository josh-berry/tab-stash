<template>
  <section class="feature-flag">
    <label :for="name"
      ><h5>
        <slot name="summary" />&nbsp;
        <span v-if="issue !== undefined" class="issue"
          >[<a :href="`https://github.com/josh-berry/tab-stash/issues/${issue}`"
            >#{{ issue }}</a
          >]</span
        >
      </h5></label
    >
    <input
      type="checkbox"
      :name="name"
      :id="name"
      :checked="modelValue"
      @input="set"
    />
    <button @click="reset" :disabled="modelValue === default_value">
      Reset
    </button>
    <div><slot /></div>
  </section>
</template>

<script lang="ts">
import {defineComponent} from "vue";
export default defineComponent({
  emits: ["update:modelValue"],

  props: {
    name: String,
    modelValue: Boolean,
    default_value: Boolean,
    issue: Number,
  },

  methods: {
    set(ev: InputEvent) {
      this.$emit("update:modelValue", (<HTMLInputElement>ev.target).checked);
    },
    reset() {
      this.$emit("update:modelValue", this.default_value);
    },
  },
});
</script>

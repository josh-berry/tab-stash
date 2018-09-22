<template>
<input v-if="editing" type="text" :class="classes"
       :value="value" :placeholder="defaultValue" :disabled="disabled"
       ref="input"
       @dragenter.stop="" @dragover.stop="" @mousedown.stop=""
       @pointerdown.stop="" @touchstart.stop="" @click.stop=""
       @dblclick.stop="" @altclick.stop=""
       @blur="commit" @keyup.enter.prevent="commit"
       @keyup.esc.prevent="editing = false">
<span v-else :class="classes" :title="value !== '' ? value : defaultValue"
      @click.prevent.stop="begin">{{value !== '' ? value : defaultValue}}</span>
</template>

<script>
export default {
    props: {
        // Whether to allow editing or not
        enabled: Boolean,

        // CSS classes to apply to the editable label, which is either a <span>
        // or <input> element.
        classes: [Object, String],

        // The value to show
        value: String,

        // The value to show if no value is provided
        defaultValue: String,
    },

    data: () => ({
        editing: false,
        oldValue: undefined,
        newValue: undefined,
    }),

    computed: {
        disabled: function() {
            // We disable the text box if we're in the middle of an update
            // operation...
            return this.oldValue !== undefined
                // ...and we haven't seen a change in the model yet.
                && this.value === this.oldValue;
        }
    },

    updated: function() {
        // If we are just now showing the text box, make sure it's focused so
        // the user can start typing.
        if (this.$refs.input && ! this.disabled) this.$refs.input.focus();

        // All of this convoluted logic is to prevent the user from seeing a
        // momentary switch back to the "old" value before the model has
        // actually been updated.  Basically we save and show the user the new
        // value they entered (/newValue/), but with the text box disabled,
        // until we see SOME change to the actual model value (regardless of
        // what it is).
        //
        // At that point, we discard the old and new values and use whatever the
        // model provides, resetting our state to "not editing".
        if (this.editing
            && this.oldValue !== undefined
            && this.oldValue !== this.value)
        {
            this.editing = false;
            this.oldValue = undefined;
            this.newValue = undefined;
        }
    },
    methods: {
        begin: function() {
            if (! this.enabled) return;
            this.editing = true;
        },
        commit: function() {
            if (this.$refs.input.value === this.value) {
                this.editing = false;
                return;
            }

            // This convoluted logic saves the old value (so we know when the
            // model has been changed), and the new value (so we can continue to
            // display it to the user), and then disables the text box and fires
            // the event.  At some time later, we expect something to magically
            // update the model, and the logic in "upddated" above will kick in
            // and move us back to not-editing state.
            this.oldValue = this.value;
            this.newValue = this.$refs.input.value;
            this.$emit('update:value', this.newValue);
        },
    },
};
</script>

<style>
</style>

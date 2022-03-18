<template>
<input v-if="state != 'displaying'" ref="input" type="text"
       :value="editableValue" :placeholder="defaultValue" :disabled="state != 'editing'"
       @mousedown.stop="; /* prevent parent from starting a drag */"
       @blur="commit" @keyup.enter.prevent="commit"
       @keyup.esc.prevent="cancel">
<span v-else :title="tooltipOrDisplayValue" @click.prevent.stop="begin">
    {{displayValue}}
</span>
</template>

<script lang="ts">
import {defineComponent, PropType, nextTick} from 'vue';

import {required} from '../util';

export default defineComponent({
    props: {
        /** If provided, the async function to call to do an edit.  Otherwise,
         * editing is disabled. */
        edit: Function as PropType<(newValue: string) => Promise<void>>,

        /** The value to show */
        value: String,
        tooltip: String,

        /** The value to show if no value is provided */
        defaultValue: required(String),
    },

    data: () => ({
        state: 'displaying' as 'displaying' | 'editing' | 'committing',
        dirtyValue: undefined as string | undefined,
    }),

    computed: {
        displayValue(): string {
            return this.dirtyValue ?? this.value ?? this.defaultValue;
        },
        editableValue(): string {
            return this.dirtyValue ?? this.value ?? '';
        },
        tooltipOrDisplayValue(): string {
            return this.tooltip ?? this.displayValue;
        },
    },

    watch: {
        value() {
            // Whenever the actual value changes, we want to clear the
            // dirtyValue, so we go back to using the actual value (and always
            // show the most up-to-date info to the user).
            //
            // This is more of a safety net and should only be needed in rare
            // corner cases (e.g. we see an update while in the process of
            // editing/committing).
            this.dirtyValue = undefined;
        },
    },

    methods: {
        begin() {
            if (! this.edit) return;
            this.state = 'editing';
            void nextTick().then(() => { (this.$refs.input as HTMLInputElement).focus(); });
        },
        cancel() {
            if (this.state !== 'editing') return;
            this.state = 'displaying';
        },
        commit() {
            if (this.state !== 'editing') return;
            const inp = this.$refs.input as HTMLInputElement;
            if (! this.edit || inp.value === this.value) {
                this.cancel();
                return;
            }

            // Save the dirty value so it's visible to the user, and move into
            // 'committing' state (where the input box is still editable but
            // disabled).
            this.dirtyValue = inp.value;
            this.state = 'committing';

            // When the edit operation completes, we go back into 'displaying'
            // state and clear `dirtyValue`.  Note that we wait a tick for the
            // underlying model (and thus `value`) to be updated first, so that
            // the user doesn't see any flickering back to the original value.
            this.edit(this.dirtyValue)
                .catch(console.log)
                .finally(nextTick)
                .finally(() => {
                    this.dirtyValue = undefined;
                    this.state = 'displaying';
                });
        },
    },
});
</script>

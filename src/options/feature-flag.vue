<template>
    <li class="feature-flag">
        <label :for="name"><h5><slot name="summary"/></h5></label>
        <input type="checkbox" :name="name" :id="name"
               :checked="value" @input="set" />
        <button @click="reset" :disabled="value === default_value">Reset</button>
        <div><slot/></div>
    </li>
</template>

<script lang="ts">
import Vue from 'vue'
export default Vue.extend({
    model: {
        prop: 'value',
        event: 'input',
    },

    props: {
        name: String,
        value: Boolean,
        default_value: Boolean,
    },

    methods: {
        set(ev: InputEvent) {
            this.$emit('input', (<HTMLInputElement>ev.target).checked);
        },
        reset() {
            this.$emit('input', this.default_value);
        },
    },
})
</script>

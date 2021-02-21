<template>
    <li :class="$style.flag">
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

<style module>
.flag {
    display: grid;
    grid-template-columns: 1fr 0fr 0fr;
    align-items: center;
}
.flag > label {
    grid-row: 1;
    grid-column: 1;
}
.flag > input {
    grid-row: 1;
    grid-column: 2;
}
.flag > button {
    grid-row: 1;
    grid-column: 3;
}
.flag > div {
    grid-row: 2;
    grid-column: 1;
}
</style>

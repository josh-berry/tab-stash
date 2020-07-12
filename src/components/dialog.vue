<template>
    <ModalBackdrop @click="$emit('close')"
                   @keydown.esc.prevent.stop="$emit('close')">
        <div ref="dialog" class="dialog" v-bind="$attrs" v-on="$listeners"
             @click.stop="">
            <slot></slot>
        </div>
    </ModalBackdrop>
</template>

<script lang="ts">
import Vue from 'vue';

export default Vue.extend({
    components: {
        ModalBackdrop: require('./modal-backdrop.vue').default,
    },
    inheritAttrs: false,
});
</script>

<template>
    <ModalBackdrop :class="backdropClass" @click="$emit('close')"
                   @keydown.esc.prevent.stop="$emit('close')">
        <div ref="dialog" class="dialog" v-bind="$attrs" @click.stop="">
            <slot></slot>
        </div>
    </ModalBackdrop>
</template>

<script lang="ts">
import {defineComponent, PropType} from 'vue';

export default defineComponent({
    components: {
        ModalBackdrop: require('./modal-backdrop.vue').default,
    },
    emits: ['close'],
    props: {
        backdropClass: Object as PropType<{[k: string]: boolean}>,
    },
    inheritAttrs: false,
});
</script>

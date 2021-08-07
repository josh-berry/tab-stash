<template>
    <ModalBackdrop :class="backdropClass" @click="close"
                   @keydown.esc.prevent.stop="close">
        <aside ref="dialog" class="dialog" v-bind="$attrs" @click.stop="">
            <header class="dialog-title" v-if="$slots.title || ! preventClosing">
                <slot name="title"></slot>
                <slot name="close" v-if="! preventClosing">
                    <button class="dialog-close" title="Close"
                            @click.prevent.stop="close" />
                </slot>
            </header>
            <section class="dialog-content">
                <slot></slot>
            </section>
            <footer class="dialog-buttons" v-if="$slots.buttons">
                <slot name="buttons"></slot>
            </footer>
        </aside>
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
        preventClosing: Boolean,
    },

    inheritAttrs: false,

    methods: {
        close() {
            if (! this.preventClosing) this.$emit('close');
        },
    },
});
</script>

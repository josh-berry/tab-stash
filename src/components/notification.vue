<template>
<transition appear name="notification">
    <aside class="notification" v-if="! dismissed">
        <div class="contents" @click.prevent.stop="activate">
            <slot></slot>
        </div>
        <ButtonBox>
            <Button class="cancel" name="Dismiss" tooltip="Dismiss notification"
                    @action="dismiss" />
        </ButtonBox>
    </aside>
</transition>
</template>

<script lang="ts">
import Vue from 'vue';
import ButtonBox from './button-box.vue';
import Button from './button.vue';

export default Vue.extend({
    components: {ButtonBox, Button},

    props: {
        onActivate: Function,
        onDismiss: Function,
    },

    data: () => ({
        dismissed: false,
    }),

    methods: {
        activate(ev: MouseEvent) {
            this.$emit('activate');
        },

        dismiss(ev: MouseEvent) {
            this.$emit('dismiss');
            this.dismissed = true;
        },
    },
});
</script>

<style>

</style>

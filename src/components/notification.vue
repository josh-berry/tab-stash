<template>
<aside class="notification" v-if="! dismissed">
    <div class="contents" @click.prevent.stop="activate">
        <slot></slot>
    </div>
    <ButtonBox>
        <Button class="cancel" name="Dismiss" tooltip="Dismiss notification"
                @action="dismiss" />
    </ButtonBox>
</aside>
</template>

<script lang="ts">
import {defineComponent} from 'vue';

export default defineComponent({
    components: {
        ButtonBox: require('./button-box.vue').default,
        Button: require('./button.vue').default,
    },

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

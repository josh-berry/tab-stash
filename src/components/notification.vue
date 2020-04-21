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

<script>
import ButtonBox from './button-box.vue';
import Button from './button.vue';

export default {
    components: {ButtonBox, Button},

    props: {
        onActivate: Function,
        onDismiss: Function,
    },

    data: () => ({
        dismissed: false,
    }),

    methods: {
        activate: function(ev) {
            this.$emit('activate');
        },

        dismiss: function(ev) {
            this.$emit('dismiss');
            this.dismissed = true;
        },
    },
}
</script>

<style>

</style>

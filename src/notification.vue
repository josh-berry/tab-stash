<template>
<aside class="notification" v-if="! dismissed">
  <div class="contents" @click.prevent.stop="activate">
    <slot></slot>
  </div>
  <ButtonBox>
    <img src="icons/cancel.svg" class="action cancel"
         title="Dismiss notification"
         @click.prevent.stop="dismiss">
  </ButtonBox>
</aside>
</template>

<script>
import ButtonBox from './button-box.vue';

export default {
    components: {
        ButtonBox,
    },

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
            this.dismissed = true;
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

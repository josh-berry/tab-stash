<template>
  <section :class="{folder: true,
                    'action-container': true,
                    collapsed: is_collapsed}">
    <div class="panel-section-header">
      <div class="header">
        <span class="folder-name">Version {{v}}</span>
        <ButtonBox class="collapse-btnbox">
          <img :src="`icons/collapse-${is_collapsed ? 'closed' : 'open'}.svg`"
               :class="{action: true, collapse: true}"
               @click.prevent.stop="collapsed = ! is_collapsed">
        </ButtonBox>
      </div>
    </div>
    <ul class="contents">
      <slot/>
    </ul>
  </section>
</template>

<script>
import ButtonBox from '../button-box.vue';

export default {
    components: {ButtonBox},
    props: {v: String},
    data: () => ({collapsed: undefined}),
    computed: {
        is_collapsed: function() {
            // XXX fill me in
            return this.collapsed;
        },
    },
}
</script>

<style>
</style>

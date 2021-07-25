<template>
  <section :class="{folder: true,
                    'action-container': true,
                    collapsed: is_collapsed}">
    <header>
      <span class="folder-name">Version {{v}}</span>
      <Button :class="{collapse: ! is_collapsed, expand: is_collapsed}"
              @action="collapsed = ! is_collapsed" />
    </header>
    <ul class="contents">
      <slot/>
    </ul>
  </section>
</template>

<script lang="ts">
import {cmpVersions} from '../util';

export default {
    components: {
        ButtonBox: require('../components/button-box.vue').default,
        Button: require('../components/button.vue').default,
    },
    props: {v: String},
    inject: ['the_last_notified_version'],
    data: () => ({collapsed: undefined}),
    computed: {
        is_collapsed: function(this: any): boolean {
            if (this.collapsed !== undefined) return this.collapsed;
            return this.the_last_notified_version !== undefined
                && cmpVersions(this.v, this.the_last_notified_version) <= 0;
        },
    },
}
</script>

<style>
</style>

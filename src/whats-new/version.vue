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
import {defineComponent} from 'vue';
import {cmpVersions, required} from '../util';

export default defineComponent({
    components: {
        ButtonBox: require('../components/button-box.vue').default,
        Button: require('../components/button.vue').default,
    },

    props: {v: required(String)},
    inject: ['last_notified_version'],
    data: () => ({collapsed: undefined as boolean | undefined}),

    computed: {
        is_collapsed(): boolean {
            const version = (<any>this).last_notified_version as string;

            if (this.collapsed !== undefined) return this.collapsed;
            return version !== undefined && cmpVersions(this.v, version) <= 0;
        },
    },
});
</script>

<style>
</style>

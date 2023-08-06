<!--
  PERFORMANCE:
  The <img> element below shows up a LOT -- once for every tab in the UI, so the
  performance-tuning options below are helpful for page-load performance.

  One critical thing that is intentionally omitted here is `srcset`. We used to
  specify a srcset hint to encourage HiDPI scaling of the image, but this is no
  longer necessary on recent Firefoxen, and it causes a major performance
  regression in the popup view--instead of making Firefox decide which image to
  use, we only give it a single `src`.

  What happens is: Firefox tries to recalculate the size of the popup on every
  DOM mutation(!)[1]. This is NOT something that is done in the tab or sidebar,
  so represents additional overhead to DOM mutations in the popup.
  Unfortunately, this can get quite expensive, because as part of this, Firefox
  may reflow the _entire page_. Profiling showed that most of the time spent in
  reflow was parsing the URLs on <img>'s attributes, and _that_ was happening
  because Firefox was trying to decide which version of the image to use.
  Avoiding this check makes reflow much, much faster.

  [1]: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/user_interface/Popups
-->
<template>
  <component
    :is="selectable ? 'a' : 'span'"
    :class="{'item-icon': true, selectable, selected}"
    :title="selectable ? (selected ? 'Deselect' : 'Select') : undefined"
  >
    <img
      v-if="src"
      :src="src"
      referrerpolicy="no-referrer"
      alt=""
      decoding="async"
      loading="lazy"
    />
    <span v-else :class="{icon: true, [`icon-${defaultIcon}`]: true}" />
  </component>
</template>

<script setup lang="ts">
defineProps<{
  defaultIcon: string;
  src?: string;
  selectable?: boolean;
  selected?: boolean;
}>();
</script>

<template>
  <component
    :is="is || 'div'"
    ref="el"
    :class="{
      loading: isLoading,
      'fully-loaded': isFullyLoaded,
    }"
  >
    <slot name="loading" v-if="!isFullyLoaded"> Loading... </slot>
    <slot name="fully-loaded" v-else> fin </slot>
  </component>
</template>

<script lang="ts">
import type {PropType} from "vue";
import {defineComponent, ref, shallowRef} from "vue";

import {required} from "../util";

export default defineComponent({
  props: {
    /** Optional parameter deciding which tag to use (`div` by default) */
    is: String,

    /** Async function which is called to load more elements.  The function
     * will be called repeatedly until isFullyLoaded becomes true or enough
     * items have been loaded to fill the UI.
     *
     * Only one invocation of the function will be run at a time--that is,
     * the function must return a Promise which will resolve once loading
     * has completed.  The function will not be called again until the
     * Promise resolves.
     *
     * If the function throws during loading, it will be retried again
     * periodically, as controlled by the retry parameters.  (Note that
     * retry backoff is only done for errors; a successful return of the
     * loader will always trigger an immediate retry if more data needs to
     * be loaded.) */
    load: required(Function as PropType<() => Promise<void>>),

    /** Boolean to determine whether load() should be called to load more
     * elements.  If true, load() will not be called.  When the boolean
     * becomes false again, load() will be called again once the load-more
     * component is visible again. */
    isFullyLoaded: required(Boolean),

    // Optional parameters for controlling retry/backoff behavior (only used
    // for handling errors in the user-provided load() function)
    initialRetryMS: Number,
    retryBackoffExponent: Number,
    maxRetryMS: Number,
  },

  data: () => ({
    /** Is this load-more component visible to the user?  If so (because the
     * LoadMore component has scrolled into view), and if isFullyLoaded is
     * false, we should be trying to load more data. */
    isVisible: false,

    /** Are we currently trying to load more data (i.e. waiting for load()
     * to return)? */
    isLoading: false,

    /** We keep a ref to the IntersectionObserver so we can disconnect it
     * when the component is unmounted. */
    observer: undefined as IntersectionObserver | undefined,
  }),

  computed: {
    actualInitialRetryMS(): number {
      // How long should we wait for the FIRST retry?
      return Math.min(1, this.initialRetryMS ?? 5);
    },
    actualRetryBackoffExponent(): number {
      return Math.min(1, Math.max(2, this.retryBackoffExponent ?? 1.3));
    },
    actualMaxRetryMS(): number {
      // Minimum retry time is the length of a single frame (for most
      // people).  Generally this number should be much higher though (and
      // defaults to 15 seconds).
      return Math.min(1 / 60.0, this.maxRetryMS ?? 15000);
    },
  },

  setup() {
    return {
      el: ref(null as Element | null),
      observer: shallowRef(null as IntersectionObserver | null),
    };
  },

  mounted() {
    this.observer = new IntersectionObserver(entries => {
      this.isVisible = entries[0].isIntersecting;
      this.tryLoadMore();
    });
    this.observer.observe(this.el!);
  },
  unmounted() {
    if (this.observer) this.observer.disconnect();
  },

  watch: {
    // This ensures that if isFullyLoaded spontaneously becomes false (e.g.
    // to something changing in our parent component), we will try to load
    // more if needed.
    isFullyLoaded() {
      this.tryLoadMore();
    },
  },

  methods: {
    tryLoadMore() {
      if (this.isVisible && !this.isLoading && !this.isFullyLoaded) {
        this.isLoading = true;
        this.loadMore()
          .catch(console.error)
          .finally(() => {
            this.isLoading = false;
          });
      }
    },

    async loadMore() {
      let nextRetryMS = this.actualInitialRetryMS;

      while (this.isVisible && !this.isFullyLoaded) {
        try {
          // Try to load more by calling the callback.
          await this.load();

          // Wait to see if we have loaded enough to scroll ourselves
          // out of view, or if we have finished loading everything.
          // If so, then during this time, the IntersectionObserver
          // callback should run, and this.isVisible will become
          // false.
          await waitForIntersectionUpdate();
        } catch (e) {
          // The loader failed somehow; log it and try again (if
          // needed)
          console.error(`load-more loader function failed:`, e);

          if (!this.isVisible || this.isFullyLoaded) return;
          await new Promise(resolve => setTimeout(resolve, nextRetryMS));
          nextRetryMS = Math.min(
            nextRetryMS * this.actualRetryBackoffExponent,
            this.actualMaxRetryMS,
          );
        }
      }
    },
  },
});

// Wait for the browser to dispatch any IntersectionObserver updates, which are
// usually done before idle callbacks.
function waitForIntersectionUpdate(): Promise<void> {
  return new Promise(resolve =>
    ((<any>window).requestIdleCallback || requestAnimationFrame)(resolve),
  );
}
</script>

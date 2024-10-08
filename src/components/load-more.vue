<template>
  <component
    :is="is || 'div'"
    ref="el"
    :class="{
      loading: isLoading,
      'fully-loaded': isFullyLoaded,
    }"
  >
    <slot name="loading" v-if="!isFullyLoaded"></slot>
    <slot name="fully-loaded" v-else></slot>
  </component>
</template>

<script lang="ts">
import type {PropType} from "vue";
import {defineComponent, ref} from "vue";

import {required} from "../util/index.js";

// Shared global state; all LoadMores use the same observer, for performance
// reasons.  see:
// https://www.bennadel.com/blog/3954-intersectionobserver-api-performance-many-vs-shared-in-angular-11-0-5.htm
const callbacks = new WeakMap<
  Element,
  (e: IntersectionObserverEntry) => void
>();

const observer = new IntersectionObserver(entries =>
  entries.forEach(e => {
    const cb = callbacks.get(e.target);
    if (cb) cb(e);
  }),
);

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
  }),

  computed: {
    actualInitialRetryMS(): number {
      // How long should we wait for the FIRST retry?
      return Math.max(1, this.initialRetryMS ?? 5);
    },
    actualRetryBackoffExponent(): number {
      return Math.max(1, Math.min(2, this.retryBackoffExponent ?? 1.1));
    },
    actualMaxRetryMS(): number {
      // Minimum retry time is the length of a single frame (for most
      // people).  Generally this number should be much higher though (and
      // defaults to 15 seconds).
      return Math.max(1 / 60.0, this.maxRetryMS ?? 15000);
    },
  },

  setup() {
    return {
      el: ref(null as Element | null),
    };
  },

  mounted() {
    callbacks.set(this.el!, e => {
      this.isVisible = e.isIntersecting;
      this.tryLoadMore();
    });
    observer.observe(this.el!);
  },
  beforeUnmount() {
    // We must explicitly clear isVisible here because if we're in the middle of
    // loadMore() when the component is unmounted, AND if `!this.isFullyLoaded`
    // at unmount time, then loadMore() will continue to loop infinitely.
    this.isVisible = false;

    callbacks.delete(this.el!);
    observer.unobserve(this.el!);
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

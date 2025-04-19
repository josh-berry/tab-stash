/* c8 ignore start -- launcher shim for the live UI */

import launch from "../launch-vue.js";

import the from "../globals-ui.js";
import Main from "./index.vue";

launch(Main, async () => {
  return {
    propsData: {
      model: the.model.options,
    },
  };
});

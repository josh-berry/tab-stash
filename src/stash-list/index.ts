/* c8 ignore start -- launcher shim for the live UI */

import {init} from "../globals-ui.js";
import launch from "../launch-vue.js";

import Main from "./index.vue";

launch(Main, async () => {
  await init();

  return {
    propsData: {},
  };
});

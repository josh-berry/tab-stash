// istanbul ignore file -- launcher shim for the live UI

import launch from "../launch-vue";

import {init} from "./globals";
import Main from "./index.vue";

launch(Main, async () => {
  await init();

  return {
    propsData: {},
  };
});

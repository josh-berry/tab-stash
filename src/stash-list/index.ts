// istanbul ignore file -- launcher shim for the live UI

import {init} from "../globals-ui";
import launch from "../launch-vue";

import Main from "./index.vue";

launch(Main, async () => {
  await init();

  return {
    propsData: {},
  };
});

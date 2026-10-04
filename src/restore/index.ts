/* c8 ignore start -- launcher shim for the live UI */

import launch from "../launch-vue.js";

import {$t} from "../util/i18n.js";

import Main from "./index.vue";

launch(Main, async () => {
  const my_url = new URL(document.location.href);

  const url = my_url.searchParams.get("url");
  document.title = url ?? $t("restorePageTitle");

  return {
    propsData: {url},
  };
});

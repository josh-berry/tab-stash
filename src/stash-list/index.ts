// istanbul ignore file -- launcher shim for the live UI

import {Model} from "@/model";
import browser from "webextension-polyfill";

import launch from "../launch-vue";
import ui_model from "../ui-model";
import {resolveNamed} from "../util";

import Main from "./index.vue";

launch(Main, async () => {
  const p = await resolveNamed({
    model: ui_model(),
    ext_info: browser.management.getSelf(),
  });

  return {
    propsData: {
      my_version: p.ext_info.version,
    },
    provide: {
      $model: p.model,
      [Model.injectionKey as symbol]: p.model,
    },
    methods: {
      model() {
        return p.model;
      },
    },
  };
});

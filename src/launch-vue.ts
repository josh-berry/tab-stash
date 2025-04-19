/* c8 ignore start -- common entry point for UI pages */

// An easy way to launch a Vue application, which also applies some CSS classes
// common to every UI in Tab Stash.

import type {ExtractPropTypes, MethodOptions} from "vue";
import {createApp} from "vue";

import {asyncEvent} from "./util/index.js";
import the, {initTheGlobals} from "./globals-ui.js";

import * as Options from "./model/options.js";

export default function launch<
  C extends {props?: object; provide?: object; methods?: MethodOptions},
>(
  component: C,
  options: () => Promise<{
    propsData: Readonly<ExtractPropTypes<C["props"]>>;
    provide?: {[k: string]: any};
    methods?: MethodOptions & Partial<C["methods"]>;
  }>,
): void {
  const loc = new URL(document.location.href);

  // Enable tracing at load time if needed
  const trace = (loc.searchParams.get("trace") ?? "").split(",");
  for (const t of trace) {
    (<any>globalThis).trace[t] = true;
  }

  const loader = async function () {
    await initTheGlobals();

    document.documentElement.dataset!.view = the.view;
    document.documentElement.dataset!.browser = the.browser;
    document.documentElement.dataset!.os = the.os;

    function updateStyle(opts: Options.SyncModel) {
      document.documentElement.dataset!.metrics = opts.state.ui_metrics;
      document.documentElement.dataset!.theme = opts.state.ui_theme;
    }
    updateStyle(the.model.options.sync);
    the.model.options.sync.onChanged.addListener(updateStyle);

    const opts = await options();
    const app = createApp(
      {
        ...component,
        provide: {
          ...(component.provide ?? {}),
          ...(opts.provide ?? {}),
        },
        methods: {
          ...(component.methods ?? {}),
          ...(opts.methods ?? {}),
        },
      },
      opts.propsData,
    );
    Object.assign(<any>globalThis, {app, app_options: opts});
    app.mount("body");
  };
  window.addEventListener("load", asyncEvent(loader));
}

// Small helper function to pass our search parameters along to another sibling
// page in this extension, so the sibling page knows what environment it's in.
export function pageref(path: string): string {
  return `${path}${window.location.search}`;
}

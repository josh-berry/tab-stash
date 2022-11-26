import base from "./vite.config.base";

// In library mode (enabled by setting .lib below), Vite will not replace
// process.env, and so this will leak into code that runs in the browser.
base.define = {
  "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV),
};

base.build!.lib = {
  entry: "index.ts",
  fileName: "index",
  formats: ["cjs"],
};

export default base;

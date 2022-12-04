import base from "./vite.config.base";

base.build!.rollupOptions!.input = {
  "deleted-items": "src/deleted-items.html",
  restore: "src/restore.html",
  "stash-list": "src/stash-list.html",
  options: "src/options.html",
  "whats-new": "src/whats-new.html",
};

export default base;

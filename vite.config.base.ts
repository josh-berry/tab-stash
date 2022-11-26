import {fileURLToPath, URL} from "node:url";
import {resolve} from "path";

import vue from "@vitejs/plugin-vue";
import {type UserConfig} from "vite";

const rel = (p: string) => resolve(__dirname, p);

// https://vitejs.dev/config/
export default {
  root: "src",
  publicDir: "assets",

  clearScreen: false,

  plugins: [vue()],

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  build: {
    outDir: rel("dist"),
    sourcemap: true,
    emptyOutDir: false,
  },
} as UserConfig;

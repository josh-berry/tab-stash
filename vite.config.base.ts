import {resolve} from "path";
import {fileURLToPath, URL} from "node:url";

import {type UserConfig, defineConfig} from "vite";
import vue from "@vitejs/plugin-vue";

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

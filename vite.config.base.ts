import {fileURLToPath, URL} from "node:url";
import {resolve} from "path";

import vue from "@vitejs/plugin-vue";
import {type UserConfig} from "vite";

const rel = (p: string) => resolve(__dirname, p);

const prod = process.env.NODE_ENV === "production";

// https://vitejs.dev/config/
export default {
  root: "src",
  publicDir: "assets",

  clearScreen: false,

  plugins: [vue({isProduction: prod})],

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  build: {
    outDir: rel("dist"),
    emptyOutDir: false,

    // We don't emit source maps in production to reduce build size, and because
    // they are often not reliable for reasons I'm never able to figure out.
    sourcemap: !prod,

    // We never minify (even in production) because it produces more
    // reliable stack traces with actual names for functions.
    minify: false,

    // Remove the hash from the generated file names, because it (and ONLY it;
    // the content is the same even though it's supposedly a "content hash")
    // seems to be inconsistent from build to build depending on the path to the
    // build tree.
    rollupOptions: {
      output: {
        assetFileNames: "assets/[name].[ext]",
        chunkFileNames: "assets/[name].js",
        entryFileNames: "[name].js",
      },
    },
  },
} as UserConfig;

const path = require("path");
const glob = require('glob').sync;
const VueLoaderPlugin = require('vue-loader/lib/plugin');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
    entry: {
        "index": "./src/index.ts",
        "deleted-items": "./src/deleted-items/index.vue",
        "restore": "./src/restore.vue",
        "stash-list": "./src/stash-list/index.vue",
        "options": "./src/options.vue",
        "whats-new": "./src/whats-new/index.vue",
    },
    mode: "development",
    devtool: "eval-source-map",
    module: {
        rules: [
            {test: /\.vue$/, loader: 'vue-loader'},
            {test: /\.tsx?$/, loader: 'ts-loader',
             exclude: /node_modules/, options: {appendTsSuffixTo: [/.vue$/]}},
            {test: /\.svg$/, loader: 'file-loader'},
            {test: /\.css$/, use: [
                'vue-style-loader',
                {loader: 'css-loader', options: {
                    esModule: false, // to make css-loader 4.x work with vue
                    modules: true,
                }},
            ]},
        ],
    },
    resolve: {
        modules: [path.resolve(__dirname, 'src'), 'node_modules'],
        extensions: ['.ts', '.js', '.vue', '.json'],
        alias: {
            'vue$': 'vue/dist/vue.runtime.esm'
        },
        fallback: {
            // Don't try to polyfill crypto; we detect in random.ts whether to
            // use it or not.
            'crypto': false,
        }
    },
    plugins: [
        new VueLoaderPlugin(),
    ],

    optimization: {
        // We always enable minimization so that debug and release builds look
        // as similar as possible--have seen test failures in release builds
        // when this isn't done.
        minimize: true,

        // Enable some options for deterministic builds
        moduleIds: 'deterministic',
        chunkIds: 'deterministic',
        mangleExports: 'deterministic',
        portableRecords: true,
    },

    output: {
        path: path.resolve(__dirname, "dist"),
    }
};

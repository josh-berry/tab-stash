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
        "options": "./src/options/index.vue",
        "whats-new": "./src/whats-new/index.vue",
    },
    mode: "production",
    devtool: "source-map",
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
        // Write common code into its own file which can be loaded in multiple
        // views, to keep generated sizes down.
        splitChunks: {
            cacheGroups: {
                lib: {
                    test: /\/node_modules/,
                    name: 'lib',
                    chunks: 'all',
                },
            },
        },

        // Enable some options for deterministic builds
        portableRecords: true,
    },

    output: {
        path: path.resolve(__dirname, "dist"),
    }
};

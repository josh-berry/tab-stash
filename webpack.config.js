const path = require("path");
const glob = require('glob').sync;
const VueLoaderPlugin = require('vue-loader/lib/plugin');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
    entry: {
        "index": "./src/index.ts",
        "stash-list": "./src/stash-list/index.vue",
        "options": "./src/options.vue",
        "whats-new": "./src/whats-new/index.vue",
        "test": glob('./src/mock/**/*.ts')
            .concat(glob('./src/**/*.test.ts')),
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
                {loader: 'css-loader', options: {modules: true}},
            ]},
        ],
    },
    resolve: {
        modules: [path.resolve(__dirname, 'src'), 'node_modules'],
        extensions: ['.ts', '.js', '.vue', '.json'],
        alias: {
            'vue$': 'vue/dist/vue.runtime.esm'
        },
    },
    plugins: [
        new VueLoaderPlugin(),
    ],

    optimization: {
        minimizer: [
            new TerserPlugin({
                terserOptions: {
                    // Required because mangling names breaks fake-indexeddb.
                    mangle: false,
                },
            }),
        ],
        // We always enable minimization so that debug and release builds look
        // as similar as possible--have seen test failures in release builds
        // when this isn't done.
        minimize: true,
    },

    output: {
        path: path.resolve(__dirname, "dist"),
    }
};

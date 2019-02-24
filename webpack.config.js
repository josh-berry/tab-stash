const path = require("path");
const VueLoaderPlugin = require('vue-loader/lib/plugin');

module.exports = {
    entry: {
        "index": "./src/index.js",
        "stash-list": "./src/stash-list.js",
        "options": "./src/options.ts",
        "whats-new": "./src/whats-new.ts",
        "test": "./src/test.ts",
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
    output: {
        path: path.resolve(__dirname, "dist"),
    }
};

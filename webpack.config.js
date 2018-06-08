const path = require("path");
const VueLoaderPlugin = require('vue-loader/lib/plugin');

module.exports = {
    entry: {
        "index": "./src/index.js",
        "stash-list": "./src/stash-list.js"
    },
    mode: "development",
    module: {
        rules: [
            {test: /\.vue$/, loader: 'vue-loader'},
            {test: /\.svg$/, loader: 'file-loader'},
            {test: /\.css$/, use: [
                'vue-style-loader',
                {loader: 'css-loader', options: {modules: true}},
            ]},
        ],
    },
    resolve: {
        modules: [path.resolve(__dirname, 'src'), 'node_modules'],
        extensions: ['.js'],
    },
    plugins: [
        new VueLoaderPlugin(),
    ],
    output: {
        path: path.resolve(__dirname, "dist"),
    }
};

//@ts-check

"use strict";

const path = require("path");
const webpack = require("webpack");
require("dotenv").config();

/** @type {import('webpack').Configuration[]} */
const config = [
  // Extension host bundle (Node.js / CommonJS)
  {
    name: "extension",
    target: "node",
    mode: "none",
    entry: "./src/extension.ts",
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "extension.js",
      libraryTarget: "commonjs2",
    },
    externals: {
      vscode: "commonjs vscode",
    },
    resolve: {
      extensions: [".ts", ".js"],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: [
            {
              loader: "ts-loader",
            },
          ],
        },
      ],
    },
    plugins: [
      new webpack.DefinePlugin({
        "process.env.PPTB_SUPABASE_URL": JSON.stringify(
          process.env.PPTB_SUPABASE_URL ?? ""
        ),
        "process.env.PPTB_SUPABASE_ANON_KEY": JSON.stringify(
          process.env.PPTB_SUPABASE_ANON_KEY ?? ""
        ),
      }),
    ],
    devtool: "nosources-source-map",
    infrastructureLogging: {
      level: "log",
    },
  },
  // Webview bundle (web target)
  {
    name: "webview-connection",
    target: "web",
    mode: "none",
    entry: "./webviews/connection/src/index.tsx",
    output: {
      path: path.resolve(__dirname, "dist", "webviews"),
      filename: "connection.js",
    },
    resolve: {
      extensions: [".ts", ".tsx", ".js", ".jsx"],
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          use: [
            {
              loader: "ts-loader",
              options: {
                configFile: path.resolve(
                  __dirname,
                  "webviews/connection/tsconfig.json"
                ),
              },
            },
          ],
        },
        {
          test: /\.css$/,
          use: ["style-loader", "css-loader"],
        },
      ],
    },
    devtool: "nosources-source-map",
  },
];

module.exports = config;

// Performs a few transformations on SVG icons:
//
// - Removes the Inkscape editor metadata
// - Removes all inline styles on <path>s (added by Inkscape)
// - Applies color-scheme-sensitive styling to each <path> via CSS
//
// Run it like:
//    node process-icon.js <icon.svg>
//
// The revised SVG is printed to stdout.

import {optimize} from "svgo";
import {readFileSync} from "node:fs";

const light_theme = readFileSync(
  import.meta.dirname + "/styles/themes/light.less",
  {encoding: "utf8"},
);
const dark_theme = readFileSync(
  import.meta.dirname + "/styles/themes/dark.less",
  {encoding: "utf8"},
);

function find_css_var(v, css) {
  return css
    .split("\n")
    .find(l => l.includes(`--${v}`))
    .replace(/^.*: */g, "")
    .replace(/;.*$/g, "");
}

const light_fg = find_css_var("page-fg", light_theme);
const dark_fg = find_css_var("page-fg", dark_theme);

// Colors come from styles/themes/*.less
const CSS = `
path {
  fill: #808080;
}

@media (prefers-color-scheme: light) {
  path {
    fill: ${light_fg};
  }
}

@media (prefers-color-scheme: dark) {
  path {
    fill: ${dark_fg};
  }
}
`
  .replace(/[\r\n]+/g, " ")
  .replace(/ +/g, " ")
  .trim();

const stripStyles = {
  name: "stripStyles",
  type: "visitor",
  fn() {
    return {
      element: {
        enter(node) {
          if (node.name === "path") delete node.attributes.style;
        },
      },
    };
  },
};

const injectCSS = {
  name: "injectCSS",
  type: "visitor",
  fn() {
    return {
      element: {
        enter(node) {
          if (node.name !== "svg") return;
          node.children.unshift({
            type: "element",
            name: "style",
            attributes: {},
            children: [{type: "text", value: CSS}],
          });
        },
      },
    };
  },
};

const svg_path = process.argv[2];
const svg = readFileSync(svg_path, {encoding: "utf8"});

process.stdout.write(
  optimize(svg, {
    plugins: ["removeEditorsNSData", stripStyles, injectCSS],
  }).data,
);

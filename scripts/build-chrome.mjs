import {spawnSync} from "node:child_process";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {resolve} from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const chrome_dist = resolve(root, "dist-chrome");
const source_icons = resolve(root, "icons");

const tools = {
  less: resolve(root, "node_modules", "less", "bin", "lessc"),
  vite: resolve(root, "node_modules", "vite", "bin", "vite.js"),
};

function run_node(script, args, env = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env: {...process.env, ...env},
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

rmSync(dist, {recursive: true, force: true});
rmSync(chrome_dist, {recursive: true, force: true});
mkdirSync(dist, {recursive: true});

run_node(tools.less, [
  "--math=strict",
  "styles/index.less",
  "dist/tab-stash.css",
]);
run_node(
  tools.vite,
  ["build", "-c", "vite.config.html.ts", "-m", "production"],
  {NODE_ENV: "production"},
);
run_node(
  tools.vite,
  ["build", "-c", "vite.config.lib.ts", "-m", "production"],
  {
    NODE_ENV: "production",
  },
);

cpSync(resolve(root, "assets"), dist, {recursive: true});
mkdirSync(resolve(dist, "icons"), {recursive: true});
cpSync(source_icons, resolve(dist, "icons"), {recursive: true});

for (const [theme, color] of [
  ["light", "#222426"],
  ["dark", "#fbfbfe"],
]) {
  const target = resolve(dist, "icons", theme);
  mkdirSync(target, {recursive: true});
  for (const name of readdirSync(source_icons)) {
    if (!name.endsWith(".svg")) continue;
    const source = readFileSync(resolve(source_icons, name), "utf8");
    writeFileSync(
      resolve(target, name),
      source.replace(/style="[^"]*"/g, `style="fill:${color}"`),
    );
  }
}

copyFileSync(
  resolve(root, "assets", "manifest-chrome.json"),
  resolve(dist, "manifest.json"),
);
rmSync(resolve(dist, "manifest-chrome.json"));
cpSync(dist, chrome_dist, {recursive: true});

console.log(`Chrome extension built at ${chrome_dist}`);

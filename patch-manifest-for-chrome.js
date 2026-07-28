import manifest from "./assets/manifest.json" with {type: "json"};

if (!("permissions" in manifest)) {
  throw new Error(`permissions key missing`);
}
const permsToDrop = ["tabHide", "browserSettings", "contextualIdentities"];
manifest.permissions = manifest.permissions.filter(
  p => !permsToDrop.includes(p),
);

const icon = manifest?.browser_action?.default_icon;
if (!icon) {
  throw new Error(`browser_action.default_icon key not found`);
}
for (const k in icon) icon[k] = `icons/logo-${k}.svg`;

delete manifest.page_action;
delete manifest.sidebar_action;

manifest.options_ui.open_in_tab = true;

manifest.commands._execute_browser_action.suggested_key.default = "Alt+Shift+T";
delete manifest.commands._execute_sidebar_action;
delete manifest.commands._execute_page_action;

console.log(JSON.stringify(manifest, undefined, 2));

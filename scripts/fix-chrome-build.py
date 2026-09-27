import json
import glob
import os

print("Running Chrome post-processing fixes...")

# A. Fix locale keys: convert all '.' to '_' in messages.json files
locale_files = glob.glob('dist-chrome/_locales/*/messages.json')
for filepath in locale_files:
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    new_data = {k.replace('.', '_'): v for k, v in data.items()}
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(new_data, f, indent=2)

print(f"Patched {len(locale_files)} locale files.")

# B. Fix manifest.json: replace .svg extension references with .png
manifest_path = 'dist-chrome/manifest.json'
if os.path.exists(manifest_path):
    with open(manifest_path, 'r', encoding='utf-8') as f:
        content = f.read()
    content = content.replace('.svg', '.png')
    with open(manifest_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("Patched dist-chrome/manifest.json.")


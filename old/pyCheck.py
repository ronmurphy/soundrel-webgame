import re
import os

def get_names(filepath):
    names = set()
    if not os.path.exists(filepath):
        print(f"Warning: {filepath} not found")
        return names
    with open(filepath, 'r') as f:
        content = f.read()
        names.update(re.findall(r'function\s+([a-zA-Z0-9_$]+)', content))
        names.update(re.findall(r'class\s+([a-zA-Z0-9_$]+)', content))
    return names

old_file = '/home/brad/Documents/soundrel-webgame/old/scoundrel-full-3d.js'
new_files = [
    '/home/brad/Documents/soundrel-webgame/scoundrel-3d.js',
    '/home/brad/Documents/soundrel-webgame/game-state.js',
    '/home/brad/Documents/soundrel-webgame/ui-manager.js',
    '/home/brad/Documents/soundrel-webgame/dungeon-generator.js'
]

old_names = get_names(old_file)
new_names = set()
for f in new_files:
    new_names.update(get_names(f))

missing = sorted(list(old_names - new_names))
print(f"Old count: {len(old_names)}")
print(f"New total: {len(new_names)}")
print(f"Missing count: {len(missing)}")
print("--- START MISSING ---")
for m in missing:
    print(m)
print("--- END MISSING ---")
EOF

#!/usr/bin/fish

# Check if a file was dropped/provided
if test (count $argv) -eq 0
    echo "Usage: Drag and drop a .glb file onto this script."
    read -P "Press Enter to exit..."
    exit 1
end

for file in $argv
    # Get the base name without the extension
    set filename (string replace -r '\.glb$' '' $file)
    
    # Run gltfpack with your preferred settings
    # I've used -tw (WebP) here for easier Three.js setup, 
    # but feel free to swap back to -tc if you have KTX2 ready!
    gltfpack -i "$file" -o "$filename-web.glb" -cc -tw -si 0.9

    echo "Finished! Created $filename-web.glb"
end

# Keep terminal open to see results
read -P "Press Enter to close..."
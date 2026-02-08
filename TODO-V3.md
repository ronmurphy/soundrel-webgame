# Scoundrel V3: The 3D Tableau (TODO)

## 🏗️ Core Architecture
- [ ] Initialize Three.js Boilerplate
  - Set up Scene, Renderer, and OrthographicCamera.
  - Implement basic orbit controls (restricted to rotation/zoom).
- [ ] 3D Room Factory
  - Convert the procedural `game.rooms` data into 3D meshes (BoxGeometry).
  - Assign unique IDs to 3D meshes for raycasting.
- [ ] Waypoint System
  - Map intermediate waypoints as subtle 3D spheres.
  - Add "pulsing" emissive material to active/reachable waypoints.

## 🎨 Visuals & Immersion
- [ ] Texture Mapping
  - Load PNG parchment/stone textures via `TextureLoader`.
  - Apply spritesheet textures to room tops for that "ink and paper" feel.
- [ ] Dungeon Lighting
  - Implement a `PointLight` attached to the player (The Torch).
  - Enable `PCSS` shadows for realistic room edges.
- [ ] Transition Animations
  - Smooth camera interpolation when moving between rooms.
  - "Slide-down" or "Rise-up" animations for newly revealed rooms.

## ⚔️ Game Loop Integration
- [ ] 3D Raycasting Interaction
  - Convert mouse/touch clicks into 3D space targets.
  - Trigger V2 `enterRoom()` logic upon Mesh collision.
- [ ] Combat UI Overlay
  - Ensure the V2 CSS Modal layers perfectly on top of the 3D canvas.
  - Sync combat result VFX (Particles) to emit from 3D room coordinates.

## 🧪 Testing & Optimization
- [ ] Browser Benchmarking (Firefox vs. Chrome).
- [ ] Mobile-Friendly Three.js settings (Pixel ratio control).
- [ ] Fallback logic for low-end devices.

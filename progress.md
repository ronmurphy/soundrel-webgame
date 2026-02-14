# Scoundrel 3D: Gilded Depths - Technical Overview

This document outlines the architecture and mechanics of the "3D Tableau" version of Scoundrel, designed for developers and AI assistants.

## 🏗️ Core Architecture (Three.js)
The game uses a "Tableau" perspective (3D isometric) built with `Three.js`.
- **Rooms**: Individual boxes (`BoxGeometry`) representing dungeon chambers.
- **Enhanced Graphics**: Support for loading optimized `.glb` models for rooms, towers, and characters.
- **Map Editor**: In-game tool (`editmap(true)`) for positioning and scaling 3D assets, saving to `room_config.json`.
- **Waypoints**: Mini-spheres that act as connecting points between rooms to ensure smooth traversal paths.
- **Corridors**: Procedurally generated boxes that link Rooms and Waypoints.
- **Fog of War**: A visibility system based on `playerSprite.position`. Rooms/Corridors are revealed based on a light radius.
- **Lighting**: A dynamic `PointLight` attached to the player (Torch) provides ambient and specular feedback.
- **Atmosphere**: Dynamic fog density and lighting colors based on floor themes (Dirt, Magma, Ice, Abyss, etc.).

## 🃏 Deck & Logic
The game strictly follows a refined **44-card Scoundrel deck**:
- **Monsters**: 2-14 (Jack=11, Queen=12, King=13, Ace=14) of Clubs and Spades.
- **Weapons**: 2-10 of Diamonds.
- **Potions**: 2-10 of Hearts.
- **Merchant Pool**: Red Face Cards (J, Q, K, A of Heart/Diamond) are stored in a separate pool for Special Rooms, preventing deck depletion of mid-tier loot.

## ⚔️ Combat Mechanics
- **Slaying (Clean Kill)**: 
  - `Monster.rank < CurrentDurability`.
  - First hit with a new weapon has `Infinity` durability (can hit anything).
  - Subsequent hits must be **strictly lower** than the previously slain monster.
- **Breaking (Combat Hit)**:
  - `Monster.rank >= CurrentDurability`.
  - Weapon reduces damage but **shatters** (breaks).
  - Player returns to "Barehanded" combat.
- **Trophy Shelf**: Slain monsters are tracked in `game.slainStack` and displayed as mini-cards in the combat modal.
- **Enhanced Combat (3D)**:
  - **Perspective Shift**: Camera transitions to an over-the-shoulder view during encounters.
  - **Standees**: Enemies appear as 3D figures with animated textures.
  - **Loot**: Items appear as open chests with floating icons.
  - **Animations**: Player model performs attack/hit animations based on GLB clips.

## 🛡️ RPG Systems
- **Classes**:
  - **Knight**: High HP, starts with Armor/Weapon.
  - **Rogue**: Starts with Skeleton Key and Coin bonus.
  - **Occultist**: Low HP, starts with Spectral Lantern (Light), uses Spell cards.
- **Inventory Management**:
  - **Backpack**: 24-slot grid for storage.
  - **Hotbar**: 6-slot quick access for consumables.
  - **Paper Doll**: Equipment slots for Head, Chest, Hands, Legs, and Weapon.
  - **Anvil**: Crafting system to combine items.
- **Stats**:
  - **Armor Points (AP)**: Damage absorption pool provided by equipment.
  - **Soul Coins**: Currency for Merchants and Traps.
  - **Torch Fuel**: Resource management mechanic for visibility.

## 🔊 Audio Engine
- **SoundManager**: Custom Web Audio API implementation.
- **Procedural Fallback**: Synthesizes sound effects (beeps, drones, noise) if audio files are missing.
- **Dynamic Music**: Background music shifts based on floor depth (Floors 1-3, 4-6, 7-9).
- **Spatial Audio**: 3D positional audio for Bonfires and Torches.

## 🧩 Minigames & Puzzles
- **Lockpicking**: A laser/mirror reflection puzzle rendered on HTML5 Canvas.
- **Traps**: Encounter choices requiring resource expenditure (HP, Coins, Items) to bypass.

## 🎨 Asset Management
- **Static Assets**: 1x9 horizontal strips for regular cards (`club.png`, `heart.png`, etc.).
- **Animated Bosses**: Ranks 11-14 use 25-frame spritesheets (`assets/images/animations/*.png`). -note: all cards have animated sheets, 25 frame.
- **Dynamic Mapping**: The `getAssetData` function handles the UV coordinates and file pathing based on card type and rank.
- **GLB Models**:
  - `standee-web.glb` / `openchest-web.glb`: Generic containers for combat entities.
  - `male-web.glb` / `female-web.glb`: Player avatars (with "Evil" variants).
  - `room_*.glb`: Varied room shapes (Rect, Round, Spire, Dome).

## 🗺️ Generation & Floor Progression
- **Branching**: A frontier-based random walk generates room layouts.
- **Biomes**: 9 distinct visual themes that cycle as the player descends.
- **Guardian Lair**: The furthest room from spawn is marked `isFinal` and tinted red.
- **Story**: JSON-driven intro and ending sequences with multiple outcomes (Normal vs True Ending).
- **Gating**: The "Descend" button only appears when the player is in the cleared Final Room and the floor progress is 100% (e.g., 13/13).

---
*Developed for the Gilded Depths Project.*

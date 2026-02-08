# Scoundrel 3D: Gilded Depths - Technical Overview

This document outlines the architecture and mechanics of the "3D Tableau" version of Scoundrel, designed for developers and AI assistants.

## 🏗️ Core Architecture (Three.js)
The game uses a "Tableau" perspective (3D isometric) built with `Three.js`.
- **Rooms**: Individual boxes (`BoxGeometry`) representing dungeon chambers.
- **Waypoints**: Mini-spheres that act as connecting points between rooms to ensure smooth traversal paths.
- **Corridors**: Procedurally generated boxes that link Rooms and Waypoints.
- **Fog of War**: A visibility system based on `playerSprite.position`. Rooms/Corridors are revealed based on a light radius.
- **Lighting**: A dynamic `PointLight` attached to the player (Torch) provides ambient and specular feedback.

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

## 🎨 Asset Management
- **Static Assets**: 1x9 horizontal strips for regular cards (`club.png`, `heart.png`, etc.).
- **Animated Bosses**: Ranks 11-14 use 25-frame spritesheets (`assets/images/animations/*.png`).
- **Dynamic Mapping**: The `getAssetData` function handles the UV coordinates and file pathing based on card type and rank.

## 🗺️ Generation & Floor Progression
- **Branching**: A frontier-based random walk generates room layouts.
- **Guardian Lair**: The furthest room from spawn is marked `isFinal` and tinted red.
- **Gating**: The "Descend" button only appears when the player is in the cleared Final Room and the floor progress is 100% (e.g., 13/13).

---
*Developed for the Gilded Depths Project.*

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { SoundManager } from './sound-manager.js';
import { MagicCircleFX } from './magic-circle.js';
import { CombatTerrain, updateCombatVisibility } from './combat-mechanics.js';
import { CardDesigner } from './card-designer.js';
import BattleIsland from './battle-island.js';
import { generateDungeon, generateFloorCA, getThemeForFloor, shuffle } from './dungeon-generator.js';
import { game, SUITS, CLASS_DATA, ITEM_DATA, ARMOR_DATA, CURSED_ITEMS, createDeck, getMonsterName, getSpellName, getAssetData, getDisplayVal, getUVForCell } from './game-state.js';
import { updateUI, renderInventoryUI, spawnFloatingText, logMsg, setupInventoryUI, addToBackpack, addToHotbar, recalcAP, handleDrop, burnTrophy, getFreeBackpackSlot } from './ui-manager.js';

let roomConfig = {}; // Stores custom transforms for GLB models

const INTRO_STORY_DEFAULTS = [
    "The entrance to the Gilded Depths looms before you. Legends say a great Guardian protects the treasures within.",
    "You have prepared for this moment all your life. Your equipment is ready, your resolve is steel.",
    "But beware... the darkness is alive here. Light your torch, Scoundrel. Your destiny awaits."
];

// --- 3D RENDERING (Three.js Tableau) ---
let scene, camera, combatCamera, renderer, composer, renderPass, controls, raycaster, mouse;
let perspectiveCamera; // New camera for Immersive mode
let hTilt, vTilt, bloomPass, outlineEffect;
let playerMarker; // Crystal marker
let torchLight;
let hemisphereLight; // Soft global fill light to improve readability under fog
// let fogRings = []; // Fog ring sprites for atmospheric LOD // DEAD CODE
let roomMeshes = new Map();
let terrainMeshes = new Map();
let waypointMeshes = new Map();
let corridorMeshes = new Map();
let doorMeshes = new Map();
let decorationMeshes = []; // Store instanced meshes for cleanup
let treePositions = []; // Store tree locations for FX
let animatedMaterials = []; // Track shaders that need time updates
let hiddenDecorationIndices = new Map(); // Track hidden instances for combat
let hiddenStaticMeshes = []; // Track hidden static objects for combat bulldozer
let savedPlayerPos = new THREE.Vector3(); // Store player pos before teleporting to Battle Island
let playerMoveTween = null; // Track movement tween to stop it during combat

// Wanderer State
let wanderers = [];
const GHOST_MODELS = ['skeleton-web.glb'];
const terrainRaycaster = new THREE.Raycaster();

let globalFloorMesh = null; // Reference for terrain manipulation
// Audio State
const audio = new SoundManager();
const magicFX = new MagicCircleFX();

// Card Designer
const cardDesigner = new CardDesigner();
window.cardDesigner = cardDesigner; // Expose for HTML callbacks
window.openCardDesigner = () => cardDesigner.open();
window.editcards = () => cardDesigner.open();
window.carddesigner = () => cardDesigner.open(); // Added alias

// Expose UI helpers to window for HTML onclicks
window.burnTrophy = burnTrophy;

function preloadSounds() {
    // Placeholders - You will need to add these files to assets/sounds/
    audio.load('torch_loop', 'assets/sounds/torch.ogg');
    audio.load('bonfire_loop', 'assets/sounds/campfire.ogg');
    audio.load('card_flip', 'assets/sounds/card_flip.ogg');
    audio.load('attack_slash', 'assets/sounds/attack_slash.ogg');
    audio.load('attack_blunt', 'assets/sounds/attack_blunt.ogg');
    audio.load('bg_1', 'assets/sounds/bg_1.ogg');
    audio.load('bg_2', 'assets/sounds/bg_2.ogg');
    audio.load('bg_3', 'assets/sounds/bg_3.ogg');
    // audio.load('footstep', 'assets/sounds/footstep.ogg');
    audio.load('card_shuffle', 'assets/sounds/card_shuffle.ogg');

    // Use code-generated sounds for missing files (like torch/bonfire):
    audio.loadPlaceholders();

    // Preload Images
    preloadCardImages();
}

function preloadCardImages() {
    const images = [
        'club.png', 'spade.png', 'heart.png', 'diamond.png',
        'skull.png', 'menace.png', 'items.png', 'armor.png',
        'cards/card_frame_common.png', 'cards/card_frame_uncommon.png',
        'cards/card_frame_rare.png', 'cards/card_frame_boss.png'
    ];
    images.forEach(file => {
        const img = new Image();
        img.src = `assets/images/${file}`;
        img.onerror = () => console.error(`[Preload] Failed to load asset: assets/images/${file}`);
    });
}

let ghosts = []; // Active ghost sprites
let viewMode = 1; // 0: 2D, 1: 3D Iso (Default), 2: 3D Free/FPS
let combatCameraActive = false; // User preference for rotating camera in combat
let isAttractMode = false; // Title screen mode
let use3dModel = false; // Default to 2D sprites
let playerSprite;
let playerMesh; // 3D Model
let mixer; // Animation Mixer
let actions = {}; // Animation Actions (Idle, Walk)
let walkAnims = {
    m: { up: null, down: null },
    f: { up: null, down: null }
};
const clock = new THREE.Clock();
let globalAnimSpeed = 1.0; // Default to real-time, tune individual actions via timeScale
let isEditMode = false;
let selectedMesh = null;
let currentAxesHelper = null;
let clickStart = { x: 0, y: 0 }; // Track mouse down position for drag detection
// --- ENHANCED COMBAT GLOBALS ---
let combatGroup = new THREE.Group();
let isCombatView = false;
let savedCamState = { pos: new THREE.Vector3(), target: new THREE.Vector3(), zoom: 1 };
let combatEntities = []; // Track standees/chests for updates
const textureLoader = new THREE.TextureLoader();
const glbCache = new Map(); // Cache for loaded GLB assets
const loadingPromises = new Map(); // Deduplicate in-flight loads
const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);
const textureCache = new Map();

function loadTexture(path) {
    if (!textureCache.has(path)) {
        textureCache.set(path, textureLoader.load(path));
    }
    return textureCache.get(path);
}

function getClonedTexture(path) {
    const original = loadTexture(path);
    const clone = original.clone();
    clone.needsUpdate = true;
    // Ensure update happens when image loads
    const checkLoad = () => {
        if (original.image && original.image.complete) clone.needsUpdate = true;
        else requestAnimationFrame(checkLoad);
    };
    checkLoad();
    return clone;
}

function loadGLB(path, callback, scale = 1.0, configKey = null) {
    // Helper to setup the model instance
    const setupInstance = (modelScene) => {
        // Use SkeletonUtils to properly clone SkinnedMeshes (Player) and hierarchy
        const model = SkeletonUtils.clone(modelScene);

        model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                if (child.material) child.material.side = THREE.DoubleSide;
            }
        });

        model.scale.set(scale, scale, scale);

        if (configKey) model.userData.configKey = configKey;

        const key = configKey ? configKey.trim() : null;
        if (key && roomConfig[key]) {
            const c = roomConfig[key];
            if (c.pos) model.position.set(c.pos.x, c.pos.y, c.pos.z);
            if (c.rot) model.rotation.set(c.rot.x, c.rot.y, c.rot.z);
            if (c.scale) {
                model.scale.set(c.scale.x, c.scale.y, c.scale.z);
                // console.debug(`[GLB] Applied CONFIG scale for ${key}:`, model.scale);
            } else {
                console.debug(`[GLB] Config found but NO scale for ${key}, using default:`, scale);
            }
        } else {
            console.debug(`[GLB] Default Scale Applied for ${configKey || path}: ${scale}`);
        }
        return model;
    };

    // Check Cache
    if (glbCache.has(path)) {
        const cachedGLTF = glbCache.get(path);
        const model = setupInstance(cachedGLTF.scene);
        if (callback) callback(model, cachedGLTF.animations);
        return;
    }

    // Check In-Flight Requests
    if (loadingPromises.has(path)) {
        loadingPromises.get(path).then((gltf) => {
            const model = setupInstance(gltf.scene);
            if (callback) callback(model, gltf.animations);
        });
        return;
    }

    // console.log(`[GLB] Loading: ${path} (Scale: ${scale})`);

    const promise = new Promise((resolve, reject) => {
        gltfLoader.load(path, (gltf) => {
            glbCache.set(path, gltf);
            resolve(gltf);
        }, undefined, reject);
    });

    loadingPromises.set(path, promise);

    promise.then((gltf) => {
        loadingPromises.delete(path); // Cleanup promise
        const model = setupInstance(gltf.scene);
        if (callback) callback(model, gltf.animations);
    }).catch((error) => {
        loadingPromises.delete(path);
        console.warn(`Could not load model: ${path}`, error);
    });
}

// FX State
const fxCanvas = document.getElementById('fxCanvas');
const fxCtx = fxCanvas.getContext('2d');
let particles = [];
let weatherParticles = []; // Persistent weather system
let screenShake = { intensity: 0, duration: 0 };

// Simple object pools for particles to avoid GC churn
const particlePool = [];
const uiParticlePool = [];
const MAX_PARTICLES = 600;        // scene-level cap
const MAX_UI_PARTICLES = 400;     // UI-level cap (was previously enforced in updateUIFX)

// Throttle settings (30 fps targets)
const FX_INTERVAL = 1000 / 30;    // ms
let lastFXTime = 0;
const RENDER_INTERVAL = 1000 / 30;
let lastRenderTime = 0;

// UI FX Canvas (above modal) — used for modal combat projectiles/effects
const uiFxCanvas = document.getElementById('uiFxCanvas');
const uiFxCtx = uiFxCanvas.getContext('2d');
let uiParticles = [];

class Particle {
    constructor(x, y, color) {
        this.x = x; this.y = y;
        this.vx = (Math.random() - 0.5) * 10;
        this.vy = (Math.random() - 0.5) * 10;
        this.life = 1.0;
        this.decay = 0.02 + Math.random() * 0.02;
        this.color = color;
        this.size = 2 + Math.random() * 4;
    }
    update() {
        this.x += this.vx; this.y += this.vy;
        this.vy += 0.2; // Gravity
        this.life -= this.decay;
    }
    draw(ctx) {
        ctx.globalAlpha = this.life;
        ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2); ctx.fill();
    }
}

function spawnParticles(x, y, color, count = 20) {
    for (let i = 0; i < count; i++) particles.push(new Particle(x, y, color));
}

// --- Texture-based Image Particles (FX) ---
const fxImageCache = new Map();
function loadFXImage(name) {
    const path = `assets/images/textures/${name}`;
    if (fxImageCache.has(path)) return fxImageCache.get(path);
    const img = new Image();
    img.src = path;
    img.onload = () => { /* ready */ };
    fxImageCache.set(path, img);
    return img;
}

function preloadFXTextures() {
    const list = ['slash_02.png', 'spark_01.png', 'twirl_01.png', 'circle_03.png', 'flame_03.png', 'muzzle_02.png', 'trace_01.png'];
    list.forEach(n => loadFXImage(n));
}

// Spawn simple DOM-based UI particles that sit above the modal overlay
function spawnDOMParticles(name, x, y, count = 10, opts = {}) {
    if (use3dModel) return; // Disable in Enhanced Mode
    const container = document.createElement('div');
    container.className = 'ui-fx';
    document.body.appendChild(container);

    const imgs = [];
    for (let i = 0; i < count; i++) {
        const el = document.createElement('img');
        el.src = `assets/images/textures/${name}`;
        el.style.position = 'fixed';
        el.style.left = `${x - 24 + (Math.random() - 0.5) * (opts.spread || 60)}px`;
        el.style.top = `${y - 24 + (Math.random() - 0.5) * (opts.spread || 60)}px`;
        el.style.opacity = '0';
        el.style.transform = `scale(${0.6 + Math.random() * 0.8}) rotate(${Math.random() * 360}deg)`;
        el.style.transition = `transform ${400 + Math.random() * 400}ms cubic-bezier(0.2,0.8,0.2,1), opacity ${300 + Math.random() * 300}ms ease`;
        container.appendChild(el);
        imgs.push(el);

        // allow the browser to layout then animate
        requestAnimationFrame(() => {
            el.style.opacity = '1';
            const dx = (Math.random() - 0.5) * (opts.dx || 120);
            const dy = -30 - Math.random() * (opts.dy || 120);
            const rot = (Math.random() - 0.5) * 720;
            el.style.transform = `translate(${dx}px, ${dy}px) scale(${0.4 + Math.random() * 1.2}) rotate(${rot}deg)`;
            el.style.opacity = '0';
        });
    }

    // Cleanup
    setTimeout(() => { if (container.parentNode) container.parentNode.removeChild(container); }, opts.life || 1000);
}

// DOM-based projectile animation to be used when modal is open so projectiles appear above UI
function spawnDOMProjectile(name, fromX, fromY, toX, toY, count = 6, opts = {}) {
    // console.debug('spawnDOMProjectile', { name, fromX, fromY, toX, toY, count, opts, uiCanvasPresent: !!uiFxCanvas }); // DEBUG (commented out)
    if (use3dModel) return Promise.resolve(); // Disable in Enhanced Mode
    return new Promise(resolve => {
        const container = document.createElement('div');
        container.className = 'ui-fx ui-projectile';
        document.body.appendChild(container);

        const duration = opts.duration || 420;
        let finished = 0;
        for (let i = 0; i < Math.max(1, count); i++) {
            const el = document.createElement('img');
            el.src = `assets/images/textures/${name}`;
            const size = opts.sizeRange ? (opts.sizeRange[0] + Math.random() * (opts.sizeRange[1] - opts.sizeRange[0])) : (24 + Math.random() * 24);
            el.style.width = `${size}px`;
            el.style.height = `${size}px`;
            el.style.position = 'fixed';
            const jitter = (opts.jitter || 16);
            const sx = fromX + (Math.random() - 0.5) * jitter;
            const sy = fromY + (Math.random() - 0.5) * jitter;
            el.style.left = `${sx - size / 2}px`;
            el.style.top = `${sy - size / 2}px`;
            el.style.opacity = '1';
            el.style.transform = `translate(0px,0px) rotate(${Math.random() * 360}deg)`;
            el.style.transition = `transform ${duration + Math.random() * 120}ms cubic-bezier(0.2,0.8,0.2,1), opacity ${duration}ms linear`;
            container.appendChild(el);

            // Start movement on next frame
            requestAnimationFrame(() => {
                const dx = toX - sx + (Math.random() - 0.5) * (opts.spread || 40);
                const dy = toY - sy + (Math.random() - 0.5) * (opts.spread || 40);
                const rot = (Math.random() - 0.5) * 720;
                el.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(${0.6 + Math.random() * 0.8})`;
                el.style.opacity = '0.01';
            });

            // Cleanup per element
            setTimeout(() => {
                finished++;
                if (finished === Math.max(1, count)) {
                    if (container.parentNode) container.parentNode.removeChild(container);
                    resolve();
                }
            }, duration + 160);
        }
    });
}


class ImageParticle extends Particle {
    constructor(x, y, img, opts = {}) {
        super(x, y, null);
        this.reset(x, y, img, opts);
    }
    // Reinitialize a pooled particle (avoids allocs)
    reset(x, y, img, opts = {}) {
        this.img = img;
        this.x = x; this.y = y;
        this.rotation = Math.random() * Math.PI * 2;
        this.angularVel = (Math.random() - 0.5) * 0.2;
        this.life = 1.0;
        this.decay = opts.decay || (0.01 + Math.random() * 0.02);
        this.size = opts.size || (20 + Math.random() * 40);
        this.size *= (opts.sizeScale || 1);
        this.vx = (Math.random() - 0.5) * (opts.spread || 8);
        this.vy = (Math.random() - 0.5) * (opts.spread || 8);
        this.blend = opts.blend || 'source-over';
        this.tint = opts.tint || null;
        this.filter = opts.filter || null; // CSS filter string for ctx.filter
        this.intensity = opts.intensity || 1.0; // multiplier for alpha/brightness
        this.noGravity = opts.noGravity || false;
    }
    update() {
        this.x += this.vx; this.y += this.vy;
        if (!this.noGravity) this.vy += 0.1; // subtle gravity
        this.rotation += this.angularVel;
        this.life -= this.decay;
    }
    draw(ctx) {
        if (!this.img || !this.img.complete) return;
        ctx.save();
        // Smooth scaled sprites to avoid aliasing artifacts
        ctx.imageSmoothingEnabled = true;
        // Apply brightness/saturation via filter if provided
        if (this.filter) ctx.filter = this.filter;
        ctx.globalAlpha = Math.max(0, this.life) * Math.min(1.0, this.intensity);
        ctx.globalCompositeOperation = this.blend;
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);
        const s = this.size;
        // Draw the sprite
        ctx.drawImage(this.img, -s / 2, -s / 2, s, s);
        if (this.tint) {
            // Tint only the existing sprite pixels (no rectangular spill) using source-atop
            ctx.globalCompositeOperation = 'source-atop';
            ctx.fillStyle = this.tint;
            ctx.globalAlpha = Math.max(0, this.life) * 0.6 * this.intensity;
            ctx.fillRect(-s / 2, -s / 2, s, s);
        }
        ctx.restore();
        ctx.globalCompositeOperation = 'source-over';
        // Reset any filter applied
        ctx.filter = 'none';
    }
}

function spawnTextureParticles(name, x, y, count = 12, opts = {}) {
    if (use3dModel) return; // Disable in Enhanced Mode
    const img = loadFXImage(name);
    // Make space if we're near cap
    while (particles.length + count > MAX_PARTICLES) {
        const old = particles.shift();
        if (old) particlePool.push(old);
    }
    for (let i = 0; i < count; i++) {
        const pOpts = {
            size: opts.sizeRange ? (opts.sizeRange[0] + Math.random() * (opts.sizeRange[1] - opts.sizeRange[0])) : (opts.size || (20 + Math.random() * 40)),
            spread: opts.spread || 10,
            blend: opts.blend || 'source-over',
            tint: opts.tint || null,
            decay: opts.decay || (0.01 + Math.random() * 0.03)
        };
        // Acquire from pool when possible
        const sx = x + (Math.random() - 0.5) * (opts.spread || 40);
        const sy = y + (Math.random() - 0.5) * (opts.spread || 40);
        let p = particlePool.pop();
        if (p) p.reset(sx, sy, img, pOpts);
        else p = new ImageParticle(sx, sy, img, pOpts);
        particles.push(p);
    }
}

// UI canvas variants (draw above modal)
function spawnUITextureParticles(name, x, y, count = 12, opts = {}) {
    if (use3dModel) return; // Disable in Enhanced Mode
    const img = loadFXImage(name);
    // Make space if we're near cap
    while (uiParticles.length + count > MAX_UI_PARTICLES) {
        const old = uiParticles.shift();
        if (old) uiParticlePool.push(old);
    }
    for (let i = 0; i < count; i++) {
        const pOpts = {
            size: opts.sizeRange ? (opts.sizeRange[0] + Math.random() * (opts.sizeRange[1] - opts.sizeRange[0])) : (opts.size || (20 + Math.random() * 40)),
            spread: opts.spread || 10,
            blend: opts.blend || 'lighter', // additive by default for UI
            tint: opts.tint || null,
            decay: opts.decay || (0.01 + Math.random() * 0.03),
            filter: opts.filter || 'brightness(1.6) saturate(1.2)',
            intensity: opts.intensity || 1.25
        };
        const sx = x + (Math.random() - 0.5) * (opts.spread || 40);
        const sy = y + (Math.random() - 0.5) * (opts.spread || 40);
        let p = uiParticlePool.pop();
        if (p) p.reset(sx, sy, img, pOpts);
        else p = new ImageParticle(sx, sy, img, pOpts);
        uiParticles.push(p);
    }
}

// Helper: spawn a texture either on the UI canvas (above modal) or the scene canvas depending on modal visibility
function spawnAboveModalTexture(name, x, y, count = 12, opts = {}) {
    if (use3dModel) return; // Disable in Enhanced Mode
    const modal = document.getElementById('combatModal');
    const modalOpen = modal && (modal.style.display === 'flex' || modal.style.display === 'block');
    if (modalOpen && typeof spawnUITextureParticles === 'function' && uiFxCanvas) {
        // console.debug('spawnAboveModalTexture -> UI canvas', { name, x, y, count, opts }); // DEBUG (commented out)
        spawnUITextureParticles(name, x, y, count, opts);
    } else if (modalOpen && typeof spawnDOMParticles === 'function') {
        // console.debug('spawnAboveModalTexture -> DOM fallback', { name, x, y, count, opts }); // DEBUG (commented out)
        // Fallback to DOM particles if UI canvas isn't available
        spawnDOMParticles(name, x, y, count, opts);
    } else {
        // console.debug('spawnAboveModalTexture -> scene canvas', { name, x, y, count, opts }); // DEBUG (commented out)
        spawnTextureParticles(name, x, y, count, opts);
    }
}

function spawnUIProjectile(name, fromX, fromY, toX, toY, count = 8, opts = {}) {
    // console.debug('spawnUIProjectile', { name, fromX, fromY, toX, toY, count, opts, uiCanvasPresent: !!uiFxCanvas, uiParticlesCount: uiParticles.length }); // DEBUG (commented out)
    if (use3dModel) return Promise.resolve(); // Disable in Enhanced Mode
    const img = loadFXImage(name);
    const duration = opts.duration || 420; // ms
    const frames = Math.max(1, Math.round(duration / 16));

    for (let i = 0; i < count; i++) {
        const jitter = (opts.jitter || 20);
        const sx = fromX + (Math.random() - 0.5) * jitter;
        const sy = fromY + (Math.random() - 0.5) * jitter;
        const p = new ImageParticle(sx, sy, img, { size: opts.size || (18 + Math.random() * 32), spread: 0, blend: opts.blend || 'lighter', tint: opts.tint || null, decay: 1.0 / frames, sizeScale: 1, filter: opts.filter || 'brightness(1.6) saturate(1.3)', intensity: opts.intensity || 1.2 });
        p.vx = (toX - sx) / frames + (Math.random() - 0.5) * 2;
        p.vy = (toY - sy) / frames + (Math.random() - 0.5) * 2;
        p.noGravity = true;
        uiParticles.push(p);
    }

    // DEBUG block commented out: Quick visibility boost when debugging (window.DEBUG_UI_FX)
    // if (window.DEBUG_UI_FX) {
    //     // draw a bright test circle at center for 400ms
    //     if (uiFxCtx) {
    //         uiFxCtx.save();
    //         uiFxCtx.fillStyle = 'rgba(255,255,255,0.95)';
    //         uiFxCtx.beginPath(); uiFxCtx.arc(window.innerWidth/2, window.innerHeight/2, 48, 0, Math.PI*2); uiFxCtx.fill();
    //         uiFxCtx.restore();
    //         setTimeout(() => { // clearing will happen in next frame via updateUIFX 
    //             /* intentionally left blank - clearing occurs on next frame */
    //         }, 400);
    //     }
    // }

    return new Promise(resolve => setTimeout(() => resolve(), duration));
}

// Spawn projectiles that travel from point A to B and call onHit when they arrive
function spawnProjectile(name, fromX, fromY, toX, toY, count = 8, opts = {}) {
    if (use3dModel) return Promise.resolve(); // Disable in Enhanced Mode
    const img = loadFXImage(name);
    const duration = opts.duration || 450; // ms
    const frames = Math.max(1, Math.round(duration / 16));
    const particlesCreated = [];

    for (let i = 0; i < count; i++) {
        const jitter = (opts.jitter || 20);
        const sx = fromX + (Math.random() - 0.5) * jitter;
        const sy = fromY + (Math.random() - 0.5) * jitter;
        const pOpts = {
            size: opts.size || (12 + Math.random() * 24),
            spread: 0,
            blend: opts.blend || 'lighter',
            tint: opts.tint || null,
            decay: 1.0 / frames,
            sizeScale: 1,
            noGravity: true
        };
        const p = new ImageParticle(sx, sy, img, pOpts);
        // set velocity so particle reaches target in `frames` updates
        p.vx = (toX - sx) / frames + (Math.random() - 0.5) * 2;
        p.vy = (toY - sy) / frames + (Math.random() - 0.5) * 2;
        p.noGravity = true;
        particles.push(p);
        particlesCreated.push(p);
    }

    // Return a promise that resolves when the projectile 'arrives'
    return new Promise(resolve => setTimeout(() => resolve(), duration));
}

// Small full-screen hit flash used during UI projectile hits
function spawnUIHitFlash(x, y, duration = 280) {
    // Disabled by default to avoid overpowering HP corner particles.
    // Re-enable at runtime by setting `window.HIT_FLASH_ENABLED = true` in console.
    if (window.HIT_FLASH_ENABLED === undefined) window.HIT_FLASH_ENABLED = false;
    if (use3dModel) return; // Disable in Enhanced Mode
    if (!window.HIT_FLASH_ENABLED) return;

    const el = document.createElement('div');
    el.className = 'ui-hit-flash';

    // If we're flashing directly over the HP UI, use a reduced 'small' flash
    const hitEl = document.elementFromPoint(Math.round(x), Math.round(y));
    const isOverHp = hitEl && (hitEl.closest && (hitEl.closest('#hpValueModal') || hitEl.closest('#hpValueSidebar')));
    if (isOverHp) {
        el.classList.add('small');
        duration = Math.min(duration, 140);
    }

    // set CSS variables for gradient origin
    const nx = Math.round((x / window.innerWidth) * 100);
    const ny = Math.round((y / window.innerHeight) * 100);
    el.style.setProperty('--fx-x', `${nx}%`);
    el.style.setProperty('--fx-y', `${ny}%`);
    document.body.appendChild(el);

    // Trigger show
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 240); }, duration);
}

function getElementCenter(el) {
    if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// Animate card flipping over and removing; calls cb when finished
function animateCardDeath(cardEl, cb) {
    if (!cardEl) { if (cb) cb(); return; }
    const original = cardEl.style.transition || '';
    // Add the dead-flip class which uses CSS transitions for a 3D flip
    cardEl.classList.add('dead-flip');
    // Ensure we only fire callback once
    const handler = (e) => {
        cardEl.removeEventListener('transitionend', handler);
        if (cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
        if (cb) cb();
    };
    cardEl.addEventListener('transitionend', handler);
}

// Animate an enemy card 'telegraphing' then launching an attack towards the player UI
function enemyAttackAnimation(card, cardEl, fromX, fromY, dmg, opts = {}, onComplete) {
    // Choose preset based on card value/rank
    const boss = card.val >= 11;

    // Rank-based presets (textures, projectile counts & tinting)
    const presets = {
        normal: { texs: ['scorch_03.png', 'star_04.png', 'star_08.png'], count: 8, tint: '#ffffff', blend: 'lighter' },
        jack: { texs: ['muzzle_02.png', 'spark_01.png'], count: 10, tint: '#ddd', blend: 'lighter' },
        queen: { texs: ['magic_01.png', 'magic_03.png', 'twirl_01.png'], count: 10, tint: '#ffdca8', blend: 'lighter' },
        king: { texs: ['slash_02.png', 'spark_04.png', 'trace_04.png'], count: 14, tint: '#fff6e6', blend: 'source-over' },
        ace: { texs: ['twirl_01.png', 'light_02.png', 'flare_01.png', 'magic_05.png'], count: 16, tint: '#ffeed6', blend: 'lighter' }
    };

    let preset = presets.normal;
    if (boss) {
        if (card.val === 11) preset = presets.jack;
        else if (card.val === 12) preset = presets.queen;
        else if (card.val === 13) preset = presets.king;
        else if (card.val === 14) preset = presets.ace;
    }

    const tex = preset.texs[Math.floor(Math.random() * preset.texs.length)];

    const targetEl = document.getElementById('hpValueModal') || document.getElementById('hpValueSidebar');
    const target = getElementCenter(targetEl);

    // Card telegraph animation (pop forward)
    const origTransform = cardEl.style.transform || '';
    cardEl.style.transition = 'transform 180ms cubic-bezier(0.2,0.8,0.2,1)';
    // Use different telegraph for melee-type (king) vs magic-type (queen)
    if (preset === presets.king) cardEl.style.transform = `${origTransform} translateY(-22px) scale(1.08) rotate(-8deg)`;
    else if (preset === presets.queen) cardEl.style.transform = `${origTransform} translateY(-12px) scale(1.04) rotate(-4deg)`;
    else cardEl.style.transform = `${origTransform} translateY(-18px) scale(1.06) rotate(-6deg)`;

    cardEl.style.zIndex = 2000;
    cardEl.style.pointerEvents = 'none';

    // After telegraph, fire projectile
    setTimeout(async () => {
        // Launch a quick projectile towards target
        const combatModalEl = document.getElementById('combatModal');
        const modalVisible = combatModalEl && getComputedStyle(combatModalEl).display !== 'none';
        if (modalVisible) {
            // Prefer UI-canvas projectile when available so textures render above modal
            if (uiFxCanvas && uiFxCtx) {
                await spawnUIProjectile(tex, fromX, fromY, target.x, target.y, opts.count || preset.count, { duration: 420, jitter: 18, spread: 16, sizeRange: [18, 42] });
                const hitTex = boss ? (preset === presets.queen ? 'magic_03.png' : 'twirl_01.png') : (preset === presets.king ? 'slash_02.png' : 'slash_02.png');
                spawnUITextureParticles(hitTex, target.x, target.y, Math.max(10, Math.floor((opts.count || preset.count) / 1.2)), { spread: 28, life: 900 });
            } else {
                // Fallback to DOM-based projectile so it renders above modal UI
                await spawnDOMProjectile(tex, fromX, fromY, target.x, target.y, opts.count || preset.count, { duration: 420, jitter: 18, spread: 16, sizeRange: [18, 42] });
                const hitTex = boss ? (preset === presets.queen ? 'magic_03.png' : 'twirl_01.png') : (preset === presets.king ? 'slash_02.png' : 'slash_02.png');
                spawnDOMParticles(hitTex, target.x, target.y, Math.max(10, Math.floor((opts.count || preset.count) / 1.2)), { spread: 28, life: 900 });
            }

            // Always show a UI hit flash & shake
            spawnUIHitFlash(target.x, target.y, 280);
            triggerShake(boss ? 18 : 10, boss ? 40 : 20);
        }

        // Restore card position
        cardEl.style.transform = origTransform;
        setTimeout(() => { cardEl.style.transition = ''; cardEl.style.zIndex = ''; cardEl.style.pointerEvents = ''; }, 200);

        if (onComplete) onComplete();
    }, 200);
}


function triggerShake(intensity, duration) {
    screenShake.intensity = intensity;
    screenShake.duration = duration;
}

function updateFX() {
    fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
    updateWeather(fxCtx); // Draw weather first (background)

    if (screenShake.duration > 0) {
        const sx = (Math.random() - 0.5) * screenShake.intensity;
        const sy = (Math.random() - 0.5) * screenShake.intensity;
        // Since this covers the whole screen, we can't easily shake the body without glitches,
        // but we can shake the containers. Let's shake the 3D container and Modal.
        const containers = [document.getElementById('v3-container'), document.getElementById('combatModal')];
        containers.forEach(c => {
            if (c) c.style.transform = `translate(${sx}px, ${sy}px)`;
        });
        screenShake.duration--;
        if (screenShake.duration <= 0) {
            containers.forEach(c => { if (c) c.style.transform = ''; });
        }
    }

    // Update particles with recycling to avoid allocations
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.update();
        if (p.life <= 0) {
            particles.splice(i, 1);
            particlePool.push(p);
        } else {
            p.draw(fxCtx);
        }
    }

    // Ambient Wisps
    updateWisps(fxCtx);
}

// Update UI FX (draw above modal)
function updateUIFX() {
    if (!uiFxCanvas || !uiFxCtx) return;
    uiFxCtx.clearRect(0, 0, uiFxCanvas.width, uiFxCanvas.height);

    // Basic culling/filter and cap to avoid runaway
    // Update UI particles with recycling and cap
    const MAX_UI_PARTICLES = 400; // enforce locally for safety
    while (uiParticles.length > MAX_UI_PARTICLES) {
        const old = uiParticles.shift(); if (old) uiParticlePool.push(old);
    }

    for (let i = uiParticles.length - 1; i >= 0; i--) {
        const p = uiParticles[i];
        if (!p.noGravity) p.vy += 0.1;
        p.update();
        if (p.life <= 0) {
            uiParticles.splice(i, 1);
            uiParticlePool.push(p);
        } else {
            p.draw(uiFxCtx);

            // Extra diagnostics when requested: draw bright outlines so we can see if they exist
            if (window.DEBUG_UI_FX) {
                uiFxCtx.save();
                uiFxCtx.globalCompositeOperation = 'lighter';
                uiFxCtx.strokeStyle = 'rgba(255,255,0,0.95)';
                uiFxCtx.lineWidth = 2;
                uiFxCtx.beginPath();
                uiFxCtx.arc(p.x, p.y, Math.max(6, Math.min(48, p.size / 2)), 0, Math.PI * 2);
                uiFxCtx.stroke();
                uiFxCtx.restore();
            }
        }
    }
}

// Debugging helper to inspect UI FX canvas and particles
window.debugUIFXState = function () {
    const info = {};
    info.uiFxCanvas = !!uiFxCanvas;
    if (uiFxCanvas) {
        info.canvasRect = uiFxCanvas.getBoundingClientRect();
        info.canvasSize = { width: uiFxCanvas.width, height: uiFxCanvas.height };
        info.computedStyle = window.getComputedStyle(uiFxCanvas).zIndex;
    }
    info.particleCount = uiParticles.length;
    info.modalOpen = (document.getElementById('combatModal') && getComputedStyle(document.getElementById('combatModal')).display !== 'none');
    info.sample = uiParticles.slice(0, 8).map(p => ({ x: Math.round(p.x), y: Math.round(p.y), size: Math.round(p.size), life: Number(p.life.toFixed(2)), imgLoaded: (p.img && p.img.complete) }));
    // console.debug('debugUIFXState', info); // DEBUG (commented out)

    return info;
};

let wisps = [];
class Wisp {
    constructor() {
        this.x = Math.random() * fxCanvas.width;
        this.y = Math.random() * fxCanvas.height;
        this.vx = (Math.random() - 0.5) * 0.5;
        this.vy = (Math.random() - 0.5) * 0.5;
        this.size = Math.random() * 2 + 1;
        this.color = Math.random() > 0.5 ? 'rgba(200, 255, 255, 0.4)' : 'rgba(255, 255, 200, 0.3)';
        this.pulse = Math.random() * Math.PI;
    }
    update() {
        this.x += this.vx; this.y += this.vy;
        this.pulse += 0.05;
        if (this.x < 0) this.x = fxCanvas.width;
        if (this.x > fxCanvas.width) this.x = 0;
        if (this.y < 0) this.y = fxCanvas.height;
        if (this.y > fxCanvas.height) this.y = 0;
    }
    draw(ctx) {
        const alpha = 0.3 + Math.sin(this.pulse) * 0.2;
        ctx.fillStyle = this.color.replace('0.4', alpha).replace('0.3', alpha);
        // Quick hack for alpha replacement, or just set globalAlpha
        ctx.globalAlpha = alpha;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1.0;
    }
}

function updateWisps(ctx) {
    if (wisps.length < 15) wisps.push(new Wisp());
    wisps.forEach(w => {
        w.update();
        w.draw(ctx);
    });
}

// --- WEATHER SYSTEM ---
let currentWeather = 'none';

function updateWeather(ctx) {
    if (currentWeather === 'none') return;

    // Spawn new particles
    if (weatherParticles.length < 150) { // Cap weather density
        const w = fxCanvas.width;
        const h = fxCanvas.height;
        
        let p = { x: Math.random() * w, y: -10, vx: 0, vy: 0, size: 1, color: '#fff', life: 1 };

        if (currentWeather === 'snow') {
            p.vx = (Math.random() - 0.5) * 1;
            p.vy = 1 + Math.random() * 2;
            p.size = 1 + Math.random() * 2;
            p.color = 'rgba(220, 240, 255, 0.6)';
        } else if (currentWeather === 'rain') {
            p.vx = -2 + Math.random(); // Slant
            p.vy = 15 + Math.random() * 5;
            p.size = 1; // Length handled in draw
            p.color = 'rgba(100, 150, 255, 0.4)';
        } else if (currentWeather === 'ember') {
            p.y = h + 10;
            p.vx = (Math.random() - 0.5) * 2;
            p.vy = -1 - Math.random() * 2;
            p.size = 1 + Math.random() * 2;
            p.color = `rgba(255, ${Math.floor(Math.random()*100)}, 0, ${0.5+Math.random()*0.5})`;
        } else if (currentWeather === 'dust' || currentWeather === 'spore') {
            p.x = Math.random() * w;
            p.y = Math.random() * h;
            p.vx = (Math.random() - 0.5) * 0.5;
            p.vy = (Math.random() - 0.5) * 0.5;
            p.size = 1 + Math.random();
            p.color = currentWeather === 'spore' ? 'rgba(100, 255, 100, 0.3)' : 'rgba(200, 180, 150, 0.2)';
            p.life = 0; // Just for spawn logic reuse, dust persists differently
        }
        
        weatherParticles.push(p);
    }

    // Update & Draw
    for (let i = weatherParticles.length - 1; i >= 0; i--) {
        const p = weatherParticles[i];
        p.x += p.vx;
        p.y += p.vy;

        if (currentWeather === 'rain') {
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 2, p.y - p.vy * 2); ctx.stroke();
        } else {
            ctx.fillStyle = p.color;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        }

        if (p.y > fxCanvas.height + 20 || p.y < -20 || p.x < -20 || p.x > fxCanvas.width + 20) {
            weatherParticles.splice(i, 1);
        }
    }
}

function updateSpatialAudio() {
    if (!audio.initialized) return;

    // 1. Torch Loop (Based on Zoom)
    // Louder when zoomed in (camera.zoom higher)
    // camera.zoom ranges from 0.5 (far) to 2.0 (close)
    // if (torchLight) {
    //     // Map zoom 0.5->2.0 to volume 0.1->0.6
    //     const zoomFactor = (camera.zoom - 0.5) / 1.5;
    //     const torchVol = 0.05 + (zoomFactor * 0.25); // Reduced volume for OGG file
    //     audio.setLoopVolume('torch', torchVol);
    // }

    // 2. Bonfire Loops (Based on Distance to Center of Screen)
    game.rooms.forEach(r => {
        if (r.isBonfire && r.state !== 'cleared') {
            const loopId = `bonfire_${r.id}`;
            // Calculate distance from room center to camera target (center of screen)
            const roomPos = new THREE.Vector3(r.gx, 0, r.gy);
            const dist = roomPos.distanceTo(controls.target);

            // Attenuate volume: Full volume at 0 dist, 0 volume at 15 units
            const maxDist = 15;
            let vol = Math.max(0, 1 - (dist / maxDist));
            // Also scale by zoom so it gets louder when we look closely
            vol *= (camera.zoom * 0.4); // Reduced volume scaling

            audio.setLoopVolume(loopId, vol);
        }
    });
}

function handleWindowResize() {
    fxCanvas.width = window.innerWidth;
    fxCanvas.height = window.innerHeight;
    if (uiFxCanvas) { uiFxCanvas.width = window.innerWidth; uiFxCanvas.height = window.innerHeight; }

    const container = document.getElementById('v3-container');
    if (container && camera && renderer) {
        const aspect = container.clientWidth / container.clientHeight;
        const d = 10;
        camera.left = -d * aspect;
        camera.right = d * aspect;
        camera.top = d;
        camera.bottom = -d;
        camera.updateProjectionMatrix();
        if (combatCamera) {
            combatCamera.aspect = aspect;
            combatCamera.updateProjectionMatrix();
        }
        renderer.setSize(container.clientWidth, container.clientHeight);
        if (composer) {
            composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
            composer.setSize(container.clientWidth, container.clientHeight);
            updateTiltShiftUniforms();
        }
        if (outlineEffect) outlineEffect.setSize(container.clientWidth, container.clientHeight);
    }
}
window.addEventListener('resize', handleWindowResize);

const ColorBandShader = {
    uniforms: {
        'tDiffuse': { value: null }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        varying vec2 vUv;
        void main() {
            vec4 tex = texture2D( tDiffuse, vUv );
            vec3 c = tex.rgb;
            // Quantize colors to create toon bands
            float levels = 6.0;
            c = floor(c * levels) / levels;
            // Slight saturation boost
            vec3 gray = vec3(dot(c, vec3(0.2126, 0.7152, 0.0722)));
            c = mix(gray, c, 1.2);
            gl_FragColor = vec4( c, tex.a );
        }
    `
};

function init3D() {
    const container = document.getElementById('v3-container');
    if (renderer) {
        // Already initialized, just need new scene/camera
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a0a0a);
        scene.fog = new THREE.FogExp2(0x0a0a0a, 0.04);
    } else {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a0a0a);
        scene.fog = new THREE.FogExp2(0x0a0a0a, 0.04);

        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Cap pixel ratio for performance
        renderer.shadowMap.enabled = true;
        container.appendChild(renderer.domElement);
    }

    // Outline Effect (Cel Shading Replacement)
    outlineEffect = new OutlineEffect(renderer, {
        defaultThickness: 0.0025,
        defaultColor: [0, 0, 0],
        defaultAlpha: 0.8,
        defaultKeepAlive: true
    });

    // Post-Processing Setup
    composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Match renderer quality
    
    // Bloom Pass (David's Request)
    bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.2;
    bloomPass.strength = 0.35; // Subtle glow
    bloomPass.radius = 0.5;
    bloomPass.enabled = gameSettings.bloomEnabled;
    composer.addPass(bloomPass);

    hTilt = new ShaderPass(HorizontalTiltShiftShader);
    vTilt = new ShaderPass(VerticalTiltShiftShader);
    hTilt.enabled = false;
    vTilt.enabled = false;

    // Initialize standard RenderPass (used when Cel is off)
    renderPass = new RenderPass(scene, camera);

    rebuildComposer(); // Build the pass chain
    updateTiltShiftUniforms();
    
    const aspect = container.clientWidth / container.clientHeight;
    const d = 10;
    camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 1, 1000);
    camera.position.set(20, 20, 20);
    camera.lookAt(0, 0, 0);
    combatCamera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
    perspectiveCamera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000); // Devin's Camera

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = true; 
    controls.enableRotate = true; // Restore spinning for Map View
    controls.maxZoom = 2;
    controls.minZoom = 0.5;
    controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE, // Left click rotates (spins)
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN    // Right click pans
    };

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    // Hemisphere light — soft global fill to keep scenes readable under heavy fog
    hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x222222, 0.6);
    scene.add(hemisphereLight);
    // Initial Torch
    torchLight = new THREE.PointLight(0xffaa44, 300, 40);
    torchLight.castShadow = true;
    torchLight.shadow.mapSize.width = 512; // Optimize shadow map size
    torchLight.shadow.mapSize.height = 512;
    scene.add(torchLight);

    // Fog of War
    scene.fog = new THREE.FogExp2(0x000000, 0.05);

    if (use3dModel) {
        // Load 3D Player Model
        loadPlayerModel();
    } else {
        // Check for True Ending Unlock (Evil Mode)
        const wins = JSON.parse(localStorage.getItem('scoundrelWins') || '{"m":false, "f":false}');
        const isTrueEndingUnlocked = (wins.m && wins.f);
        const prefix = isTrueEndingUnlocked ? '_evil_' : '_';

        // Load Walking Textures
        walkAnims.m.up = loadTexture(`assets/images/animations/m${prefix}walk_up.png`);
        walkAnims.m.down = loadTexture(`assets/images/animations/m${prefix}walk_down.png`);
        walkAnims.f.up = loadTexture(`assets/images/animations/f${prefix}walk_up.png`);
        walkAnims.f.down = loadTexture(`assets/images/animations/f${prefix}walk_down.png`);

        // Player Billboard
        const spriteMat = new THREE.SpriteMaterial({ map: walkAnims.m.up, transparent: true });
        playerSprite = new THREE.Sprite(spriteMat);
        playerSprite.scale.set(1.5, 1.5, 1.5);
        playerSprite.position.set(0, 0.75, 0); // initial pos
        scene.add(playerSprite);
    }

    // Player Marker (Floating Diamond)
    const markerGeo = new THREE.OctahedronGeometry(0.3, 0);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.8 });
    playerMarker = new THREE.Mesh(markerGeo, markerMat);
    scene.add(playerMarker);

    // Initialize Battle Island
    BattleIsland.init(scene);

    animate3D();
    window.addEventListener('click', on3DClick);
}

function rebuildComposer() {
    if (!composer) return;
    composer.passes = [];

    // 1. Render Pass (Standard or Cel/Outline)
    if (gameSettings.celShadingEnabled && gameSettings.celOutlineEnabled && outlineEffect) {
        // Custom Pass that uses OutlineEffect
        const celPass = new RenderPass(scene, camera);
        celPass.render = function(renderer, writeBuffer, readBuffer) {
            // Mimic standard RenderPass logic but use outlineEffect.render
            const oldAutoClear = renderer.autoClear;
            renderer.autoClear = false;

            let target = this.renderToScreen ? null : readBuffer;
            renderer.setRenderTarget(target);
            
            if (this.clear) renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
            
            outlineEffect.render(this.scene, this.camera);
            
            renderer.autoClear = oldAutoClear;
        };
        composer.addPass(celPass);
    } else {
        composer.addPass(renderPass);
    }

    // 2. Color Banding (Toon Look)
    if (gameSettings.celShadingEnabled) {
        const bandPass = new ShaderPass(ColorBandShader);
        composer.addPass(bandPass);
    }

    // 2. Bloom
    if (bloomPass) composer.addPass(bloomPass);

    // 3. Tilt Shift
    if (hTilt) composer.addPass(hTilt);
    if (vTilt) composer.addPass(vTilt);
}

function updateTiltShiftUniforms() {
    if (hTilt) hTilt.uniforms['h'].value = 4.0 / window.innerWidth;
    if (vTilt) vTilt.uniforms['v'].value = 4.0 / window.innerHeight;
    if (hTilt) hTilt.uniforms['r'].value = 0.5; // Center focus
    if (vTilt) vTilt.uniforms['r'].value = 0.5;
}

function loadPlayerModel() {
    // Check for True Ending Unlock
    const wins = JSON.parse(localStorage.getItem('scoundrelWins') || '{"m":false, "f":false}');
    const isTrueEndingUnlocked = (wins.m && wins.f);

    const suffix = isTrueEndingUnlocked ? '_evil' : '';
    const path = `assets/images/glb/${game.sex === 'm' ? 'male' : 'female'}${suffix}-web.glb`;
    const configKey = path.split('/').pop();

    loadGLB(path, (model, animations) => {
        playerMesh = model;
        playerMesh.userData.animations = animations; // Store for debugging

        playerMesh.position.set(0, 0.1, 0);
        scene.add(playerMesh);

        // Setup Animations
        if (animations && animations.length > 0) {
            mixer = new THREE.AnimationMixer(playerMesh);
            actions = {};

            console.log(`Animations loaded for ${game.sex}:`, animations.map(a => a.name));

            let idleClip, walkClip, attackClip, hitClip;

            // Specific mapping for Evil variants
            if (path.includes('male_evil')) {
                attackClip = animations.find(a => a.name === 'Axe_Spin_Attack');
                hitClip = animations.find(a => a.name === 'Face_Punch_Reaction_1');
                idleClip = animations.find(a => a.name === 'Idle_10');
                walkClip = animations.find(a => a.name === 'Walking') || animations.find(a => a.name === 'Running');
            } else if (path.includes('female_evil')) {
                attackClip = animations.find(a => a.name === 'Sweep_Kick');
                hitClip = animations.find(a => a.name === 'Slap_Reaction');
                idleClip = animations.find(a => a.name === 'Idle_5');
                walkClip = animations.find(a => a.name === 'Walking') || animations.find(a => a.name === 'Running');
            }

            // Fallbacks / Auto-detect
            if (!idleClip) idleClip = animations.find(a => /idle|stand|wait/i.test(a.name)) || animations.find(a => a.name === 'Idle_03' || a.name === 'Idle_15') || animations[0];
            if (!walkClip) walkClip = animations.find(a => /walk/i.test(a.name)) || animations.find(a => /run|move/i.test(a.name)) || animations.find(a => a !== idleClip) || animations[0];
            if (!attackClip) attackClip = animations.find(a => /attack|slash|punch|kick/i.test(a.name));
            if (!hitClip) hitClip = animations.find(a => /hit|damage|reaction|death/i.test(a.name));

            if (walkClip) {
                actions.walk = mixer.clipAction(walkClip);
                actions.walk.timeScale = 0.8; // Slower, weightier walk
            }
            if (idleClip) {
                actions.idle = mixer.clipAction(idleClip);
                // Idle_5 in female_evil is very fast/twitchy, slow it down significantly
                if (idleClip.name === 'Idle_5') actions.idle.timeScale = 0.2;
                else actions.idle.timeScale = 0.5; // Slow down idle (breathing)
            }
            if (attackClip) {
                actions.attack = mixer.clipAction(attackClip);
                actions.attack.setLoop(THREE.LoopOnce);
                actions.attack.clampWhenFinished = true;
                actions.attack.timeScale = 1.0; // Attack at full speed
                console.log(`Attack Duration: ${attackClip.duration.toFixed(2)}s`);
            }
            if (hitClip) {
                actions.hit = mixer.clipAction(hitClip);
                actions.hit.setLoop(THREE.LoopOnce);
                actions.hit.clampWhenFinished = true;
                actions.hit.timeScale = 1.0;
                console.log(`Hit Duration: ${hitClip.duration.toFixed(2)}s`);
            }

            // Start Idle
            if (actions.idle) actions.idle.reset().play();
            else if (actions.walk) actions.walk.play();
        }

        // Position correctly if game is running
        const currentRoom = game.rooms.find(r => r.id === game.currentRoomIdx);
        if (currentRoom) {
            playerMesh.position.set(currentRoom.gx, 0.1, currentRoom.gy);
        }
    }, 0.7, configKey);
}

function initWanderers() {
    // Cleanup existing
    wanderers.forEach(w => scene.remove(w.mesh));
    wanderers = [];

    const count = 1 + Math.floor(game.floor / 2);
    
    for (let i = 0; i < count; i++) {
        const file = GHOST_MODELS[Math.floor(Math.random() * GHOST_MODELS.length)];
        
        loadGLB(`assets/images/glb/${file}`, (model, animations) => {
            // Find valid spawn point
            let valid = false;
            let sx = 0, sz = 0, sy = 0;
            let attempts = 0;
            
            while (!valid && attempts < 50) {
                attempts++;
                const bounds = 12 + (game.floor * 2);
                const r = 5 + Math.random() * (bounds - 6); 
                const angle = Math.random() * Math.PI * 2;
                sx = Math.cos(angle) * r;
                sz = Math.sin(angle) * r;
                
                if (game.rooms.some(r => Math.hypot(r.gx - sx, r.gy - sz) < 4)) continue;
                
                let nearCorr = false;
                for (const m of corridorMeshes.values()) {
                    if (Math.hypot(m.position.x - sx, m.position.z - sz) < 2.5) { nearCorr = true; break; }
                }
                if (nearCorr) continue;
                
                // Raycast to ensure we are on the floor mesh
                if (globalFloorMesh) {
                    terrainRaycaster.set(new THREE.Vector3(sx, 50, sz), new THREE.Vector3(0, -1, 0));
                    const hits = terrainRaycaster.intersectObject(globalFloorMesh);
                    if (hits.length > 0) {
                        sy = hits[0].point.y;
                        valid = true;
                    }
                }
            }

            model.position.set(sx, sy, sz);
            scene.add(model);
            
            const mixer = new THREE.AnimationMixer(model);
            const walkClip = animations.find(a => /walk|run/i.test(a.name)) || animations[0];
            if (walkClip) {
                const action = mixer.clipAction(walkClip);
                action.play();
            }
            
            const wanderer = { mesh: model, mixer: mixer };
            wanderers.push(wanderer);
            pickWandererTarget(wanderer);
        }, 0.7);
    }
}

function pickWandererTarget(wanderer) {
    if (!wanderer.mesh) return;
    
    let valid = false;
    let x, z;
    let attempts = 0;
    
    while (!valid && attempts < 50) {
        attempts++;
        const bounds = 12 + (game.floor * 2);
        const r = 5 + Math.random() * (bounds - 6); // Wander within valid floor bounds
        const angle = Math.random() * Math.PI * 2;
        x = Math.cos(angle) * r;
        z = Math.sin(angle) * r;
        
        // Avoid Rooms
        if (game.rooms.some(r => Math.hypot(r.gx - x, r.gy - z) < 4)) continue;
        
        // Avoid Corridors
        let nearCorr = false;
        for (const m of corridorMeshes.values()) {
            if (Math.hypot(m.position.x - x, m.position.z - z) < 2.5) { nearCorr = true; break; }
        }
        if (nearCorr) continue;
        
        // Raycast to ensure target is on the floor mesh
        if (globalFloorMesh) {
            terrainRaycaster.set(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0));
            const hits = terrainRaycaster.intersectObject(globalFloorMesh);
            if (hits.length > 0) {
                valid = true;
            }
        }
    }
    
    if (valid) {
        wanderer.mesh.lookAt(x, wanderer.mesh.position.y, z);
        const dist = Math.hypot(x - wanderer.mesh.position.x, z - wanderer.mesh.position.z);
        
        new TWEEN.Tween(wanderer.mesh.position)
            .to({ x: x, z: z }, dist * 1200) 
            .onUpdate(() => {
                // Snap to floor mesh during movement
                terrainRaycaster.set(new THREE.Vector3(wanderer.mesh.position.x, 50, wanderer.mesh.position.z), new THREE.Vector3(0, -1, 0));
                const hits = terrainRaycaster.intersectObject(globalFloorMesh);
                if (hits.length > 0) wanderer.mesh.position.y = hits[0].point.y;
            })
            .onComplete(() => {
                setTimeout(() => pickWandererTarget(wanderer), 2000 + Math.random() * 3000);
            })
            .start();
    } else {
        setTimeout(() => pickWandererTarget(wanderer), 1000);
    }
}

// Initialize Audio on first interaction
window.addEventListener('click', () => {
    audio.init();
    applyAudioSettings();
}, { once: true });

/* DEAD CODE - Unused Fog Ring System
function createFogRings() {
    // Remove existing rings
    clearFogRings();

    const tex = loadTexture('assets/images/textures/large-smoke.png');
    for (let i = 0; i < 2; i++) {
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: i === 0 ? 0.12 : 0.08, depthWrite: false });
        const s = new THREE.Sprite(mat);
        s.raycast = () => { }; // Non-interactive
        // Scale rings: inner and outer
        const scale = i === 0 ? 40 : 70;
        s.scale.set(scale, scale, 1);
        // Slight vertical offset so they feel layered
        s.position.set(0, i === 0 ? 4 : 10, 0);
        s.renderOrder = 10; // render early
        scene.add(s);
        // Speeds in radians per millisecond (very small) - inner is slightly faster
        fogRings.push({ sprite: s, speed: (i === 0 ? 0.00006 : -0.00003) });
    }
}

function clearFogRings() {
    fogRings.forEach(f => { if (f.sprite && f.sprite.parent) f.sprite.parent.remove(f.sprite); });
    fogRings = [];
}
*/

function on3DClick(event) {
    if (isEditMode) {
        handleEditClick(event);
        return;
    }
    // Check if mouse moved significantly (drag/rotate) > 5 pixels
    if (Math.abs(event.clientX - clickStart.x) > 5 || Math.abs(event.clientY - clickStart.y) > 5) {
        return;
    }
    // Prevent interaction if any modal is open (including lockpickUI)
    const blockers = ['combatModal', 'lockpickUI', 'introModal', 'avatarModal', 'inventoryModal', 'classModal'];
    const isBlocked = blockers.some(id => {
        // Exception: Allow combatModal if in 3D Combat View (it's transparent)
        if (id === 'combatModal' && isCombatView) return false;

        const el = document.getElementById(id);
        return el && window.getComputedStyle(el).display !== 'none';
    });
    if (isBlocked) return;

    const container = document.getElementById('v3-container');
    const rect = container.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / container.clientWidth) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / container.clientHeight) * 2 + 1;

    if (mouse.x < -1 || mouse.x > 1 || mouse.y < -1 || mouse.y > 1) return;

    raycaster.setFromCamera(mouse, isCombatView ? combatCamera : camera);
    const intersects = raycaster.intersectObjects(scene.children, true);

    // Iterate to find first CLICKABLE object (skipping particles)
    for (let i = 0; i < intersects.length; i++) {
        let obj = intersects[i].object;
        const current = game.rooms.find(r => r.id === game.currentRoomIdx);

        // Check for Room Mesh Interaction
        if (obj.userData && obj.userData.roomId !== undefined) {
            const roomIdx = obj.userData.roomId;

            // Movement
            if (current && current.connections.includes(roomIdx)) {
                enterRoom(roomIdx);
                break;
            }

            // Self-Interaction (Trap, Bonfire, Merchant) in Combat View
            if (isCombatView && current && current.id === roomIdx && (current.isTrap || current.isBonfire || current.isSpecial) && current.state !== 'cleared') {
                enterRoom(roomIdx);
                break;
            }
        }

        // Combat Interaction (3D Standees) - Check parent groups
        if (isCombatView) {
            let parent = obj;
            while (parent) {
                if (parent.userData && parent.userData.isCombatEntity) {
                    const idx = parent.userData.cardIdx;
                    // Trigger pickCard with a mock event or handle null event in pickCard
                    pickCard(idx, null);
                    return; // Stop processing clicks
                }
                parent = parent.parent;
                if (parent === scene) break;
            }
        }
    }
}

function update3DScene() {
    if (!scene) return;
    const currentRoom = game.rooms.find(room => room.id === game.currentRoomIdx);

    const playerObj = use3dModel ? playerMesh : playerSprite;
    if (playerObj && torchLight) {
        // --- Attract Mode Overrides ---
        if (isAttractMode) {
            // Force full visibility
            game.rooms.forEach(r => {
                r.isRevealed = true;
                if (!r.correveals) r.correveals = {};
                r.connections.forEach(cid => r.correveals[`cor_${r.id}_${cid}`] = true);
            });
            torchLight.intensity = 1200;
            torchLight.distance = 100;
        }

        let vRad = 2.5;
        // Check for Spectral Lantern (ID 1)
        const hasLantern = game.hotbar.some(i => i && i.type === 'item' && i.id === 1);

        // Check for Map (ID 3)
        const hasMap = game.hotbar.some(i => i && i.type === 'item' && i.id === 3);

        // Torch Logic based on Fuel
        const baseDist = 15 + (game.torchCharge * 1.5); // 15 base + fuel
        const baseInt = 200 + (game.torchCharge * 50);

        if (game.equipment.weapon) {
            if (game.equipment.weapon.val >= 8 || hasLantern) {
                torchLight.color.setHex(0x00ccff); torchLight.intensity = (viewMode !== 0 ? baseInt * 1.5 : baseInt * 2.5);
                torchLight.distance = baseDist * 1.5; vRad = 8.0;
            } else if (game.equipment.weapon.val >= 6 || hasLantern) {
                torchLight.color.setHex(0xd4af37); torchLight.intensity = (viewMode !== 0 ? baseInt * 1.2 : baseInt * 2.0);
                torchLight.distance = baseDist * 1.2; vRad = 5.0;
            } else {
                torchLight.color.setHex(0xffaa44); torchLight.intensity = (viewMode !== 0 ? baseInt : baseInt * 1.5);
                torchLight.distance = baseDist; vRad = 3.5;
            }
        } else {
            torchLight.color.setHex(0xffaa44); torchLight.intensity = (viewMode !== 0 ? baseInt * 0.8 : baseInt * 1.2);
            torchLight.distance = baseDist * 0.8; vRad = 2.5;
        }

        // Torch Flicker Juice
        const flicker = 1.0 + (Math.random() - 0.5) * 0.15;
        torchLight.intensity *= flicker;

        // Start torch sound if not playing
        // Note: This check is cheap in the loop map
        // if (audio.initialized) audio.startLoop('torch', 'torch_loop', { volume: 0 });

        torchLight.position.set(playerObj.position.x, 2.5, playerObj.position.z);

        game.rooms.forEach(r => {
            const dist = Math.sqrt(Math.pow(r.gx - playerObj.position.x, 2) + Math.pow(r.gy - playerObj.position.z, 2));
            const isVisible = isAttractMode || (dist < vRad);
            if (isVisible) r.isRevealed = true;

            if (r.isRevealed || isEditMode) {
                if (r.isWaypoint) {
                    // Hidden Waypoint Logic
                    if (r.isHidden && !isEditMode) {
                        // Only visible if player is in a connected room (parent)
                        const isConnected = currentRoom && currentRoom.connections.includes(r.id);
                        if (!isConnected) return; // Skip rendering
                    }

                    if (!waypointMeshes.has(r.id)) {
                        let geo, mat, customModelPath = null, customScale = 1.0;

                        if (r.isHidden) {
                            // Disguised Waypoint: Suspicious Rock
                            geo = new THREE.DodecahedronGeometry(0.4, 0);
                            mat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9 });
                        } else {
                            if (use3dModel) {
                                customModelPath = 'assets/images/glb/waypoint-web.glb';
                                customScale = 0.5; // Adjust based on your model size
                            }
                            geo = new THREE.SphereGeometry(0.2, 16, 16);
                            mat = new THREE.MeshStandardMaterial({ color: 0x555555, emissive: 0x222222, visible: !customModelPath });
                        }
                        const mesh = new THREE.Mesh(geo, mat);
                        mesh.position.set(r.gx, r.isHidden ? 0.3 : 0.1, r.gy);

                        if (customModelPath) {
                            const configKey = customModelPath.split('/').pop();
                            loadGLB(customModelPath, (model) => {
                                if (!roomConfig[configKey]) model.position.set(0, -0.1, 0); // Center vertically
                                mesh.add(model);
                                mesh.material.visible = false;
                            }, customScale, configKey);
                        }

                        if (r.isHidden) mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
                        mesh.userData = { roomId: r.id };
                        scene.add(mesh);
                        waypointMeshes.set(r.id, mesh);
                    }
                    const mesh = waypointMeshes.get(r.id);
                    mesh.visible = !isCombatView;
                    const isAdj = currentRoom && (currentRoom.id === r.id || currentRoom.connections.includes(r.id));

                    const targetEmissive = isAdj ? 0xd4af37 : 0x222222;
                    mesh.material.emissive.setHex(targetEmissive);

                    // Propagate emissive glow to GLB children
                    mesh.traverse((child) => {
                        if (child.isMesh && child !== mesh && child.material) {
                            if (!child.userData.hasClonedMat) {
                                child.material = child.material.clone();
                                child.userData.hasClonedMat = true;
                            }
                            child.material.emissive.setHex(targetEmissive);
                        }
                    });
                } else {
                    if (!roomMeshes.has(r.id)) {
                        const rw = r.w; const rh = r.h;
                        const rDepth = 3.0 + Math.random() * 3.0;
                        r.rDepth = rDepth;

                        let geo, customModelPath = null, customScale = 1.0;

                        if (r.isFinal) {
                            // Tower/Deep Pit
                            // Use Gothic Tower GLB if available
                            if (use3dModel) customModelPath = 'assets/images/glb/gothic_tower-web.glb';
                            customScale = 2.5; // Increased size
                            // Fallback geometry while loading or if fails
                            geo = new THREE.BoxGeometry(rw, 10, rh);
                        } else if (r.isBonfire) {
                            // Circular Campfire Ring 
                            // Use a Cylinder. radius ~ min(w,h)/2.
                            // Use Campfire Tower GLB
                            if (use3dModel) customModelPath = 'assets/images/glb/campfire_tower-web.glb';
                            customScale = 2.0; // Increased size
                            const rad = Math.min(rw, rh) * 0.4;
                            geo = new THREE.CylinderGeometry(rad, rad, rDepth, 16);
                        } else if (r.isSecret) {
                            // Secret Room: Large Boulder/Mound or Custom GLB
                            geo = new THREE.DodecahedronGeometry(Math.min(rw, rh) * 0.9, 1);
                            if (use3dModel) {
                                customModelPath = 'assets/images/glb/room_secret-web.glb';
                                customScale = 0.5;
                            }
                        } else {
                            // Varied Shapes
                            if (r.shape === 'round') {
                                const rad = Math.min(rw, rh) * 0.45;
                                geo = new THREE.CylinderGeometry(rad, rad, rDepth, 16);
                                if (use3dModel) {
                                    customModelPath = 'assets/images/glb/room_round-web.glb';
                                    customScale = 0.5;
                                }
                            } else if (r.shape === 'dome') {
                                const rad = Math.min(rw, rh) * 0.65;
                                geo = new THREE.SphereGeometry(rad, 16, 12); // Full sphere
                                if (use3dModel) {
                                    customModelPath = 'assets/images/glb/room_dome-web.glb';
                                    customScale = 0.5;
                                }
                            } else if (r.shape === 'spire') {
                                geo = new THREE.ConeGeometry(Math.min(rw, rh) * 0.6, rDepth, 4);
                                if (use3dModel) {
                                    customModelPath = 'assets/images/glb/room_spire-web.glb';
                                    customScale = 0.5;
                                }
                            } else {
                                geo = new THREE.BoxGeometry(rw, rDepth, rh);
                                if (use3dModel) {
                                    customModelPath = 'assets/images/glb/room_rect-web.glb';
                                    customScale = 0.5;
                                }
                            }
                        }

                        // Create a container mesh (or placeholder)
                        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, visible: !customModelPath });
                        const mesh = new THREE.Mesh(geo, mat);

                        if (customModelPath) {
                            // Use filename as config key (e.g., 'gothic_tower-web.glb')
                            const configKey = customModelPath.split('/').pop();

                            loadGLB(customModelPath, (model) => {
                                // Only auto-align if NO config exists
                                if (!roomConfig[configKey]) {
                                    // Fix Origin: Align bottom of model to floor using Bounding Box
                                    const box = new THREE.Box3().setFromObject(model);

                                    // Determine floor level relative to container mesh
                                    let floorOffset = -rDepth / 2;
                                    if (r.isFinal || r.shape === 'dome' || r.isSecret) {
                                        floorOffset = 0;
                                    }
                                    // Shift model so its bottom (box.min.y) sits at floorOffset
                                    model.position.set(0, floorOffset - box.min.y - 0.05, 0);
                                }

                                mesh.add(model);
                                // Hide placeholder geometry but keep mesh for logic/positioning
                                mesh.material.visible = false;

                                // Special logic for Bonfire Tower Light
                                if (r.isBonfire) {
                                    const fireLight = new THREE.PointLight(0xff6600, 500, 15);
                                    fireLight.position.set(0, 2, 0); // Inside the tower
                                    fireLight.castShadow = true;
                                    model.add(fireLight);
                                }
                            }, customScale, configKey);
                        }

                        if (r.isFinal) {
                            // Extend downwards for the pit/tower
                            mesh.position.set(r.gx, 0, r.gy); // Sit on ground
                        } else if (r.shape === 'dome' || r.isSecret || (use3dModel && customModelPath)) {
                            // If using 3D models, always sit on ground (y=0) to ensure config offsets are consistent
                            // regardless of random rDepth generation.
                            mesh.position.set(r.gx, 0, r.gy); // Sit on ground (half buried)
                        } else {
                            mesh.position.set(r.gx, rDepth / 2, r.gy); // Standard rooms raised slightly
                        }

                        // Apply the matrix once
                        mesh.updateMatrix();

                        if (r.isBonfire) {
                            const fire = createEmojiSprite('🔥', 2.0);
                            fire.position.set(r.gx, rDepth + 0.5, r.gy);
                            // Animate bobbing?
                            // Add to mesh to keep relative?
                            // Just add to scene for now
                            scene.add(fire);
                            // Store reference maybe if we want to animate/remove?
                            // Ideally add to roomMeshes map or create a separate group
                            // For simplicity, add to mesh
                            // mesh.add(fire); // This would scale with mesh which might be weird if mesh is scaled
                            // But mesh is created with geometry size, so no scale.
                            // Wait, mesh.position is center.
                            // If mesh extends from 0 to rDepth, and pos is rDepth/2.
                            // Top is at rDepth.
                            // Fire should be at rDepth + 1.
                            fire.position.set(0, rDepth / 2 + 1, 0);
                            mesh.add(fire);

                            // --- GLSL: Holy Fire Pillar ---
                            // A volumetric cone that pulses with light
                            const beamGeo = new THREE.ConeGeometry(r.w * 0.3, rDepth * 1.2, 16, 1, true);
                            const beamMat = new THREE.ShaderMaterial({
                                uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xffaa00) } },
                                vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
                                fragmentShader: `
                                    uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
                                    void main() {
                                        // Vertical fade + pulsing sine wave
                                        float pulse = sin(vUv.y * 20.0 - uTime * 5.0) * 0.5 + 0.5;
                                        float alpha = (1.0 - vUv.y) * (0.3 + 0.7 * pulse) * 0.6;
                                        gl_FragColor = vec4(uColor, alpha);
                                    }
                                `,
                                transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
                            });
                            const beamMesh = new THREE.Mesh(beamGeo, beamMat);
                            beamMesh.position.y = 0; // Center of room
                            mesh.add(beamMesh);
                            animatedMaterials.push(beamMat);
                        }

                        // --- GLSL: Merchant Gold Dust ---
                        if (r.isSpecial && !r.isFinal) {
                            const dustGeo = new THREE.CylinderGeometry(r.w * 0.4, r.w * 0.4, rDepth, 16, 1, true);
                            const dustMat = new THREE.ShaderMaterial({
                                uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xffd700) } },
                                vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
                                fragmentShader: `
                                    uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
                                    float random(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453); }
                                    void main() {
                                        // Rising particles pattern
                                        vec2 grid = vec2(vUv.x * 20.0, vUv.y * 10.0 - uTime * 1.0);
                                        float r = random(floor(grid));
                                        float alpha = (r > 0.97) ? (1.0 - vUv.y) : 0.0;
                                        gl_FragColor = vec4(uColor, alpha);
                                    }
                                `,
                                transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
                            });
                            const dustMesh = new THREE.Mesh(dustGeo, dustMat);
                            mesh.add(dustMesh);
                            animatedMaterials.push(dustMat);
                        }

                        // --- GLSL: Alchemy Bubbles ---
                        if (r.isAlchemy && !r.isFinal) {
                            const bubbleGeo = new THREE.CylinderGeometry(r.w * 0.4, r.w * 0.4, rDepth, 16, 1, true);
                            const bubbleMat = new THREE.ShaderMaterial({
                                uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x00ff88) } }, // Teal/Green
                                vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
                                fragmentShader: `
                                    uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
                                    float random(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453); }
                                    void main() {
                                        // Rising bubbles pattern
                                        vec2 grid = vec2(vUv.x * 15.0, vUv.y * 8.0 - uTime * 0.8);
                                        float r = random(floor(grid));
                                        // Circle shape for bubbles
                                        vec2 local = fract(grid) - 0.5;
                                        float d = length(local);
                                        float alpha = (r > 0.95 && d < 0.3) ? (1.0 - vUv.y) : 0.0;
                                        gl_FragColor = vec4(uColor, alpha * 0.8);
                                    }
                                `,
                                transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
                            });
                            const bubbleMesh = new THREE.Mesh(bubbleGeo, bubbleMat);
                            mesh.add(bubbleMesh);
                            animatedMaterials.push(bubbleMat);
                        }

                        // --- GLSL: Final Room Vortex ---
                        if (r.isFinal) {
                            const portalGeo = new THREE.PlaneGeometry(r.w * 0.8, r.h * 0.8);
                            const portalMat = new THREE.ShaderMaterial({
                                uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x8800ff) } },
                                vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
                                fragmentShader: `
                                    uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
                                    void main() {
                                        vec2 uv = vUv - 0.5;
                                        float dist = length(uv);
                                        float angle = atan(uv.y, uv.x);
                                        // Swirling spiral pattern
                                        float spiral = sin(dist * 20.0 - uTime * 4.0 + angle * 5.0);
                                        float alpha = (1.0 - smoothstep(0.3, 0.5, dist)) * (0.5 + 0.5 * spiral);
                                        gl_FragColor = vec4(uColor, alpha);
                                    }
                                `,
                                transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
                            });
                            const portalMesh = new THREE.Mesh(portalGeo, portalMat);
                            portalMesh.rotation.x = -Math.PI / 2;
                            portalMesh.position.y = -rDepth / 2 + 0.2; // Slightly above floor
                            mesh.add(portalMesh);
                            animatedMaterials.push(portalMat);
                        }

                        if (r.isBonfire) {
                            // Start spatial sound for this bonfire
                            if (audio.initialized)
                                audio.startLoop(`bonfire_${r.id}`, 'bonfire_loop', { volume: 0 });

                            // Force Idle Animation inside Bonfire Room (since it's visible)
                            if (currentRoom && currentRoom.id === r.id && use3dModel && actions.idle && actions.walk) {
                                if (actions.walk.isRunning()) {
                                    actions.walk.stop();
                                    actions.idle.play();
                                }
                            }
                        }

                        mesh.receiveShadow = true;
                        mesh.userData = { roomId: r.id };
                        if (r.isFinal) applyTextureToMesh(mesh, 'block', 7);
                        else if (r.isSpecial) applyTextureToMesh(mesh, 'block', 1);
                        else applyTextureToMesh(mesh, 'block', 0);
                        scene.add(mesh);
                        roomMeshes.set(r.id, mesh);
                        addDoorsToRoom(r, mesh);
                        addLocalFog(mesh);
                    }
                    const mesh = roomMeshes.get(r.id);

                    // Visual Priority: Cleared (Holy Glow) > Special > Base
                    let eCol = 0x000000;
                    let eInt = (isVisible ? 1.0 : 0.2);

                    let targetColor = 0x444444;
                    if (r.state === 'cleared' && !r.isWaypoint) {
                        eCol = 0xaaaaaa; // Holy Glow
                        targetColor = 0xffffff; // White Tint
                        eInt = (isVisible ? 0.8 : 0.4);
                        if (r.isFinal) {
                            eCol = 0x440000; // Bright Red Glow
                            targetColor = 0xffaaaa;
                            eInt = 1.0;
                        }
                    } else {
                        targetColor = 0x444444; // Reset to dark
                        if (r.isFinal) { eCol = 0xff0000; eInt = (isVisible ? 2.5 : 0.5); }
                        else if (r.isBonfire) { eCol = 0xff8800; eInt = (isVisible ? 2.5 : 0.5); }
                        else if (r.isSpecial) {
                            // Only tint if NOT using 3D models (let the model texture show)
                            if (!use3dModel) { eCol = 0x8800ff; eInt = (isVisible ? 1.5 : 0.3); }
                        }
                        else if (r.isAlchemy) { eCol = 0x00ff88; eInt = (isVisible ? 1.5 : 0.3); }
                    }

                    if (mesh.material.color.getHex() !== targetColor) mesh.material.color.setHex(targetColor);
                    if (mesh.material.emissive.getHex() !== eCol) mesh.material.emissive.setHex(eCol);
                    if (mesh.material.emissiveIntensity !== eInt) mesh.material.emissiveIntensity = eInt;

                    // Add Holy Light FX for cleared rooms
                    if (r.state === 'cleared' && !r.isWaypoint && !r.isFinal && !mesh.userData.hasHolyLight) {
                        addHolyLightFX(mesh, r.w, r.rDepth);
                        mesh.userData.hasHolyLight = true;
                    }
                }
            }

            // Secret Room Map Glow
            if (r.isSecret && r.mesh && hasMap) {
                r.mesh.material.emissive.setHex(0x0044ff);
                r.mesh.material.emissiveIntensity = 0.8;
            }

            r.connections.forEach(cid => {
                const target = game.rooms.find(rm => rm.id === cid);
                if (!target) return;
                const corridorId = `cor_${r.id}_${cid}`;
                const mesh = corridorMeshes.get(corridorId) || corridorMeshes.get(`cor_${cid}_${r.id}`);
                if (!mesh) {
                    // Don't draw corridors to secret rooms
                    if (r.isSecret || target.isSecret) return;
                    if (r.isHidden || target.isHidden) return; // Don't draw to hidden waypoints either

                    const h = 0.05;
                    const v1 = new THREE.Vector3(r.gx, h, r.gy);
                    const v2 = new THREE.Vector3(target.gx, h, target.gy);
                    const dist = v1.distanceTo(v2);
                    const geo = new THREE.BoxGeometry(0.5, 0.04, dist);
                    const mat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.9, emissive: 0x222222 });
                    const m = new THREE.Mesh(geo, mat);
                    const mid = v1.clone().add(v2).multiplyScalar(0.5);
                    m.position.set(mid.x, h, mid.z);
                    m.lookAt(v2);
                    scene.add(m);
                    corridorMeshes.set(corridorId, m);
                } else {
                    const midX = (r.gx + target.gx) / 2;
                    const midZ = (r.gy + target.gy) / 2;
                    const distToMid = Math.sqrt(Math.pow(midX - playerObj.position.x, 2) + Math.pow(midZ - playerObj.position.z, 2));
                    const isDir = distToMid < vRad;
                    if (isDir) { r.correveals = r.correveals || {}; r.correveals[corridorId] = true; }
                    if (!isCombatView) mesh.visible = (r.correveals && r.correveals[corridorId]) || isEditMode;
                    if (mesh.visible) mesh.material.emissiveIntensity = (isDir ? 0.3 : 0.05);
                }
            });
        });

        if (currentRoom && !isAttractMode && !isCombatView) {
            const targetPos = new THREE.Vector3(currentRoom.gx, 0, currentRoom.gy);
            controls.target.lerp(targetPos, 0.05);
        }
    }
}

function updateMusicForFloor() {
    if (!audio.initialized) return;

    let track = 'bg_1';
    if (game.floor >= 4) track = 'bg_2';
    if (game.floor >= 7) track = 'bg_3';

    // Fallback: If custom track isn't loaded (or missing), use autogen drone
    if (!audio.buffers.has(track)) track = 'bgm_dungeon';

    if (game.currentTrack !== track) {
        console.log(`Switching BGM to ${track}`);
        audio.stopLoop('bgm', 1.5); // Fade out old
        audio.startLoop('bgm', track, { volume: 0.4, isMusic: true });
        game.currentTrack = track;
    }
}

function animate3D() {
    requestAnimationFrame(animate3D);
    update3DScene();
    updateFX();
    // Update UI FX canvas (draw on top of modal as needed)
    updateUIFX();
    updateSpatialAudio();

    // Animate Player Marker
    const playerObj = use3dModel ? playerMesh : playerSprite;
    if (playerMarker && playerObj && !isAttractMode) {
        const currentRoom = game.rooms.find(r => r.id === game.currentRoomIdx);

        if (currentRoom && currentRoom.isWaypoint) {
            // Hide marker when in waypoints
            playerMarker.visible = false;
        } else {
            // Show marker when in actual rooms
            playerMarker.visible = true;
            const time = Date.now() * 0.002;

            // Position above the room (use room depth if available, otherwise default)
            const roomHeight = (currentRoom && currentRoom.rDepth) ? currentRoom.rDepth : 3.0;
            const markerHeight = roomHeight + 2.0 + Math.sin(time) * 0.5;

            playerMarker.position.set(playerObj.position.x, markerHeight, playerObj.position.z);
            playerMarker.rotation.y += 0.02;
        }
    }

    if (isAttractMode) {
        // Rotate camera around center
        const time = Date.now() * 0.0002;
        const dist = 35;
        camera.position.x = Math.sin(time) * dist;
        camera.position.z = Math.cos(time) * dist;
        camera.position.y = 12; // Low angle (~20 degrees)
        camera.lookAt(0, 0, 0);
    } else {
        controls.update();
    }

    /* DEAD CODE
    // Rotate fog rings slowly for subtle motion
    const t = Date.now();
    fogRings.forEach(f => {
        if (!f.sprite) return;
        f.sprite.material.rotation = (t * f.speed) % (Math.PI * 2);
    });
    */

    // Ghost FX Logic
    if (treePositions.length > 0 && Math.random() < 0.015) {
        const idx = Math.floor(Math.random() * treePositions.length);
        spawn3DGhost(treePositions[idx]);
    }
    for (let i = ghosts.length - 1; i >= 0; i--) {
        const g = ghosts[i];
        g.position.y += 0.015; // Drift up
        g.material.opacity -= 0.004; // Fade out
        if (g.material.opacity <= 0) {
            scene.remove(g);
            ghosts.splice(i, 1);
        }
    }

    // Throttle FX updates and rendering to a target of 30 FPS to reduce CPU/GPU pressure on low-end machines
    const now = performance.now();
    if (now - lastFXTime >= FX_INTERVAL) {
        // Update Shader Time
        const time = now / 1000;
        animatedMaterials.forEach(mat => {
            if (mat.uniforms && mat.uniforms.uTime) {
                mat.uniforms.uTime.value = time;
            }
        });

        updateFX();
        updateUIFX();
        lastFXTime = now;

        // Update Combat Entities (Floating Chest Icons)
        if (isCombatView) {
            combatEntities.forEach(e => { if (e.update) e.update(time); });
        }
    }

    // Throttled render so we don't render >30fps
    if (now - lastRenderTime >= RENDER_INTERVAL) {
        // Determine active camera based on mode
        let activeCam = isCombatView ? combatCamera : camera;

        const lockpickActive = document.getElementById('lockpickUI') && document.getElementById('lockpickUI').style.display !== 'none';

        // Determine if we need post-processing (Bloom OR Tilt-Shift OR Cel)
        const usePostProcessing = (gameSettings.tiltShiftMode === 'threejs' || gameSettings.bloomEnabled || gameSettings.celShadingEnabled) && composer;

        if (usePostProcessing) {
            // Dynamic Tilt-Shift: Disable in combat/puzzle for clarity
            if (hTilt && vTilt) {
                const tiltActive = (gameSettings.tiltShiftMode === 'threejs') && !isCombatView && !lockpickActive;
                hTilt.enabled = tiltActive;
                vTilt.enabled = tiltActive;
            }
            
            renderPass.camera = activeCam;
            composer.render();
        } else {
            renderer.render(scene, activeCam);
        }
        lastRenderTime = now;
    }

    if (window.TWEEN) TWEEN.update();

    // Update Animation Mixer
    if (use3dModel && mixer) {
        const delta = Math.min(clock.getDelta(), 0.1); // Cap delta to prevent "super fast" catch-up glitches
        mixer.update(delta * globalAnimSpeed);
        wanderers.forEach(w => { if(w.mixer) w.mixer.update(delta * globalAnimSpeed); });
    } else if (!use3dModel) {
        animatePlayerSprite();
    }
}

function animatePlayerSprite() {
    if (!playerSprite) return;
    const time = Date.now() * 0.001;
    const frame = Math.floor((time * 12) % 25);
    playerSprite.material.map.repeat.set(1 / 25, 1);
    playerSprite.material.map.offset.set(frame / 25, 0);
    if (viewMode === 0) { // 2D
        playerSprite.rotation.x = Math.PI / 2; playerSprite.position.y = 0.8;
        playerSprite.material.map = walkAnims[game.sex].up;
    } else { // 3D Iso or Free
        playerSprite.rotation.x = 0; playerSprite.position.y = 0.75; 
        const isFace = camera.position.z > playerSprite.position.z;
        playerSprite.material.map = isFace ? walkAnims[game.sex].down : walkAnims[game.sex].up;
    }
}

function movePlayerSprite(oldId, newId) {
    const r1 = game.rooms.find(r => r.id === oldId);
    const r2 = game.rooms.find(r => r.id === newId);
    if (!r1 || !r2) return;

    audio.play('footstep', { volume: 0.4, rate: 0.9 + Math.random() * 0.2 });

    // Consume Torch Fuel
    game.torchCharge = Math.max(0, game.torchCharge - 1);
    if (game.torchCharge < 5) logMsg(`Torch is fading... (${game.torchCharge} left)`);
    updateUI();

    // Rotate to face target
    if (use3dModel && playerMesh) {
        playerMesh.lookAt(r2.gx, playerMesh.position.y, r2.gy);
        // Trigger Walk Animation
        if (actions.walk && actions.idle) {
            actions.walk.enabled = true;
            actions.walk.setEffectiveTimeScale(0.8); // Match the speed set in loadPlayerModel
            actions.walk.setEffectiveWeight(1.0);
            actions.idle.crossFadeTo(actions.walk, 0.2, true).play();
        }
        playerMoveTween = new TWEEN.Tween(playerMesh.position).to({ x: r2.gx, z: r2.gy }, 600).easing(TWEEN.Easing.Quadratic.Out).onComplete(() => {
            // Return to Idle
            if (actions.walk && actions.idle) {
                actions.walk.crossFadeTo(actions.idle, 0.2, true).play();
            }
            playerMoveTween = null;
        }).start();
    } else if (playerSprite) {
        playerSprite.material.map = (r2.gy > r1.gy) ? walkAnims[game.sex].up : walkAnims[game.sex].down;
        playerMoveTween = new TWEEN.Tween(playerSprite.position).to({ x: r2.gx, z: r2.gy }, 600).easing(TWEEN.Easing.Quadratic.Out).onComplete(() => {
            playerMoveTween = null;
        }).start();
    }
}

function addDoorsToRoom(room, mesh) {
    const tex = loadTexture('assets/images/door.png');
    room.connections.forEach(cid => {
        const target = game.rooms.find(rm => rm.id === cid);
        if (!target) return;
        if (target.isSecret || target.isHidden) return; // No doors to secret areas

        const dx = target.gx - room.gx; const dy = target.gy - room.gy;
        const rw = room.w / 2; const rh = room.h / 2; const margin = 0.075;
        let posX = 0, posY = -(room.rDepth / 2) + 1, posZ = 0;
        let rotY = 0;

        if (Math.abs(dx) > Math.abs(dy)) {
            posX = dx > 0 ? rw + margin : -rw - margin;
            rotY = dx > 0 ? Math.PI / 2 : -Math.PI / 2;
        } else {
            posZ = dy > 0 ? rh + margin : -rh - margin;
            rotY = dy > 0 ? 0 : Math.PI;
        }

        if (use3dModel) {
            const path = 'assets/images/glb/door-web.glb';
            const configKey = path.split('/').pop();
            loadGLB(path, (model) => {
                // Enforce dynamic wall position (X/Z) and facing (Rot Y)
                // But respect configured height (Y) and other rotations (X/Z) if present
                model.position.set(posX, model.position.y, posZ);
                model.rotation.y = rotY;
                mesh.add(model);
                doorMeshes.set(`door_${room.id}_${cid}`, model);
            }, 1.0, configKey);
        } else {
            const door = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), new THREE.MeshStandardMaterial({ map: tex, transparent: true, side: THREE.FrontSide }));
            door.matrixAutoUpdate = false;
            door.position.set(posX, posY, posZ);
            door.rotation.y = rotY;
            door.updateMatrix();
            mesh.add(door);
            doorMeshes.set(`door_${room.id}_${cid}`, door);
        }
    });
    updateRoomVisuals();
}

function updateRoomVisuals() {
    // Update Room Visuals (Tinting)
    game.rooms.forEach(r => {
        if (!r.mesh) return;

        // Determine target colors
        let targetEmissive = 0x000000;
        let targetColor = 0x444444; // Default Dark Grey

        if (r.state === 'cleared' && !r.isWaypoint) {
            // Holy Glow for cleared rooms
            targetEmissive = 0x222222; // Light emission
            targetColor = 0xaaaaaa; // Lighten base color

            if (r.isFinal) {
                targetColor = 0xffaaaa; // Pale Red
                targetEmissive = 0x440000;
            }
        } else if (r.isFinal) {
            // Uncleared Final Room (Dark Red)
            targetColor = 0x880000;
        }

        // Apply to the main container mesh (placeholder)
        r.mesh.material.emissive.setHex(targetEmissive);
        r.mesh.material.color.setHex(targetColor);

        // Apply to any loaded GLB children (Towers)
        r.mesh.traverse((child) => {
            if (child.isMesh && child !== r.mesh && child.material) {
                // We clone the material so we don't affect other instances of the same GLB
                if (!child.userData.hasClonedMat) {
                    child.material = child.material.clone();
                    child.userData.hasClonedMat = true;
                }
                child.material.emissive.setHex(targetEmissive);
                // Optional: Tint the texture color too, but be careful not to wash it out
                child.material.color.setHex(targetColor);
            }
        });
    });
}

function addLocalFog(mesh) {
    const smoke = loadTexture('assets/images/textures/smoke_01.png');
    // Reduced count from 3 to 2 for optimization
    for (let i = 0; i < 2; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smoke, transparent: true, opacity: 0.15, color: 0x444444 }));
        s.raycast = () => { };
        const sz = 4 + Math.random() * 4;
        s.scale.set(sz, sz, 1);
        // Local Y relative to mesh center (which is at rDepth/2)
        const localY = 1.0 - mesh.position.y + (Math.random() * 1.5);
        s.position.set((Math.random() - 0.5) * 4, localY, (Math.random() - 0.5) * 4);
        mesh.add(s);
    }
}

function addHolyLightFX(mesh, width, depth) {
    // Floating particles shader
    const geo = new THREE.CylinderGeometry(width * 0.3, width * 0.3, depth, 16, 1, true);
    const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xffffff) } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
            uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
            float random(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453); }
            void main() {
                // Rising particles
                vec2 grid = vec2(vUv.x * 15.0, vUv.y * 8.0 - uTime * 0.5);
                float r = random(floor(grid));
                float alpha = (r > 0.95) ? (1.0 - vUv.y) * 0.5 : 0.0;
                // Soft glow at bottom
                alpha += (1.0 - vUv.y) * 0.1;
                gl_FragColor = vec4(uColor, alpha);
            }
        `,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    const fxMesh = new THREE.Mesh(geo, mat);
    fxMesh.position.y = 1.5; // Rise from floor
    mesh.add(fxMesh);
    animatedMaterials.push(mat);

    // Add a small point light
    const light = new THREE.PointLight(0xaaccff, 100, 8);
    light.position.set(0, 1.5, 0);
    mesh.add(light);
}

function spawn3DGhost(pos) {
    const tex = loadTexture('assets/images/textures/smoke_01.png');
    const mat = new THREE.SpriteMaterial({
        map: tex,
        color: 0xaaccff, // Ghostly blue-white
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    s.position.y += 0.8 + Math.random();
    s.scale.set(1.2, 1.2, 1.2);
    scene.add(s);
    ghosts.push(s);
}

function createEmojiSprite(emoji, size = 1.5) {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.font = '100px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 64, 64);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(size, size, 1);
    return sprite;
}

function takeDamage(amount) {
    let remaining = amount;
    const protectionFloor = Object.values(game.equipment).filter(i => i && i.type === 'armor').length;

    if (game.ap > protectionFloor) {
        // We have pool above the floor
        const availablePool = game.ap - protectionFloor;
        const absorption = Math.min(availablePool, remaining);
        game.ap -= absorption;
        remaining -= absorption;
    }

    // Now subtract the permanent floor block from the remaining damage
    // Note: The floor blocks damage EVERY hit if there is remaining damage.
    if (remaining > 0) {
        remaining = Math.max(0, remaining - protectionFloor);
    }

    game.hp -= remaining;

    // Trigger 3D Hit Animation
    if (use3dModel && actions.hit && actions.idle && amount > 0) {
        actions.idle.stop();
        if (actions.walk) actions.walk.stop();
        if (actions.attack) actions.attack.stop();

        actions.hit.reset().play();

        const onHitFinish = (e) => {
            if (e.action === actions.hit) {
                actions.hit.stop();
                actions.idle.play();
                mixer.removeEventListener('finished', onHitFinish);
            }
        };
        mixer.addEventListener('finished', onHitFinish);
    }
}

function updateAtmosphere(floor) {
    const theme = getThemeForFloor(floor);

    // Darker, cleaner atmosphere (No colored fog)
    const black = new THREE.Color(0x050505);
    scene.background = black;
    // Black fog creates "fade to darkness" LOD effect
    scene.fog = new THREE.FogExp2(0x000000, isEditMode ? 0 : 0.045);

    // Update ambient and hemisphere lights to match mood
    const amb = scene.children.find(c => c.isAmbientLight);
    if (amb) {
        amb.color.setHex(theme.color).lerp(new THREE.Color(0xffffff), 0.1);
        amb.intensity = (theme.ambientIntensity || 0.15) + 0.35; // Significant boost
    }

    if (typeof hemisphereLight !== 'undefined' && hemisphereLight) {
        const sky = new THREE.Color(theme.color).lerp(new THREE.Color(0xffffff), 0.6);
        const ground = new THREE.Color(theme.color).multiplyScalar(0.25);
        hemisphereLight.color.copy(sky);
        hemisphereLight.groundColor.copy(ground);
        hemisphereLight.intensity = (theme.hemiIntensity || 0.35) + 0.25; // Significant boost
    }

    // Update Battle Island Theme
    BattleIsland.generate(theme);
    currentWeather = theme.weather || 'none';
    weatherParticles = []; // Reset particles on floor change
}

function clear3DScene() {
    if (!scene) return;
    while (scene.children.length > 0) scene.remove(scene.children[0]);

    // New Ambient Light handling in updateAtmosphere, but need base
    const amb = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(amb);

    roomMeshes.clear(); waypointMeshes.clear(); corridorMeshes.clear(); doorMeshes.clear();

    // Cleanup decorations
    decorationMeshes.forEach(m => {
        if (m.parent) m.parent.remove(m);
        if (m.geometry) m.geometry.dispose();
    });
    decorationMeshes = [];
    treePositions = [];
    animatedMaterials = [];
    hiddenDecorationIndices.clear();
    savedPlayerPos.set(0, 0, 0);
    hiddenStaticMeshes = [];
    globalFloorMesh = null;

    wanderers.forEach(w => scene.remove(w.mesh));
    wanderers = [];

    // Clear ghosts
    ghosts.forEach(g => scene.remove(g));
    ghosts = [];

    playerSprite = null;
    if (playerMesh) {
        scene.remove(playerMesh);
        playerMesh = null;
    }
    mixer = null;
    actions = {};
    torchLight = null;
}

function toggleView() {
    combatCameraActive = !combatCameraActive;
    const btn = document.getElementById('viewToggleBtn');
    
    if (btn) {
        btn.innerText = `Combat Camera: ${combatCameraActive ? 'On' : 'Off'}`;
        btn.style.background = combatCameraActive ? '#d4af37' : ''; // Visual feedback
    }

    // If currently in combat, apply immediately
    if (isCombatView) {
        controls.enableRotate = combatCameraActive;
        controls.autoRotate = combatCameraActive;
        if (!combatCameraActive) {
            // Reset to default combat view if turned off
            const arenaPos = BattleIsland.getAnchor();
            const anchorX = arenaPos.x;
            const anchorZ = arenaPos.z;
            const anchorY = 0.1;
            const forward = new THREE.Vector3(0, 0, 1);
            const endPos = new THREE.Vector3(anchorX, anchorY + 1.6, anchorZ).addScaledVector(forward, -3.5);
            new TWEEN.Tween(combatCamera.position).to({ x: endPos.x, y: endPos.y, z: endPos.z }, 500).easing(TWEEN.Easing.Quadratic.Out).start();
            controls.target.copy(new THREE.Vector3(anchorX, anchorY + 1.2, anchorZ));
        }
    }
    
    camera.updateProjectionMatrix();
}
window.toggleView = toggleView;
const viewBtn = document.getElementById('viewToggleBtn');
if (viewBtn) viewBtn.onclick = toggleView;

function startDive() {
    // Hide Logo
    const logo = document.getElementById('gameLogo');
    if (logo) logo.style.opacity = '0';

    // Hide Control Box
    const cb = document.querySelector('.control-box');
    if (cb) cb.style.display = 'none';

    // Show Gameplay Options Button
    const gpOpt = document.getElementById('gameplayOptionsBtn');
    if (gpOpt) gpOpt.style.display = 'flex';

    document.getElementById('avatarModal').style.display = 'flex';
}
window.startDive = startDive;
window.selectAvatar = (sex) => {
    game.sex = sex;
    document.getElementById('avatarModal').style.display = 'none';
    showClassSelection();
};

function showClassSelection() {
    // Create modal for class/mode
    const modal = document.createElement('div');
    modal.id = 'classModal';
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';

    let selectedClass = 'knight';
    let selectedMode = 'checkpoint';

    const iconStyle = (idx) => `width:64px; height:64px; margin:0 auto 10px; background-image:url('assets/images/classes.png'); background-size:900% 100%; background-position:${(idx / 9) * 112.5}% 0%; border:2px solid var(--gold); background-color:rgba(0,0,0,0.5); box-shadow: 0 0 10px rgba(0,0,0,0.5);`;

    // Generate Class Cards Dynamically
    let classHtml = '';
    Object.entries(CLASS_DATA).forEach(([id, data]) => {
        const isSelected = (id === 'knight') ? 'selected' : '';
        classHtml += `
            <div class="class-card ${isSelected}" data-id="${id}" onclick="selectClassUI('${id}')">
                <div style="${iconStyle(data.icon.val)}"></div>
                <div class="class-name">${data.name}</div>
                <div class="class-desc">${data.desc}</div>
            </div>
        `;
    });

    modal.innerHTML = `
        <h2 style="font-family:'Cinzel'; font-size:2.5rem; color:var(--gold); margin-bottom:20px;">Select Class</h2>
        <div class="class-selection-container">
            ${classHtml}
        </div>

        <h2 style="font-family:'Cinzel'; font-size:2rem; color:var(--gold); margin:20px 0;">Game Mode</h2>
        <div class="mode-selection">
            <div class="mode-option">
                <input type="radio" name="gmode" id="m_check" value="checkpoint" checked onchange="selectModeUI('checkpoint')">
                <label for="m_check">Standard (Checkpoint)<br><span style="font-size:0.8rem; color:#888;">Save at start of floor. Retry floor on death.</span></label>
            </div>
            <div class="mode-option">
                <input type="radio" name="gmode" id="m_hard" value="hardcore" onchange="selectModeUI('hardcore')">
                <label for="m_hard">Hardcore (Suspend)<br><span style="font-size:0.8rem; color:#888;">Save anywhere. Death deletes save.</span></label>
            </div>
        </div>

        <button class="v2-btn" id="confirmStartBtn">Begin Dive</button>
    `;

    document.body.appendChild(modal);

    // Helpers attached to window for the inline onclicks
    window.selectClassUI = (id) => {
        selectedClass = id;
        document.querySelectorAll('.class-card').forEach(c => c.classList.remove('selected'));
        document.querySelector(`.class-card[data-id="${id}"]`).classList.add('selected');
    };
    window.selectModeUI = (id) => { selectedMode = id; };

    document.getElementById('confirmStartBtn').onclick = () => {
        game.classId = selectedClass;
        game.mode = selectedMode;
        document.body.removeChild(modal);
        startIntroSequence();
    };
}

function finalizeStartDive() {
    isAttractMode = false;
    // Show Dock when game starts
    const combatArea = document.querySelector('.player-combat-area');
    if (combatArea) combatArea.style.display = 'flex';

    const contBtn = document.getElementById('continueGameBtn');
    if (contBtn) contBtn.style.display = 'none';

    // Apply Class Stats
    const cData = CLASS_DATA[game.classId];
    game.hp = cData.hp;
    game.maxHp = cData.hp;

    game.floor = 1; game.deck = createDeck();
    game.weapon = null; game.weaponDurability = Infinity; game.slainStack = [];
    game.soulCoins = 0; game.ap = 0; game.maxAp = 0;
    game.torchCharge = 20;
    game.equipment = { head: null, chest: null, hands: null, legs: null, weapon: null };
    game.backpack = new Array(24).fill(null); game.hotbar = new Array(6).fill(null);
    game.rooms = generateDungeon(game.floor); game.currentRoomIdx = 0; game.lastAvoided = false;
    game.bonfireUsed = false; game.merchantUsed = false;
    game.currentTrack = null;
    game.visitedWaypoints = [];
    game.enemiesDefeated = 0;

    // Grant Starting Items
    cData.items.forEach(i => {
        let item = i;
        // Resolve ID to full object if it's a reference
        if (i.type === 'armor' && typeof i.id === 'number') item = { ...ARMOR_DATA[i.id], type: 'armor' };
        else if (i.type === 'item' && typeof i.id === 'number') item = { ...ITEM_DATA[i.id], type: 'item' };

        // Auto-equip if possible, else backpack
        if (item.type === 'weapon') {
            game.equipment.weapon = item;
        } else if (item.type === 'armor') {
            game.equipment[item.slot] = item;
        } else {
            // Try hotbar first for items
            if (!addToHotbar(item)) addToBackpack(item);
        }
    });
    recalcAP();
    game.ap = game.maxAp; // Fill AP

    clear3DScene(); init3D();
    // Preload FX textures for particle effects
    preloadFXTextures();
    globalFloorMesh = generateFloorCA(scene, game.floor, game.rooms, corridorMeshes, decorationMeshes, treePositions, loadTexture, getClonedTexture); // Generate Atmosphere and Floor
    updateAtmosphere(game.floor);
    
    // initWanderers();
    updateUI();
    logMsg("The descent begins. Room 0 explored.");

    // Reset Camera for Gameplay
    camera.position.set(20, 20, 20);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);

    // Start BGM
    updateMusicForFloor();

    // Initial Save
    saveGame();
    enterRoom(0);
}

function startIntermission() {
    // Calculate Bonuses
    // Minstrel (Bard) Passive: Silver Tongue (20% Discount)
    const discount = (game.classId === 'bard') ? 0.8 : 1.0;
    if (game.classId === 'bard') logMsg("Silver Tongue: Shop prices reduced by 20%.");

    let bonusMsg = "";
    if (!game.bonfireUsed) {
        game.soulCoins += 50;
        bonusMsg += "Ascetic Bonus: +50 Coins! ";
    }
    if (!game.merchantUsed) {
        game.maxHp += 2; game.hp += 2;
        bonusMsg += "Independent Bonus: +2 Max HP! ";
    }
    if (bonusMsg) logMsg(bonusMsg);

    // Show Shop
    const overlay = document.getElementById('combatModal');
    const enemyArea = document.getElementById('enemyArea');
    overlay.style.display = 'flex';
    document.getElementById('combatContainer').style.display = 'flex';
    document.getElementById('bonfireUI').style.display = 'none';

    // Setup Shop UI
    document.getElementById('combatMessage').innerText = "The Soul Broker";
    document.getElementById('modalAvoidBtn').style.display = 'none';
    document.getElementById('exitCombatBtn').style.display = 'none';
    document.getElementById('descendBtn').style.display = 'none';

    enemyArea.innerHTML = '';
    // Ensure layouts are reset for shop
    enemyArea.classList.remove('boss-grid', 'layout-linear', 'layout-scatter');

    // Soul Broker & Coins UI
    const brokerContainer = document.createElement('div');
    brokerContainer.style.cssText = "width:100%; text-align:center; margin-bottom:15px; display:flex; flex-direction:column; align-items:center;";
    brokerContainer.innerHTML = `
        <div style="color:#d4af37; font-size:24px; font-weight:bold; text-shadow:0 2px 4px #000;">
            Soul Coins: <span id="shopCoinDisplay" style="color:#fff;">${game.soulCoins}</span>
        </div>
    `;
    enemyArea.appendChild(brokerContainer);

    // Show Soul Broker Portrait
    const mp = ensureMerchantPortrait();
    mp.innerHTML = `<img src="assets/images/visualnovel/soulbroker.png">`;
    mp.style.display = 'flex';
    // Defer update slightly to ensure layout is settled
    requestAnimationFrame(updateMerchantPortraitPosition);

    enemyArea.classList.remove('boss-grid', 'layout-linear', 'layout-scatter', 'layout-corners', 'layout-introverted', 'layout-diagonal');
    enemyArea.classList.add('layout-merchant'); // Force 2x2 grid

    const itemsContainer = document.createElement('div');
    // We let CSS grid handle layout now
    itemsContainer.style.cssText = "display:contents;"; 
    enemyArea.appendChild(itemsContainer);

    // Render Shop Items (Random selection of 4)
    // Mix armor and items
    const pool = [...ARMOR_DATA.map(a => ({ ...a, type: 'armor' })), ...ITEM_DATA.map(i => ({ ...i, type: 'item' })), ...CURSED_ITEMS];
    shuffle(pool);

    for (let i = 0; i < 4; i++) {
        const item = pool[i];
        const card = document.createElement('div');
        const finalCost = Math.floor(item.cost * discount);
        card.className = 'card shop-item';

        const asset = getAssetData(item.type, item.id || item.val, null);

        const tint = item.isCursed ? 'filter: sepia(1) hue-rotate(60deg) saturate(3) contrast(1.2);' : '';
        const sheetCount = asset.sheetCount || 9;
        const bgSize = `${sheetCount * 100}% 100%`;
        const bgPos = `${(asset.uv.u * sheetCount) / (sheetCount - 1) * 100}% 0%`;

        card.innerHTML = `
            <div class="card-art-container" style="background-image: url('assets/images/${asset.file}'); background-size: ${bgSize}; background-position: ${bgPos}; ${tint}"></div>
            <div class="name" style="bottom: 40px; font-size: 14px; ${item.isCursed ? 'color:#adff2f;' : ''}">${item.name}</div>
            <div class="val" style="font-size: 16px; color: #ffd700;">${finalCost}</div>
            <div style="position:absolute; bottom:5px; width:100%; text-align:center; font-size:10px; color:#aaa;">${item.type === 'armor' ? `+${item.ap} AP` : (item.isCursed ? 'Cursed' : 'Item')}</div>
        `;

        card.onclick = () => {
            if (game.soulCoins >= finalCost) {
                if (getFreeBackpackSlot() === -1) {
                    spawnFloatingText("Backpack Full!", window.innerWidth / 2, window.innerHeight / 2, '#ffaa00');
                    return;
                }
                game.soulCoins -= finalCost;
                document.getElementById('shopCoinDisplay').innerText = game.soulCoins;

                // Handle Cursed Ring Passive immediately if bought
                if (item.id === 'cursed_ring') {
                    game.maxHp += 10; game.hp += 10;
                    logMsg("The Ring of Burden binds to you. (+10 Max HP)");
                }

                addToBackpack(item);

                spawnFloatingText("Purchased!", window.innerWidth / 2, window.innerHeight / 2, '#00ff00');
                card.style.opacity = 0.5;
                card.style.pointerEvents = 'none';
                updateUI();
            } else {
                spawnFloatingText("Not enough coins!", window.innerWidth / 2, window.innerHeight / 2, '#ff0000');
            }
        };

        // Tooltip Events for Shop Items
        card.onmouseenter = () => {
            const tooltip = document.getElementById('gameTooltip');
            if (tooltip) {
                tooltip.style.display = 'block';
                tooltip.innerHTML = `<strong style="color:${item.isCursed ? '#adff2f' : '#ffd700'}; font-size:16px;">${item.name}</strong><br/><span style="color:#aaa; font-size:12px;">${item.type === 'armor' ? `+${item.ap} AP` : 'Item'}</span><br/><div style="margin-top:4px; color:#ddd;">${item.desc || ''}</div>`;
                const rect = card.getBoundingClientRect();
                tooltip.style.left = (rect.right + 10) + 'px';
                tooltip.style.top = rect.top + 'px';
            }
        };
        card.onmouseleave = () => { const t = document.getElementById('gameTooltip'); if (t) t.style.display = 'none'; };

        itemsContainer.appendChild(card);
    }

    // Add "Next Floor" button to enemyArea or reuse existing buttons?
    // Let's repurpose the descend button but change its onclick
    const nextBtn = document.getElementById('descendBtn');
    nextBtn.innerText = "Enter Next Floor";
    nextBtn.style.display = 'block';
    nextBtn.onclick = () => {
        nextBtn.innerText = "Descend"; // Reset text
        nextBtn.onclick = startIntermission; // Reset handler to intermission

        descendToNextFloor();
    };
}

function descendToNextFloor() {
    game.floor++; closeCombat();
    game.deck = createDeck(); game.rooms = generateDungeon(game.floor);
    game.currentRoomIdx = 0; game.lastAvoided = false;
    game.bonfireUsed = false; game.merchantUsed = false;
    game.pendingPurchase = null;
    game.isBossFight = false;
    game.currentTrack = null; // Force music re-eval
    game.visitedWaypoints = [];

    // Map Item Check
    const hasMap = game.hotbar.some(i => i && i.type === 'item' && i.id === 3);
    if (hasMap) {
        game.rooms.forEach(r => r.isRevealed = true);
    }

    clear3DScene(); init3D();
    // Preload FX textures for particle effects
    preloadFXTextures();
    globalFloorMesh = generateFloorCA(scene, game.floor, game.rooms, corridorMeshes, decorationMeshes, treePositions, loadTexture, getClonedTexture);
    updateAtmosphere(game.floor);
    // initWanderers();

    updateUI();
    logMsg(`Descending deeper... Floor ${game.floor}`);
    enterRoom(0);
    updateMusicForFloor();

    // Checkpoint Save: Save state at start of new floor (after generation)
    if (game.mode === 'checkpoint') saveGame();
}

function enterRoom(id) {
    const oldId = game.currentRoomIdx; game.currentRoomIdx = id;
    const room = game.rooms.find(r => r.id === id);
    movePlayerSprite(oldId, id);

    // --- CURSED ITEM EFFECTS ---
    // Bloodthirst Blade: Drains 1 HP on room entry (except waypoints)
    if (game.equipment.weapon && game.equipment.weapon.id === 'cursed_blade' && !room.isWaypoint && id !== 0) {
        takeDamage(1);
        logMsg("The Bloodthirst Blade drinks your vitality... (-1 HP)");
        
        // Visual FX for Life Drain
        if (use3dModel && playerMesh) {
            spawn3DDrainFX(playerMesh.position);
        } else {
            spawnAboveModalTexture('circle_03.png', window.innerWidth/2, window.innerHeight/2, 1, { tint: '#880000', blend: 'multiply', size: 300, decay: 0.02 });
        }
        updateUI();
    }

    // Hardcore Auto-Save on Room Entry
    if (game.mode === 'hardcore') saveGame();

    if (room.isWaypoint) { 
        logMsg("Traversing corridors..."); 
        
        // Confessor (Priest) Passive: Pilgrimage
        if (game.classId === 'priest') {
            if (!game.visitedWaypoints) game.visitedWaypoints = [];
            if (!game.visitedWaypoints.includes(room.id)) {
                game.visitedWaypoints.push(room.id);
                if (game.visitedWaypoints.length % 6 === 0) {
                    game.hp = Math.min(game.maxHp, game.hp + 1);
                    logMsg("Pilgrimage: Faith restores 1 HP.");
                    updateUI();
                }
            }
        }
        // Strider (Ranger) Passive: Scout
        if (game.classId === 'ranger') {
            room.connections.forEach(cid => { const r = game.rooms.find(rm => rm.id === cid); if(r) r.isRevealed = true; });
        }
        return; 
    }

    if (room.state === 'cleared' && !room.isFinal) { logMsg("Safe passage."); return; }
    if (room.state === 'cleared' && room.isFinal) { game.activeRoom = room; showCombat(); return; }

    if (room.isLocked && room.state !== 'cleared') {
        game.activeRoom = room;
        startLockpickGame(room);
        return;
    }

    if (room.isTrap && room.state !== 'cleared') {
        game.activeRoom = room;
        game.chosenCount = 0;
        showTrapUI();
        return;
    }

    if (room.isAlchemy && room.state !== 'cleared') {
        game.activeRoom = room;
        showAlchemyPrompt();
        return;
    }

    if (room.isShrine && room.state !== 'cleared') {
        game.activeRoom = room;
        showShrineUI();
        return;
    }

    if (room.isSpecial && room.state !== 'cleared') {
        game.activeRoom = room;

        // Persistence Check
        if (!room.generatedContent) {
            const gifts = [];
            // Add 3 random options (Weapon, Potion, Armor)
            for (let i = 0; i < 3; i++) {
                const roll = Math.random();
                if (roll < 0.4) {
                    // Weapon (Diamond 11-14)
                    const val = 11 + Math.floor(Math.random() * 4);
                    let name = `Divine Weapon (${val})`;
                    let isSpell = false;

                    if (game.classId === 'occultist') {
                        name = getSpellName(val);
                        isSpell = true;
                    }

                    const isMimic = Math.random() < 0.05; // 5% Mimic Chance

                    gifts.push({
                        suit: SUITS.DIAMONDS, val: val, type: 'gift', name: name,
                        actualGift: { suit: SUITS.DIAMONDS, val: val, type: 'weapon', name: name, isSpell: isSpell, isMimic: isMimic }
                    });
                } else if (roll < 0.7) {
                    // Potion (Heart 11-14)
                    const val = 11 + Math.floor(Math.random() * 4);
                    gifts.push({
                        suit: SUITS.HEARTS, val: val, type: 'gift', name: `Elixir of Life (${val})`,
                        actualGift: { suit: SUITS.HEARTS, val: val, type: 'potion', name: `Elixir of Life (${val})` }
                    });
                } else {
                    // Armor
                    const armor = ARMOR_DATA[Math.floor(Math.random() * ARMOR_DATA.length)];
                    const isMimic = Math.random() < 0.05;
                    gifts.push({ suit: '🛡️', val: armor.ap, type: 'gift', name: armor.name, actualGift: { ...armor, type: 'armor', isMimic: isMimic } });
                }
            }

            // Add Repair option if we have a weapon
            if (game.equipment.weapon || game.maxAp > 0) {
                const boost = Math.floor(Math.random() * 6) + 1;
                gifts.push({
                    suit: '🛠️', val: boost, type: 'gift',
                    name: `Blacksmith's Service`,
                    actualGift: { type: 'repair', val: boost, name: game.equipment.weapon ? `Repaired ${game.equipment.weapon.name}` : `Gear Repaired` }
                });
            }
            room.generatedContent = gifts;
        }

        game.combatCards = room.generatedContent; // Load persistent gifts
        game.chosenCount = 0; game.potionsUsedThisTurn = false;
        
        // --- Merchant (Gift) Room Setup ---
        logMsg(`Merchant's Gift: Choose one item freely.`);
        
        // Force Merchant Layout (2x2 Grid)
        const enemyArea = document.getElementById('enemyArea');
        enemyArea.classList.remove('boss-grid', 'layout-linear', 'layout-scatter', 'layout-corners', 'layout-introverted', 'layout-diagonal');
        enemyArea.classList.add('layout-merchant');

        showCombat();
        // Update header after showCombat() might have reset it
        document.getElementById('combatMessage').innerText = "The Merchant's Gift";
        // Ensure Merchant Portrait is visible
        const mp = ensureMerchantPortrait();
        mp.innerHTML = `<img src="assets/images/visualnovel/merchant_front.png">`;
        requestAnimationFrame(updateMerchantPortraitPosition);
        
        mp.style.display = 'flex';
        return;
    }
    if (room.isBonfire && room.state !== 'cleared') {
        game.activeRoom = room;
        // Check if generatedContent exists (it should via map gen), 
        // but for bonfires we use room.restRemaining directly. 
        // We don't use combatCards for persistent bonfire UI.

        // Persistence Check (ensure restRemaining is set if valid room)
        if (room.restRemaining === undefined) room.restRemaining = 3;

        game.chosenCount = 0; game.potionsUsedThisTurn = false;
        showBonfireUI();
        return;
    }
    if (room.cards.length === 0 && id !== 0) {
        // If entering a room that was previously cleared or empty, don't spawn cards
        room.cards = (game.carryCard && !room.isShrine) ? [game.carryCard] : [];
        game.carryCard = null;
        while (room.cards.length < 4 && game.deck.length > 0) room.cards.push(game.deck.shift());
    } else if (id === 0) {
        // Room 0 is always safe start, ensure carryCard persists if somehow set
        room.cards = [];
    }
    game.activeRoom = room; game.combatCards = [...room.cards];
    game.chosenCount = 0; game.potionsUsedThisTurn = false;
    if (id !== 0) showCombat();
}

function startBossFight() {
    game.isBossFight = true;
    game.activeRoom.state = 'boss_active';
    game.chosenCount = 0;

    const guardians = ['guardian_abyssal_maw', 'guardian_gargoyle', 'guardian_ironclad_sentinel'];
    const selectedGuardian = guardians[Math.floor(Math.random() * guardians.length)];

    // Define Boss Plans (Minion Configurations)
    const plans = [
        {
            name: "The Phalanx",
            minions: [
                { slot: 'boss-weapon', name: "Vanguard", val: 10 + game.floor, role: 'vanguard' },
                { slot: 'boss-potion', name: "Mystic", val: 5, role: 'mystic' },
                { slot: 'boss-armor', name: "Bulwark", val: 10 + game.floor, role: 'bulwark' }
            ]
        },
        {
            name: "The Council",
            minions: [
                { slot: 'boss-weapon', name: "Sorcerer", val: 8 + game.floor, role: 'sorcerer' }, // Magic/Heart
                { slot: 'boss-potion', name: "Architect", val: 12 + game.floor, role: 'architect' }, // Structure/Block
                { slot: 'boss-armor', name: "Loyalist", val: 10 + game.floor, role: 'loyalist' } // Shield/Armor
            ]
        },
        {
            name: "The Fortress",
            minions: [
                { slot: 'boss-weapon', name: "Architect", val: 10 + game.floor, role: 'architect' },
                { slot: 'boss-potion', name: "Architect", val: 10 + game.floor, role: 'architect' },
                { slot: 'boss-armor', name: "Bulwark", val: 12 + game.floor, role: 'bulwark' }
            ]
        }
    ];

    const plan = plans[Math.floor(Math.random() * plans.length)];
    logMsg(`The Guardian employs ${plan.name}!`);

    game.combatCards = plan.minions.map(m => ({
        type: 'monster', val: m.val, suit: SUITS.SKULLS, name: `Guardian's ${m.name}`, bossSlot: m.slot, customAsset: m.asset, customUV: m.uv, bossRole: m.role
    }));

    // Add the Guardian itself
    // Health/Damage = 20 + Floor
    game.combatCards.push({ type: 'monster', val: 20 + game.floor, suit: SUITS.SKULLS, name: "The Guardian", bossSlot: 'boss-guardian', customAnim: selectedGuardian });
    game.combatCards.push({ 
        type: 'monster', 
        val: 20 + game.floor, 
        suit: SUITS.SKULLS, 
        name: "The Guardian", 
        bossSlot: 'boss-guardian', 
        customAsset: `animations/${selectedGuardian}.png`, 
        customBgSize: '2500% 100%', 
        isAnimated: true 
    });

    showCombat();
}

function startSoulBrokerEncounter() {
    game.isBossFight = true;
    game.isBrokerFight = true;
    game.activeRoom.state = 'boss_active';
    game.chosenCount = 0;

    logMsg("The Soul Broker reveals his true form!");

    // Narrative Popup (Optional, using log for now)
    spawnFloatingText("THE FINAL DEBT", window.innerWidth / 2, window.innerHeight / 2 - 100, '#d4af37');
    updateBossBar(30, 60, true); // Show bar (Start at 30, Max 60)

    // The Soul Broker Boss
    // Diamond formation with 3 Guardians as minions (Level 2 stats ~19)
    game.combatCards = [
        {
            type: 'monster', val: 19, suit: '💀', name: "Abyssal Maw", bossSlot: 'boss-weapon',
            customAsset: 'animations/guardian_abyssal_maw.png', customBgSize: '2500% 100%', isAnimated: true
        },
        {
            type: 'monster', val: 19, suit: '💀', name: "Ironclad Sentinel", bossSlot: 'boss-armor',
            customAsset: 'animations/guardian_ironclad_sentinel.png', customBgSize: '2500% 100%', isAnimated: true
        },
        {
            type: 'monster', val: 19, suit: '💀', name: "Gargoyle", bossSlot: 'boss-potion',
            customAsset: 'animations/guardian_gargoyle.png', customBgSize: '2500% 100%', isAnimated: true
        },
        {
            type: 'monster', val: 30, suit: '👺', name: "The Soul Broker",
            bossSlot: 'boss-guardian',
            customAsset: 'animations/final.png', // Explicitly set asset path
            customBgSize: '2500% 100%', // Ensure 25-frame animation scaling
            customAsset: 'animations/final.png',
            customBgSize: '2500% 100%',
            isAnimated: true,
            isBroker: true
        }
    ];

    showCombat();
}

function showCombat() {
    const overlay = document.getElementById('combatModal');
    const enemyArea = document.getElementById('enemyArea');
    overlay.style.display = 'flex';
    audio.setMusicMuffled(true); // Muffle music during combat
    enemyArea.innerHTML = '';
    // audio.play('card_shuffle', { volume: 0.5, rate: 0.95 + Math.random() * 0.1 });

    // --- 3D COMBAT SETUP ---
    if (use3dModel) {
        const alreadyInCombat = isCombatView;
        enterCombatView();
        overlay.style.background = 'rgba(0,0,0,0)'; // Transparent modal

        // FIX: Allow clicks to pass through modal to the 3D canvas for OrbitControls
        overlay.style.pointerEvents = 'none';
        // Re-enable clicks on specific UI elements
        const interactables = ['exitCombatBtn', 'modalAvoidBtn', 'descendBtn', 'bonfireNotNowBtn'];
        interactables.forEach(id => {
            const el = document.getElementById(id);
            if(el) el.style.pointerEvents = 'auto';
        });

        // Clear previous 3D entities
        while (combatGroup.children.length > 0) {
            combatGroup.remove(combatGroup.children[0]);
        }
        combatEntities = [];

        // Hide Current Room Mesh to prevent camera blocking
        // if (game.activeRoom && roomMeshes.has(game.activeRoom.id)) {
        //     roomMeshes.get(game.activeRoom.id).visible = false;
        // }

        // Determine Anchor Position (Room Center)
        // Use activeRoom coordinates to ensure stability even if player is moving
        // BATTLE ISLAND UPDATE: Use the Arena Anchor
        const arenaPos = BattleIsland.getAnchor();
        const anchorX = arenaPos.x;
        const anchorZ = arenaPos.z;
        const anchorY = 0.1;

        // Snap Player to Position (ensure they are at the stand marker)
        if (playerMesh) {
            // We don't stop tweens here to avoid breaking other FX, but we force position
            playerMesh.position.set(anchorX, anchorY, anchorZ);
            playerMesh.lookAt(anchorX, anchorY, anchorZ + 4);
        }

        // Determine Orientation (Face a corridor if possible)
        // BATTLE ISLAND: Always face North (Z+) or South (Z-) depending on preference. Let's use Z+ (0,0,1)
        let forward = new THREE.Vector3(0, 0, 1); 
        const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), forward).normalize();

        // Snap Player Rotation
        if (playerMesh) {
            const lookTarget = new THREE.Vector3(anchorX, anchorY, anchorZ).add(forward);
            playerMesh.lookAt(lookTarget);
        }

        // Only swoop camera if entering combat for the first time
        if (!alreadyInCombat) {
            // Setup Perspective Camera (Start high and behind relative to forward)
            const startPos = new THREE.Vector3(anchorX, anchorY + 8, anchorZ).addScaledVector(forward, -8);
            combatCamera.position.copy(startPos);
            combatCamera.lookAt(anchorX, anchorY, anchorZ);

            // Tween Camera to Shoulder position
            // Pos = Anchor - Forward * 3.5 + Up * 1.6
            const endPos = new THREE.Vector3(anchorX, anchorY + 1.6, anchorZ).addScaledVector(forward, -3.5);
            new TWEEN.Tween(combatCamera.position)
                .to({ x: endPos.x, y: endPos.y, z: endPos.z }, 1200)
                .easing(TWEEN.Easing.Quadratic.Out)
                .start();

            // Switch Controls to Perspective Camera temporarily
            controls.object = combatCamera;
            // Look Target: Player Center (Anchor) + Up * 1.2
            // This allows orbiting around the player character
            const lookAtPos = new THREE.Vector3(anchorX, anchorY + 1.2, anchorZ);
            controls.target.copy(lookAtPos);
            controls.minDistance = 2.0;
            controls.maxDistance = 8.0;
            controls.autoRotate = combatCameraActive; // "Intro Logo" Spin Effect (Respect Preference)
            controls.autoRotateSpeed = 1.0;

            controls.enableRotate = combatCameraActive; // Respect user preference
            controls.enablePan = false;   // Keep focus on the arena
            controls.maxPolarAngle = Math.PI / 2 - 0.1; // Prevent camera from going underground
            // Enable Middle Mouse Rotation for Combat
            controls.mouseButtons = {
                LEFT: THREE.MOUSE.ROTATE,
                MIDDLE: THREE.MOUSE.ROTATE,
                RIGHT: THREE.MOUSE.ROTATE // Allow Right Click to orbit as well
            };
        }

        // Spawn 3D Entities
        game.combatCards.forEach((c, i) => {
            let entity;
            if (c.type === 'monster') {
                entity = new Standee();
            } else {
                entity = new OpenChest();
            }

            let assetData = getAssetData(c.type, c.val, c.suit, c.type === 'gift' ? c.actualGift : null);

            // Override for Animated Monsters
            if (c.type === 'monster' && c.val >= 1 && !c.customAsset) {
                let suitName = 'club';
                if (c.suit === SUITS.SPADES) suitName = 'spade';
                else if (c.suit === SUITS.SKULLS) suitName = 'skull';
                else if (c.suit === SUITS.MENACES) suitName = 'menace';

                const clampedVal = Math.min(c.val, 14);
                const rankName = { 1: '1', 2: '1', 3: '1', 4: '2', 5: '2', 6: '3', 7: '3', 8: '4', 9: '4', 10: '5', 11: 'jack', 12: 'queen', 13: 'king', 14: 'ace' }[clampedVal];

                assetData = {
                    file: `animations/${suitName}_${rankName}.png`,
                    uv: { u: 0, v: 0 },
                    isStrip: true,
                    sheetCount: 25,
                    isAnimated: true
                };
            } else if (c.customAsset) {
                assetData = {
                    file: c.customAsset,
                    uv: { u: 0, v: 0 },
                    isStrip: true,
                    sheetCount: 25,
                    isAnimated: c.isAnimated || false
                };
            }

            if (c.type === 'monster') {
                entity.assemble(c, assetData);
            } else {
                entity.setArt(assetData);
            }

            // Add simple text label under sprite
            const valStr = (c.type === 'monster' || c.type === 'weapon' || c.type === 'potion') ? `${c.val}` : '';

            let labelColor = '#ffffff';
            if (c.type === 'monster') {
                if (c.bossSlot || c.val > 14) labelColor = '#ffd700'; // Gold (Guardians/Boss)
                else if (c.val >= 11) labelColor = '#aa00ff'; // Purple (11-14)
                else if (c.val >= 9) labelColor = '#008800'; // Dark Green (9-10)
                else if (c.val >= 6) labelColor = '#ffaa00'; // Orange (6-8)
            } else if (c.type === 'weapon') {
                labelColor = '#ff4444'; // Red
            } else if (c.type === 'potion' || c.type === 'item' || c.type === 'gift') {
                labelColor = '#44ff44'; // Nice Green
            }
            const suitLabel = c.suit ? `${c.suit}: ` : 'Val: ';

            // Only add floating label for non-monsters (monsters have text on card)
            if (c.type !== 'monster') {
                entity.setLabel(c.name, valStr ? `${suitLabel}${valStr}` : '', labelColor);
            }

            // Scale Boss Standees (3D)
            if (c.bossSlot === 'boss-guardian') {
                if (c.isBroker) {
                    entity.scale.set(2.0, 2.0, 2.0);
                } else {
                    entity.scale.set(1.5, 1.5, 1.5);
                }
            }

            let xOff = 0;
            let zOff = 0;

            if (game.isBossFight && c.bossSlot) {
                // Diamond Layout for Boss
                // Broker (Guardian Slot) -> Back Center
                // Weapon (Left) -> Left
                // Potion (Right) -> Right
                // Armor (Front) -> Front Center
                
                if (c.bossSlot === 'boss-guardian') {
                    xOff = 0; zOff = 4.0; // Back
                } else if (c.bossSlot === 'boss-weapon') {
                    xOff = -2.0; zOff = 2.5; // Left
                } else if (c.bossSlot === 'boss-potion') {
                    xOff = 2.0; zOff = 2.5; // Right
                } else if (c.bossSlot === 'boss-armor') {
                    xOff = 0; zOff = 1.0; // Front
                }
            } else {
                // Standard Staggered "V" Layout
                // 0: Left Outer (Row 2) -> right*-1.5 + fwd*1.5
                // 1: Left Inner (Row 1) -> right*-0.5 + fwd*2.5
                // 2: Right Inner (Row 1) -> right*0.5 + fwd*2.5
                // 3: Right Outer (Row 2) -> right*1.5 + fwd*1.5
                xOff = (i - 1.5) * 1.5; // Default spread
                zOff = 2.0;
                if (i === 0 || i === 3) { zOff = 1.5; xOff = (i === 0 ? -1.5 : 1.5); }
                if (i === 1 || i === 2) { zOff = 2.5; xOff = (i === 1 ? -0.5 : 0.5); }
            }

            entity.position.copy(new THREE.Vector3(anchorX, 0, anchorZ).addScaledVector(right, xOff).addScaledVector(forward, zOff));
            entity.lookAt(anchorX, 0, anchorZ); // Face player

            // UserData for Raycasting
            entity.userData = { cardIdx: i, isCombatEntity: true };

            combatGroup.add(entity);
            combatEntities.push(entity);
        });
    } else {
        overlay.style.background = 'rgba(0,0,0,0.85)';
    }

    const isGiftRoom = game.combatCards.length > 0 && game.combatCards[0].type === 'gift';

    if (game.isBossFight) {
        enemyArea.classList.remove('layout-merchant');
        enemyArea.classList.add('boss-grid');
    } else {
        enemyArea.classList.remove('boss-grid');
        
        // Randomize Card Layout for Standard Encounters (2D Mode mostly)
        // Reset classes
        enemyArea.classList.remove('layout-linear', 'layout-scatter', 'layout-corners', 'layout-introverted', 'layout-diagonal');

        if (isGiftRoom) {
            // Apply forced merchant layout
            if (!enemyArea.classList.contains('layout-merchant')) {
                enemyArea.classList.add('layout-merchant');
            }
        } else {
            // Ensure merchant layout is GONE for normal fights
            enemyArea.classList.remove('layout-merchant');

            if (!use3dModel) {
                // Random pick
                const layouts = ['layout-linear', 'layout-scatter', 'layout-corners', 'layout-introverted', 'layout-diagonal'];
                const pick = layouts[Math.floor(Math.random() * layouts.length)];
                enemyArea.classList.add(pick);
            } else {
                 // Default to linear if 3D (overlay should generally stay out of way, or standard)
                 enemyArea.classList.add('layout-linear');
            }
        }
    }

    game.combatCards.forEach((c, idx) => {
        const card = document.createElement('div');
        card.className = `card ${c.type} ${use3dModel ? '' : 'dealing'} ${c.bossSlot || ''}`;
        card.style.animationDelay = `${idx * 0.1}s`;

        let asset = getAssetData(c.type, c.val, c.suit, c.type === 'gift' ? c.actualGift : null);
        let bgUrl = `assets/images/${asset.file}`;
        const sheetCount = asset.sheetCount || 9;
        let bgSize = asset.isStrip ? `${sheetCount * 100}% 100%` : 'cover';
        let bgPos = `${(asset.uv.u * sheetCount) / (sheetCount - 1) * 100}% 0%`;
        let animClass = "";

        // 3D Mode: Hide the 2D card visuals but keep element for layout/clicking
        if (use3dModel) {
            card.style.opacity = '0';
            card.style.pointerEvents = 'none'; // Allow clicking through to 3D scene
        }

        // Custom Asset Overrides (for Boss Parts)
        if (c.customAsset) {
            bgUrl = `assets/images/${c.customAsset}`;
            bgSize = c.customBgSize || '900% 100%';
            // Fix: 100 / 8 = 12.5% per step for 9-slice strip
            bgPos = `${(c.customUV || 0) * 12.5}% 0%`;
        }

        if (c.isAnimated) {
            animClass = "animated-card-art";
        }

        // Scale Boss Cards
        if (c.bossSlot === 'boss-guardian') {
            if (c.isBroker) {
                card.style.transform = "scale(2.0)";
                card.style.zIndex = "100"; // Ensure on top
            } else {
                card.style.transform = "scale(1.5)";
                card.style.zIndex = "50";
            }
        }

        // Boss Animations: 11-14 Clubs/Spades
        // if (c.type === 'monster' && c.val >= 11) {
        // all monster cards now have sprite sheet animations. 
        if (c.type === 'monster' && c.val >= 1 && !c.customAsset) {
            let suitName = 'club';
            if (c.suit === SUITS.SPADES) suitName = 'spade';
            else if (c.suit === SUITS.SKULLS) suitName = 'skull';
            else if (c.suit === SUITS.MENACES) suitName = 'menace';

            // const rankName = { 11: 'jack', 12: 'queen', 13: 'king', 14: 'ace' }[c.val];
            const clampedVal = Math.min(c.val, 14);
            const rankName = { 1: '1', 2: '1', 3: '1', 4: '2', 5: '2', 6: '3', 7: '3', 8: '4', 9: '4', 10: '5', 11: 'jack', 12: 'queen', 13: 'king', 14: 'ace' }[clampedVal];
            bgUrl = `assets/images/animations/${suitName}_${rankName}.png`;
            bgSize = "2500% 100%"; // 25 framing spritesheet
            bgPos = "0% 0%";
            animClass = "animated-card-art";

            // Special override for the Guardian Boss Card
            if (c.bossSlot === 'boss-guardian') {
                // Use a specific boss sprite if available, or fallback to King/Ace
                // Assuming animations are in the same folder
                bgUrl = `assets/images/animations/${c.customAnim || 'spade_king'}.png`;
            }
        }

        card.innerHTML = `
                    <div class="card-art-container ${animClass}" style="background-image: url('${bgUrl}'); background-size: ${bgSize}; background-position: ${bgPos}"></div>
                    <div class="suit" style="background: rgba(0,0,0,0.5); border-radius: 50%; width: 40px; text-align: center;">${c.suit}</div>
                    <div class="val" style="color: ${c.isCursed ? '#adff2f' : '#fff'}; text-shadow: 2px 2px 0 #000;">${getDisplayVal(c.val)}</div>
                    <div class="name">${c.name}</div>
                `;
        card.onclick = (e) => pickCard(idx, e);
        enemyArea.appendChild(card);
    });

    // If room is cleared, we show the Exit button, otherwise the Avoid button
    const msgEl = document.getElementById('combatMessage');
    if (game.activeRoom && game.activeRoom.state === 'cleared') {
        if (game.activeRoom.isFinal) {
            // Updated AllCleared Logic: Matches HUD (Exclude Bonfires/Specials)
            const allCleared = game.rooms.every(r => 
                r.isWaypoint || 
                r.isSpecial || 
                r.isBonfire || 
                r.state === 'cleared' || 
                r.state === 'boss_active'
            );

            if (allCleared) {
                msgEl.innerText = "The Guardian awaits.";
                document.getElementById('descendBtn').style.display = 'block';
                document.getElementById('descendBtn').innerText = "Confront Guardian";
                document.getElementById('descendBtn').onclick = (e) => { if(e) e.stopPropagation(); startBossFight(); };
            } else {
                msgEl.innerText = "Clear all rooms.";
                document.getElementById('descendBtn').style.display = 'none';
            }
            document.getElementById('exitCombatBtn').style.display = (allCleared ? 'none' : 'block');
        } else {
            msgEl.innerText = "Safe passage.";
            document.getElementById('exitCombatBtn').style.display = 'block';
            document.getElementById('descendBtn').style.display = 'none';
        }
        document.getElementById('modalAvoidBtn').style.display = 'none';
    } else {
        if (game.isBossFight) {
            msgEl.innerText = "THE GUARDIAN AWAKENS!";
        } else
            if (game.combatCards[0] && game.combatCards[0].type === 'gift') {
                msgEl.innerText = "Choose your blessing...";
            } else {
                msgEl.innerText = game.chosenCount === 0 ? "Room Encounter! Pick 3 cards..." : `Battle in progress! Pick ${3 - game.chosenCount} more cards...`;
            }
        document.getElementById('exitCombatBtn').style.display = 'none';
        document.getElementById('modalAvoidBtn').style.display = (game.combatCards[0] && game.combatCards[0].type === 'gift' ? 'none' : 'inline-block');
        document.getElementById('descendBtn').style.display = 'none';
    }

    // Fix Retreat Button State (Explicitly update disabled state)
    const avoidBtn = document.getElementById('modalAvoidBtn');
    if (avoidBtn) {
        const hasBurden = game.hotbar.some(i => i && i.id === 'cursed_ring');
        avoidBtn.disabled = (game.lastAvoided || game.chosenCount > 0 || hasBurden);
        
        if (hasBurden) avoidBtn.title = "Ring of Burden prevents escape!";
        else if (game.lastAvoided) avoidBtn.title = "Cannot avoid two rooms in a row.";
        else if (game.chosenCount > 0) avoidBtn.title = "Combat started, cannot flee.";
        else avoidBtn.title = "Avoid this room (shuffle back to deck).";
    }

    // Merchant portrait and 'Not Now' button for special rooms (merchant)
    const isMerchant = (game.combatCards[0] && game.combatCards[0].type === 'gift');
    const mp = ensureMerchantPortrait();
    if (isMerchant) {
        mp.innerHTML = `<img src="assets/images/visualnovel/merchant_front.png">`;
        mp.style.display = 'flex';
        requestAnimationFrame(updateMerchantPortraitPosition);
    } else {
        mp.style.display = 'none';
    }
    document.getElementById('bonfireNotNowBtn').style.display = (game.activeRoom && (game.activeRoom.isBonfire || (game.activeRoom.isSpecial && isMerchant)) && game.activeRoom.state !== 'cleared') ? 'inline-block' : 'none';

    updateUI();
}

function getBestCombatOrientation(anchorX, anchorZ) {
    const candidates = [];
    
    // 1. Directions towards connections
    if (game.activeRoom && game.activeRoom.connections) {
        game.activeRoom.connections.forEach(cid => {
            const target = game.rooms.find(r => r.id === cid);
            if (target) {
                const dir = new THREE.Vector3(target.gx - anchorX, 0, target.gy - anchorZ).normalize();
                candidates.push({ dir: dir, type: 'connection' });
            }
        });
    }

    // 2. Cardinal directions (always available as fallback)
    const cardinals = [
        new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
        new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0)
    ];
    cardinals.forEach(d => candidates.push({ dir: d, type: 'cardinal' }));

    let bestDir = new THREE.Vector3(0, 0, 1);
    let maxScore = -Infinity;

    candidates.forEach(c => {
        // Camera is placed BEHIND the player (opposite to forward)
        // Pos = Anchor - Forward * 3.5
        const camPos = new THREE.Vector3(anchorX, 0, anchorZ).addScaledVector(c.dir, -3.5);
        
        let score = 0;
        // Prefer connections (player faces enemy/door)
        if (c.type === 'connection') score += 10;

        // Check distance to all other rooms to avoid clipping
        let minRoomDist = Infinity;
        game.rooms.forEach(r => {
            if (game.activeRoom && r.id === game.activeRoom.id) return; // Ignore current room
            const dist = Math.hypot(r.gx - camPos.x, r.gy - camPos.z);
            if (dist < minRoomDist) minRoomDist = dist;
        });

        // If camera is too close to another room, heavily penalize
        if (minRoomDist < 2.0) score -= 1000;
        else if (minRoomDist < 4.0) score -= 50; 
        
        // Add distance as tie breaker (more space is better)
        score += minRoomDist;

        if (score > maxScore) {
            maxScore = score;
            bestDir = c.dir;
        }
    });

    return bestDir;
}

// Helper for player attack visuals
function triggerPlayerAttackAnim(x, y, weapon) {
    // Occultist Spell FX
    if (weapon && game.classId === 'occultist' && weapon.isSpell) {
        const val = weapon.val;

        // 3D Magic Circle Logic (Targeted)
        if (use3dModel && playerMesh) {
            // Calculate target position (approximate forward from player)
            const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(playerMesh.quaternion);
            const targetPos = playerMesh.position.clone().add(forward.multiplyScalar(4));
            targetPos.y = 0.1; // Floor level

            spawn3DMagicCircle(targetPos, val);
            // Projectile from hand to target
            spawn3DProjectile(playerMesh.position, targetPos, val);
        }

        // Trigger Magic Circle Shader
        let circleColor = [1, 1, 1];
        if (val === 2 || val === 7 || val === 11) circleColor = [1.0, 0.5, 0.0]; // Orange/Red
        else if (val === 3) circleColor = [0.0, 1.0, 1.0]; // Ice Blue
        else if (val === 4) circleColor = [0.0, 1.0, 0.0]; // Neon Green
        else if (val === 5) circleColor = [0.2, 0.5, 1.0]; // Lightning Blue
        else if (val === 6) circleColor = [0.4, 0.4, 1.0]; // Dark Lightning
        else if (val === 8) circleColor = [0.8, 0.0, 1.0]; // Purple
        else if (val === 9) circleColor = [0.8, 0.9, 1.0]; // Blue-White
        else if (val === 10 || val === 14) circleColor = [0.0, 1.0, 0.0]; // Green (Abyss)
        else if (val === 12) circleColor = [0.6, 0.0, 0.8]; // Dark Purple
        else if (val === 13) circleColor = [0.9, 0.9, 1.0]; // White
        magicFX.trigger(x, y, circleColor);

        // Fire Spells (2: Fire Bolt, 7: Fireball, 9: Comet Fall, 11: Fireball)
        if (val === 2 || val === 7 || val === 9 || val === 11) {
            spawnAboveModalTexture('flame_03.png', x, y, 1, {
                size: 300, spread: 0, decay: 0.05,
                tint: '#ff5500', blend: 'lighter', intensity: 1.8
            });
            spawnAboveModalTexture('muzzle_02.png', x, y, 5, {
                sizeRange: [40, 80], spread: 60, decay: 0.06,
                tint: '#ffaa00', blend: 'lighter'
            });
            triggerShake(10, 20);
        }
        // Ice (3: Ice Dagger)
        else if (val === 3) {
            spawnAboveModalTexture('slash_02.png', x, y, 2, {
                size: 200, spread: 20, decay: 0.08,
                tint: '#00ffff', blend: 'lighter', intensity: 1.5
            });
            spawnAboveModalTexture('spark_01.png', x, y, 12, {
                sizeRange: [10, 30], spread: 40, decay: 0.04,
                tint: '#ffffff', blend: 'lighter'
            });
            triggerShake(5, 10);
        }
        // Poison (4: Poison Dart)
        else if (val === 4) {
            spawnAboveModalTexture('circle_03.png', x, y, 1, {
                size: 250, spread: 0, decay: 0.04,
                tint: '#00ff00', blend: 'lighter', intensity: 1.2
            });
            spawnAboveModalTexture('twirl_01.png', x, y, 3, {
                sizeRange: [40, 80], spread: 30, decay: 0.03,
                tint: '#44ff44', blend: 'lighter'
            });
            triggerShake(5, 10);
        }
        // Lightning (5: Lightning, 6: Ball Lightning)
        else if (val === 5 || val === 6) {
            spawnAboveModalTexture('trace_01.png', x, y, 4, {
                size: 250, spread: 40, decay: 0.1,
                tint: '#ffffaa', blend: 'lighter', intensity: 2.0
            });
            spawnAboveModalTexture('spark_01.png', x, y, 15, {
                sizeRange: [5, 20], spread: 80, decay: 0.08,
                tint: '#ffffff', blend: 'lighter'
            });
            triggerShake(12, 15);
        }
        // Void/Eldritch (8: Abyssal Rift, 10: Eldritch Annihilation, 12+)
        else {
            spawnAboveModalTexture('twirl_01.png', x, y, 1, {
                size: 350, spread: 0, decay: 0.03,
                tint: '#aa00ff', blend: 'lighter', intensity: 1.6
            });
            spawnAboveModalTexture('circle_03.png', x, y, 1, {
                size: 200, spread: 0, decay: 0.05,
                tint: '#ff00ff', blend: 'lighter', intensity: 1.0
            });
            spawnAboveModalTexture('spark_01.png', x, y, 10, {
                sizeRange: [10, 40], spread: 60, decay: 0.04,
                tint: '#ff88ff', blend: 'lighter'
            });
            triggerShake(15, 25);
        }
        return;
    }

    // Standard Physical Attacks
    if (weapon) {
        // 3D Physical FX
        if (use3dModel && playerMesh) {
             spawn3DPhysicalFX(playerMesh.position, new THREE.Vector3(x, 0.5, y));
        }

        // Slash
        spawnAboveModalTexture('slash_02.png', x, y, 1, {
            size: 280, spread: 0, decay: 0.06,
            tint: '#ffffff', blend: 'lighter', intensity: 1.5
        });
        // Sparks
        spawnAboveModalTexture('spark_01.png', x, y, 6, {
            sizeRange: [6, 16], spread: 50, decay: 0.04,
            tint: '#ffcc88', blend: 'lighter'
        });
    } else {
        // Blunt Impact
        spawnAboveModalTexture('circle_03.png', x, y, 1, {
            size: 250, spread: 0, decay: 0.08,
            tint: '#ffffff', blend: 'lighter', intensity: 1.2
        });
        spawnAboveModalTexture('muzzle_02.png', x, y, 3, {
            sizeRange: [30, 60], spread: 20, decay: 0.08,
            tint: '#ffaa66', blend: 'lighter'
        });
    }
    triggerShake(6, 12);
}

function spawn3DMagicCircle(pos, val) {
    const tex = loadTexture('assets/images/textures/magic_02.png');
    const geo = new THREE.PlaneGeometry(3, 3);
    const mat = new THREE.MeshBasicMaterial({ 
        map: tex, 
        transparent: true, 
        opacity: 0, 
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
    });
    
    // Color based on spell type
    if (val === 2 || val === 7 || val === 11) mat.color.setHex(0xff5500); // Fire
    else if (val === 3) mat.color.setHex(0x00ffff); // Ice
    else if (val === 4) mat.color.setHex(0x00ff00); // Poison
    else if (val === 5 || val === 6) mat.color.setHex(0x5555ff); // Lightning
    else mat.color.setHex(0x00ff00); // Void/Abyss (Green)

    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2; // Flat on floor
    mesh.position.copy(pos);
    mesh.position.y += 0.05; // Just above floor
    scene.add(mesh);

    // Animate: Spin, Fade In, Fade Out
    new TWEEN.Tween(mesh.rotation)
        .to({ z: Math.PI }, 1000)
        .start();
        
    new TWEEN.Tween(mat)
        .to({ opacity: 0.8 }, 200)
        .yoyo(true)
        .repeat(1)
        .onComplete(() => scene.remove(mesh))
        .start();
}

function spawn3DProjectile(startPos, targetPos, val) {
    // Adjust target height for chest impact
    const impactPos = targetPos.clone();
    impactPos.y = 1.5; 

    let texName = 'flame_01.png';
    let color = 0xffaa00;
    
    if (val === 3) { texName = 'spark_06.png'; color = 0x00ffff; } // Ice
    else if (val === 4) { texName = 'smoke_05.png'; color = 0x00ff00; } // Poison
    else if (val === 5 || val === 6) { texName = 'trace_06.png'; color = 0xffff00; } // Lightning
    else if (val >= 8) { texName = 'twirl_02.png'; color = 0x00ff00; } // Void (Green)

    const tex = loadTexture(`assets/images/textures/${texName}`);
    const mat = new THREE.SpriteMaterial({ map: tex, color: color, transparent: true, blending: THREE.AdditiveBlending });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(startPos);
    sprite.position.y += 1.5; // Hand height
    sprite.scale.set(1.5, 1.5, 1);
    scene.add(sprite);

    new TWEEN.Tween(sprite.position)
        .to({ x: impactPos.x, y: impactPos.y, z: impactPos.z }, 400)
        .easing(TWEEN.Easing.Quadratic.In)
        .onComplete(() => {
            scene.remove(sprite);
            // Impact FX
            spawn3DImpact(impactPos, color);
            // Impact Sound
            if (audio && audio.initialized) audio.play('attack_blunt', { volume: 0.3, rate: 1.5 });
        })
        .start();
}

function spawn3DPhysicalFX(startPos, endScreenPos) {
    // Simple slash effect in front of player
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(playerMesh.quaternion);
    const pos = startPos.clone().add(forward.multiplyScalar(1.5));
    pos.y += 1.5;
    spawn3DImpact(pos, 0xffffff, 'slash_02.png');
}

function spawn3DImpact(pos, color, texName = 'star_06.png') {
    const tex = loadTexture(`assets/images/textures/${texName}`);
    const mat = new THREE.SpriteMaterial({ map: tex, color: color, transparent: true, blending: THREE.AdditiveBlending });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(pos);
    sprite.scale.set(0.1, 0.1, 1);
    scene.add(sprite);

    new TWEEN.Tween(sprite.scale)
        .to({ x: 3, y: 3 }, 200)
        .easing(TWEEN.Easing.Quadratic.Out)
        .start();
        
    new TWEEN.Tween(mat)
        .to({ opacity: 0 }, 300)
        .onComplete(() => scene.remove(sprite))
        .start();
}

function spawn3DDrainFX(pos) {
    const tex = loadTexture('assets/images/textures/circle_03.png');
    const mat = new THREE.SpriteMaterial({ map: tex, color: 0x880000, transparent: true, blending: THREE.AdditiveBlending });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(pos);
    sprite.position.y += 1.0;
    sprite.scale.set(3, 3, 1);
    scene.add(sprite);

    // Implosion effect (Scale down)
    new TWEEN.Tween(sprite.scale)
        .to({ x: 0.1, y: 0.1 }, 400)
        .easing(TWEEN.Easing.Quadratic.In)
        .onComplete(() => scene.remove(sprite))
        .start();
        
    if (audio && audio.initialized) audio.play('spell_void', { volume: 0.4, rate: 2.0 });
}

function pickCard(idx, event) {
    if ((game.chosenCount >= 3 && !game.isBossFight) || game.combatBusy) return;

    let card = game.combatCards[idx];
    let cardEl = event ? event.target.closest('.card') : document.querySelectorAll('.card')[idx];

    // Safety check if DOM element is missing
    if (!cardEl) return;

    const cardRect = cardEl.getBoundingClientRect();
    const centerX = cardRect.left + cardRect.width / 2;
    const centerY = cardRect.top + cardRect.height / 2;

    // --- BOSS MECHANIC: LOYALIST INTERCEPTION ---
    if (game.isBossFight && card.bossSlot === 'boss-guardian') {
        const loyalistIdx = game.combatCards.findIndex(c => c.bossRole === 'loyalist');
        if (loyalistIdx !== -1 && Math.random() < 0.35) {
            // Intercept!
            logMsg("The Loyalist throws themselves in front of the blow!");
            spawnFloatingText("INTERCEPTED!", window.innerWidth / 2, window.innerHeight / 2, '#ffffff');
            idx = loyalistIdx;
            card = game.combatCards[idx];
            cardEl = document.querySelectorAll('.card')[idx]; // Re-fetch DOM element
        }
    }

    // Animation for removal (for non-monster cards)
    cardEl.style.pointerEvents = 'none';
    if (card.type !== 'monster') {
        audio.play('card_flip', { volume: 0.6 });
        cardEl.style.transform = 'scale(0) rotate(15deg)';
        cardEl.style.opacity = '0';
        cardEl.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 1, 1)';
    } else {
        // Ensure monsters telegraph cleanly (don't hide immediately)
        cardEl.style.transition = 'transform 180ms cubic-bezier(0.2,0.8,0.2,1), opacity 300ms ease';
    }

    switch (card.type) {
        case 'weapon':
            if (addToBackpack(card)) {
                logMsg(`Looted ${card.name}.`);
            } else {
                spawnFloatingText("Backpack Full!", centerX, centerY, '#ff0000');
                // Revert animation
                if (!use3dModel) cardEl.style.pointerEvents = 'auto';
                cardEl.style.transform = 'none';
                cardEl.style.opacity = '1';
                return;
            }
            break;
        case 'monster':
            game.combatBusy = true;
            // Compute damage/state but defer applying until animation finishes
            let dmg = card.val;
            const cardRect = cardEl.getBoundingClientRect();
            const centerX = cardRect.left + cardRect.width / 2;
            const centerY = cardRect.top + cardRect.height / 2;

            // Music Box Check (ID 7)
            // Actually, music box is active use.
            // Tome Check (ID 8) - Passive +2 coins
            const hasTome = game.hotbar.some(i => i && i.type === 'item' && i.id === 8);

            let willBreak = false;
            let brokeName = null;

            // Calculate Boss Buffs (Weapon + Armor)
            // Base Guardian Value might be modified by Architect/Sorcerer
            let effectiveCardVal = card.val;
            let bossBuffDmg = 0;

            if (game.isBossFight && card.bossSlot === 'boss-guardian') {
                game.combatCards.forEach(c => {
                    if (c === card) return; // Skip self

                    // Vanguard/Bulwark: Add direct damage
                    if (c.bossRole === 'vanguard' || c.bossRole === 'bulwark') {
                        bossBuffDmg += c.val;
                    }
                    // Architect: Adds 1/2 value to Defense (Base Val) AND Attack (Buff Dmg)
                    if (c.bossRole === 'architect') {
                        const buff = Math.floor(c.val / 2);
                        effectiveCardVal += buff;
                        bossBuffDmg += buff;
                    }
                    // Sorcerer: -2 Defense, +2 Attack
                    if (c.bossRole === 'sorcerer') {
                        effectiveCardVal = Math.max(0, effectiveCardVal - 2);
                        bossBuffDmg += 2;
                    }
                });
            }

            // Calculate Player vs Monster Base Damage
            if (game.equipment.weapon && effectiveCardVal <= game.weaponDurability) {
                dmg = Math.max(0, effectiveCardVal - game.equipment.weapon.val);
                game.weaponDurability = card.val;
                // Persist durability on the item itself
                game.equipment.weapon.durability = game.weaponDurability;

                // Scoundrel rules usually care about the card's face value. Let's stick to card.val for durability check to be safe,
                // but use effectiveVal for damage calculation.
                logMsg(`Slit ${card.name}'s throat. Next enemy must be <=${card.val}.`);
            } else if (game.equipment.weapon) {
                dmg = Math.max(0, effectiveCardVal - game.equipment.weapon.val);
                brokeName = game.equipment.weapon.name;
                willBreak = true;
                
                // --- WEAPON BREAK SALVAGE LOGIC ---
                // "When a weapon's durability causes the weapon to be destroyed, 
                // half of the cards will go to the player's trophy area"
                if (game.slainStack && game.slainStack.length > 0) {
                    const salvageCount = Math.ceil(game.slainStack.length / 2);
                    // Shuffle or pick random? User said "can be random".
                    // Let's just shuffle the stack and keep the first half.
                    // Actually, game.slainStack usually CLEARS on break in Scoundrel. 
                    // But here we want to PRESERVE half.
                    
                    // Simple shuffle
                    for (let i = game.slainStack.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [game.slainStack[i], game.slainStack[j]] = [game.slainStack[j], game.slainStack[i]];
                    }
                    
                    // Keep first N (salvageCount), discard the rest
                    const savedTrophies = game.slainStack.slice(0, salvageCount);
                    game.slainStack = savedTrophies;
                    
                    logMsg(`Weapon shattered! Salvaged ${salvageCount} trophies.`);
                } else {
                    game.slainStack = [];
                }

                game.equipment.weapon = null; 
                game.weaponDurability = Infinity; 
                // game.slainStack = []; // REMOVED (Handled above)

                logMsg(`CRACK! The ${brokeName} has broken!`);
            } else {
                dmg = effectiveCardVal;
                // Vanguard (Knight) Passive: Martial Training
                const reduction = (game.classId === 'knight') ? 3 : 0;
                dmg = Math.max(0, dmg - reduction);
                logMsg(`Grappled ${card.name} barehanded. Took ${dmg} DMG.`);
            }

            // Apply Boss Buffs to final damage (Guardian hits back with full force)
            dmg += bossBuffDmg;

            // Boss Potion Mechanic (Heal on death)
            if (game.isBossFight && card.bossRole === 'mystic') {
                const guardian = game.combatCards.find(c => c.bossSlot === 'boss-guardian');
                if (guardian) {
                    guardian.val += 5;
                    logMsg("The Vial shatters, healing the Guardian +5!");
                    spawnFloatingText("GUARDIAN HEALED!", window.innerWidth / 2, window.innerHeight / 2 - 100, '#00ff00');
                }
            }

            // --- CINEMATIC COMBAT SEQUENCE ---

            // 1. Player Attack Phase (Visuals)
            triggerPlayerAttackAnim(centerX, centerY, game.equipment.weapon);

            // Trigger 3D Attack Animation
            if (use3dModel && actions.attack && actions.idle) {
                actions.idle.stop();
                if (actions.walk) actions.walk.stop();
                actions.attack.reset().play();

                const onAttackFinish = (e) => {
                    if (e.action === actions.attack) {
                        actions.attack.stop();
                        actions.idle.play();
                        mixer.removeEventListener('finished', onAttackFinish);
                    }
                };
                mixer.addEventListener('finished', onAttackFinish);
            }

            let attackSound = 'attack_blunt';
            if (game.equipment.weapon) {
                if (game.equipment.weapon.isSpell) {
                    const val = game.equipment.weapon.val;
                    if (val === 2 || val === 7 || val === 9 || val === 11) attackSound = 'spell_fire';
                    else if (val === 3) attackSound = 'spell_ice';
                    else if (val === 4) attackSound = 'spell_poison';
                    else if (val === 5 || val === 6) attackSound = 'spell_electric';
                    else attackSound = 'spell_void';
                } else {
                    attackSound = 'attack_slash';
                }
            }
            audio.play(attackSound, { volume: 0.8, rate: 0.9 + Math.random() * 0.2 });

            // Animate Card Impact (Recoil)
            const recoilAnim = cardEl.animate([
                { transform: 'scale(1)' },
                { transform: 'scale(0.9) rotate(' + (Math.random() * 6 - 3) + 'deg)' },
                { transform: 'scale(1.05)' },
                { transform: 'scale(1)' }
            ], { duration: 250, easing: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)' });

            recoilAnim.onfinish = () => {
                // 2. Enemy Retaliation Phase (only if player takes damage)
                if (dmg > 0) {
                    enemyAttackAnimation(card, cardEl, centerX, centerY, dmg, {}, finalizeCombat);
                } else {
                    // Clean kill - slight pause then death
                    setTimeout(finalizeCombat, 150);
                }
            };

            function finalizeCombat() {
                if (willBreak) {
                    spawnAboveModalTexture('spark_01.png', centerX, centerY, 30, { tint: '#888', blend: 'lighter', sizeRange: [6, 40], intensity: 2.0, filter: 'brightness(2) saturate(1.1)' });
                    spawnAboveModalTexture('slash_02.png', window.innerWidth / 2, window.innerHeight / 2, 18, { tint: '#8b0000', blend: 'lighter', sizeRange: [40, 120], intensity: 1.9, filter: 'brightness(1.8) contrast(1.2)' });
                    triggerShake(15, 30);
                } else if (game.equipment.weapon && !willBreak) {
                    // slay with weapon: small sparks
                    spawnAboveModalTexture('spark_01.png', centerX, centerY, 12, { tint: '#ccc', blend: 'lighter', sizeRange: [8, 36], intensity: 1.2 });

                    // Cursed Blade Effect: Heals on kill? Or just drains? 
                    // "Bloodthirst" implies healing, but user said "more like a bloodthirst weapon" (drain).
                    // Let's stick to the drain on entry for now.
                    
                    // Reanimator (Necromancer) Passive: Soul Siphon
                    if (game.classId === 'necromancer') {
                        if (card.val === game.equipment.weapon.val) {
                            game.hp = Math.min(game.maxHp, game.hp + 1);
                            logMsg("Soul Siphon: Exact kill restores 1 HP.");
                        }
                    }
                    
                    // Templar (Paladin) Passive: Righteous Momentum
                    if (game.classId === 'paladin') {
                        game.enemiesDefeated = (game.enemiesDefeated || 0) + 1;
                        if (game.enemiesDefeated % 5 === 0) {
                            game.ap = Math.min(game.maxAp, game.ap + 1);
                            logMsg("Righteous Momentum: +1 AP.");
                        }
                    }

                    game.slainStack.push(card);
                }

                game.soulCoins += card.val + (hasTome ? 2 : 0);
                if (dmg === 0) {
                    spawnFloatingText("CRITICAL HIT!", centerX, centerY - 60, '#ffcc00');
                }

                if (dmg > 0) {
                    spawnAboveModalTexture('slash_02.png', window.innerWidth / 2, window.innerHeight / 2, 18, { tint: '#8b0000', blend: 'lighter', sizeRange: [40, 120], intensity: 1.7, filter: 'brightness(1.6) contrast(1.15)' });
                    triggerShake(10, 20);
                }

                // Mirror Check (ID 6)
                if (game.hp - dmg <= 0) {
                    const mirrorIdx = game.hotbar.findIndex(i => i && i.type === 'item' && i.id === 6);
                    if (mirrorIdx !== -1) {
                        game.hotbar[mirrorIdx] = null;
                        dmg = 0; game.hp = 1;

                        // Mirror Shatter FX
                        spawnAboveModalTexture('spark_01.png', centerX, centerY, 40, { tint: '#ffffff', blend: 'lighter', sizeRange: [10, 40], spread: 60, decay: 0.03 });
                        spawnAboveModalTexture('slash_02.png', centerX, centerY, 8, { tint: '#aaffff', blend: 'lighter', sizeRange: [40, 100], spread: 40, decay: 0.05 });
                        triggerShake(20, 40);

                        spawnFloatingText("MIRROR SHATTERED!", centerX, centerY, '#ffffff');
                        logMsg("Silver Mirror shattered to save your life!");
                    }
                }

                if (dmg > 0) takeDamage(dmg);
                
                // Arcanist (Occultist) Passive: Echo Cast
                if (game.classId === 'occultist' && game.equipment.weapon && game.equipment.weapon.isSpell && Math.random() < 0.2) {
                    const otherMonsters = game.combatCards.filter((c, i) => c.type === 'monster' && i !== idx);
                    if (otherMonsters.length > 0) {
                        const target = otherMonsters[Math.floor(Math.random() * otherMonsters.length)];
                        const echoDmg = game.equipment.weapon.val;
                        target.val = Math.max(0, target.val - echoDmg);
                        spawnFloatingText("ECHO CAST!", window.innerWidth/2, window.innerHeight/2 - 50, '#aa00ff');
                        logMsg(`Echo Cast hit ${target.name} for ${echoDmg}.`);
                        spawnAboveModalTexture('twirl_01.png', window.innerWidth/2, window.innerHeight/2, 10, { tint:'#aa00ff', blend:'lighter' });
                    }
                }
                
                updateUI();

                // Animate card death (flip) and then remove from combat array
                animateCardDeath(cardEl, () => {
                    game.combatBusy = false;
                    game.combatCards.splice(idx, 1);
                    if (!game.isBossFight) game.chosenCount++;

                    if (game.hp <= 0) { gameOver(); return; }

                    // Boss Fight Logic: Only finish if Guardian is dead
                    if (game.isBossFight) {
                        // Soul Broker Logic
                        const broker = game.combatCards.find(c => c.isBroker);
                        if (game.combatCards.some(c => c.isBroker) && !broker) {
                            // Broker died just now
                        }

                        // Shake the Guardian if a minion died
                        const guardianCard = document.querySelector('.card.boss-guardian');
                        if (guardianCard) {
                            guardianCard.animate([
                                { transform: 'translate(0,0)' },
                                { transform: 'translate(-5px, 0)' },
                                { transform: 'translate(5px, 0)' },
                                { transform: 'translate(0,0)' }
                            ], { duration: 200 });
                        }

                        const guardianAlive = game.combatCards.some(c => c.bossSlot === 'boss-guardian');
                        if (!guardianAlive) {
                            finishRoom();
                        } else {
                            showCombat();
                        }
                    } else {
                        if (game.chosenCount === 3) finishRoom();
                        else showCombat();
                    }
                    updateUI();
                });
            }

            // Return so we don't run the default removal logic below (we handle that in the callback)
            return;
        case 'potion':
            // Spawn both canvas FX (for background) and DOM UI FX (so they appear above the modal)
            spawnAboveModalTexture('circle_03.png', window.innerWidth / 2, window.innerHeight / 2, 20, { tint: '#00cc00', blend: 'lighter', sizeRange: [24, 64], intensity: 1.35 });

            const potionItem = { type: 'potion', val: card.val, name: card.name, suit: card.suit };

            if (addToHotbar(potionItem)) {
                logMsg(`Stored ${card.name} in hotbar.`);
            } else if (addToBackpack(potionItem)) {
                logMsg(`Stored ${card.name} in backpack.`);
            } else {
                const heal = Math.min(card.val, game.maxHp - game.hp);
                game.hp += heal;
                logMsg(`Inventory full! Drank ${card.name} (+${heal} HP).`);
            }
            updateUI(); // Immediate UI refresh
            break;
        case 'gift':
            const gift = card.actualGift;

            // MIMIC CHECK
            if (gift.isMimic) {
                spawnFloatingText("IT'S A MIMIC!", centerX, centerY, '#ff0000');
                logMsg("The chest sprouts teeth! It's a Mimic!");
                takeDamage(5);
                spawnAboveModalTexture('slash_02.png', centerX, centerY, 5, { tint: '#ff0000', blend: 'lighter' });
                triggerShake(15, 20);
                // Mimic dies after biting, dropping nothing (or maybe standard coins?)
                game.activeRoom.state = 'cleared';
                game.combatCards = [];
                updateUI();
                finishRoom();
                return;
            }

            spawnAboveModalTexture('twirl_01.png', window.innerWidth / 2, window.innerHeight / 2, 26, { tint: '#d4af37', blend: 'lighter', sizeRange: [40, 160], intensity: 1.45 });

            if (gift.type === 'weapon') {
                if (addToBackpack(gift)) {
                    logMsg(`Merchant's Blessing: Looted ${gift.name}.`);
                } else {
                    spawnFloatingText("Backpack Full!", centerX, centerY, '#ff0000');
                    if (!use3dModel) cardEl.style.pointerEvents = 'auto'; cardEl.style.transform = 'none'; cardEl.style.opacity = '1';
                    return;
                }
                game.merchantUsed = true;
            } else if (gift.type === 'potion') {
                if (addToHotbar(gift)) {
                    logMsg(`Merchant's Blessing: Stored ${gift.name}.`);
                } else {
                    const heal = Math.min(gift.val, game.maxHp - game.hp);
                    game.hp += heal;
                    logMsg(`Hotbar full! Drank ${gift.name}.`);
                }
            } else if (gift.type === 'repair' && game.equipment.weapon) {
                let msg = "";
                game.equipment.weapon.val = Math.min(14, game.equipment.weapon.val + gift.val);
                game.weaponDurability = Infinity;
                game.equipment.weapon.durability = Infinity; // Reset item durability
                game.slainStack = [];
                msg += `Weapon honed (+${gift.val}). `;

                if (game.maxAp > 0) {
                    const healed = game.maxAp - game.ap;
                    game.ap = game.maxAp;
                    msg += healed > 0 ? `Armor repaired (+${healed}).` : `Armor polished.`;
                }
                game.merchantUsed = true;
                logMsg(`Merchant's Repair: ${msg}`);
            } else if (gift.type === 'armor') {
                if (!addToBackpack(gift)) {
                    spawnFloatingText("Backpack Full!", window.innerWidth / 2, window.innerHeight / 2, '#ff0000');
                    if (!use3dModel) cardEl.style.pointerEvents = 'auto'; cardEl.style.transform = 'none'; cardEl.style.opacity = '1';
                    return;
                }
                logMsg(`Merchant's Blessing: Looted ${gift.name}.`);
            }

            // Handle Cursed Items from Merchant
            if (gift.isCursed && gift.id === 'cursed_ring') {
                game.maxHp += 10; game.hp += 10;
                logMsg("The Ring of Burden binds to you. (+10 Max HP)");
            }

            game.activeRoom.state = 'cleared';
            game.combatCards = []; // Clear other gift options
            updateUI();
            finishRoom(); // Closes modal with victory message
            return;
        case 'bonfire':
            spawnAboveModalTexture('flame_03.png', window.innerWidth / 2, window.innerHeight / 2, 30, { tint: '#ff6600', blend: 'lighter', sizeRange: [48, 160], intensity: 1.45 });
            // Herbs Check (ID 5)
            const hasHerbs = game.hotbar.some(i => i && i.type === 'item' && i.id === 5);
            const bonfireHeal = Math.min(card.val + (hasHerbs ? 5 : 0), game.maxHp - game.hp);
            game.hp += bonfireHeal;
            logMsg(`Rested at bonfire. Vitality +${bonfireHeal}.`);

            game.bonfireUsed = true;
            game.activeRoom.restRemaining--;
            updateUI();
            audio.stopLoop(`bonfire_${game.activeRoom.id}`); // Stop sound if cleared

            // Special exit for bonfire: don't call finishRoom unless out of rests
            document.getElementById('exitCombatBtn').style.display = 'block';
            document.getElementById('modalAvoidBtn').style.display = 'none';
            document.getElementById('combatMessage').innerText = game.activeRoom.restRemaining > 0
                ? `Rest complete. (${game.activeRoom.restRemaining} stays left)`
                : "Bonfire extinguished. Path is clear.";

            if (game.activeRoom.restRemaining <= 0) {
                game.activeRoom.state = 'cleared';
            }
            return; // Skip standard pickCard completion
    }

    game.combatCards.splice(idx, 1);
    game.chosenCount++;
    
    // Update Retreat Button immediately
    const avoidBtn = document.getElementById('modalAvoidBtn');
    if (avoidBtn) avoidBtn.disabled = true;

    if (game.hp <= 0) {
        gameOver();
        return;
    }

    if (game.chosenCount === 3) finishRoom();
    else showCombat();
    updateUI();
}

function finishRoom() {
    // Boss Victory Handling
    if (game.isBossFight) {
        document.getElementById('enemyArea').classList.remove('boss-grid');
        game.soulCoins += 20;

        // Massive Explosion
        spawnAboveModalTexture('scorch_03.png', window.innerWidth / 2, window.innerHeight / 2 - 100, 40, { tint: '#ff4400', blend: 'lighter', sizeRange: [60, 200], spread: 120, decay: 0.02 });
        spawnAboveModalTexture('spark_01.png', window.innerWidth / 2, window.innerHeight / 2 - 100, 60, { tint: '#ffffff', blend: 'lighter', sizeRange: [10, 40], spread: 150, decay: 0.01 });

        const isBroker = game.isBrokerFight; // Was this the Soul Broker?

        // Visuals
        document.getElementById('combatMessage').innerText = isBroker ? "SOUL BROKER DEFEATED!" : `Guardian Defeated! Descending to Level ${game.floor + 1}...`;
        document.getElementById('descendBtn').style.display = 'none';
        document.getElementById('exitCombatBtn').style.display = 'none';
        document.getElementById('modalAvoidBtn').style.display = 'none';

        if (isBroker) {
            // Check Phase (Broker Defeated Logic)
            if (game.brokerPhase < 4) {
                game.brokerPhase++;
                
                // If we killed the Broker (isBroker is true), the game SHOULD end.
                // The phase logic is for when he SURVIVES (retreats).
                // Wait, if the player kills the Broker in Phase 1, do they win immediately?
                // Or does he "fake die" and come back?
                // Let's assume if you kill him, you win. The phases are for if you clear his MINIONS.
                
                // BUT, if the player clears the room (3 cards) and the Broker is the 4th card (alive),
                // THEN we trigger the next phase.
                
                // If we are inside this block, it means the Broker was DEFEATED (killed).
                // So we should trigger the ending.
                
                setTimeout(() => { startEndingSequence(); }, 4000);
                updateBossBar(0, 60); // Deplete bar
                
                // Cleanup 3D entities immediately so they don't linger
                game.combatCards = [];
                while (combatGroup.children.length > 0) combatGroup.remove(combatGroup.children[0]);
                combatEntities = [];
                game.isBossFight = false; // End fight
                return;
            } else {
                setTimeout(() => { startEndingSequence(); }, 4000);
                game.isBossFight = false;
                return;
            }
        }

        // Cleanup 3D entities for standard bosses (Guardian)
        game.combatCards = [];
        while (combatGroup.children.length > 0) combatGroup.remove(combatGroup.children[0]);
        combatEntities = [];
        
        game.isBossFight = false; // Reset flag for standard boss

        // If we just beat the Floor 9 Guardian, trigger Soul Broker
        if (game.floor === 9 && !isBroker) {
            document.getElementById('combatMessage').innerText = "The Guardian falls... but something darker emerges.";
            setTimeout(startSoulBrokerEncounter, 3000);
            return;
        }

        updateUI(); // Update coins etc

        setTimeout(startIntermission, 2000);
        return;
    }

    game.activeRoom.state = 'cleared';
    // Only carry over if it's a regular room (not special or bonfire)
    // Regular rooms start with 4 cards, so if 3 are picked, 1 remains.
    if (!game.activeRoom.isSpecial && !game.activeRoom.isBonfire && !game.isBossFight) {
        game.carryCard = game.combatCards[0] || null;
    }
    game.combatCards = []; // Clear current area

    // Clear 3D Combat Entities so they don't linger visually
    while (combatGroup.children.length > 0) {
        combatGroup.remove(combatGroup.children[0]);
    }
    combatEntities = [];

    game.activeRoom.cards = [];
    game.lastAvoided = false;

    const enemyArea = document.getElementById('enemyArea');
    enemyArea.innerHTML = game.carryCard
        ? `<div class="combat-message" style="width:100%; text-align:center;">LOOT SECURED: ${game.carryCard.name} (Carried to next room)</div>`
        : `<div class="combat-message" style="width:100%; text-align:center;">ROOM PURGED</div>`;

    document.getElementById('exitCombatBtn').style.display = 'block';
    document.getElementById('modalAvoidBtn').style.display = 'none';
    document.getElementById('combatMessage').innerText = "Victory! Path is clear.";

    // Proactive Purge Check
    // Rule: All rooms must be cleared OR be a Waypoint/Special/Bonfire
    const allCleared = game.rooms.every(r =>
        r.isWaypoint ||
        r.isSpecial ||
        r.isBonfire ||
        r.state === 'cleared'
    );

    if (allCleared) {
        if (game.activeRoom.isFinal) {
            // Check for Final Boss Trigger (Floor 9)
            if (game.floor === 9 && !game.isBrokerFight) {
                updateBossBar(0, 60, false, true); // Ensure bar is hidden
                logMsg("The air grows heavy. The Soul Broker approaches...");
                startSoulBrokerEncounter();
                return;
            }

            // Update message and show descend button immediately
            document.getElementById('combatMessage').innerText = "Floor Purged! The Guardian awaits.";
            document.getElementById('descendBtn').style.display = 'block';
            document.getElementById('descendBtn').innerText = "Confront Guardian";
            document.getElementById('descendBtn').onclick = (e) => { if(e) e.stopPropagation(); startBossFight(); };
            document.getElementById('exitCombatBtn').style.display = 'none';
            logMsg("Floor Purged! The Guardian awaits.");
            updateBossBar(0, 60, false, true); // Hide bar if visible
        } else {
            updateBossBar(0, 60, false, true); // Hide bar
            logMsg("Floor Purged! Return to the Guardian's lair to descend.");
        }
    } else if (game.isBrokerFight) {
        // If we cleared the room (picked 3 cards) but Broker is still alive (he was the 4th card),
        // OR if we killed him but there are phases left?
        // Actually, in Scoundrel, if the boss is the 4th card, he stays for the next "room".
        // But here we want a gauntlet.
        
        // Logic: If the room is "finished" (3 cards picked), we start the next round immediately.
        // The Broker carries over his HP.
        
        if (game.brokerPhase < 4) {
            const broker = game.combatCards.find(c => c.isBroker) || (game.carryCard && game.carryCard.isBroker ? game.carryCard : null);
            if (broker) {
                game.brokerHP = broker.val + 10; // Heal 10
                logMsg(`The Soul Broker retreats and rallies his guard! (+10 HP)`);
                game.combatBusy = true; // Block clicks during rally
                
                // Animate Bar Filling Up
                updateBossBar(broker.val, 60); // Current
                setTimeout(() => {
                    updateBossBar(game.brokerHP, 60); // Fill up
                    // Fade out after 2.5s (allow time to see fill)
                    setTimeout(() => { updateBossBar(game.brokerHP, 60, false, true); }, 2500);
                    game.combatBusy = false; // Re-enable combat
                }, 500); 
            }
            
            game.brokerPhase++;
            setTimeout(setupBrokerRound, 2000);
            return;
        }
    }
    updateRoomVisuals();
    updateUI();
}

function avoidRoom() {
    if (game.lastAvoided || game.chosenCount > 0) return;

    // Cursed Ring Check
    const hasBurden = game.hotbar.some(i => i && i.id === 'cursed_ring');
    if (hasBurden) {
        logMsg("The Ring of Burden prevents your escape!");
        spawnFloatingText("CANNOT FLEE!", window.innerWidth / 2, window.innerHeight / 2, '#adff2f');
        return;
    }

    const room = game.activeRoom;
    game.deck.push(...room.cards);
    room.cards = [];
    room.state = 'avoided';
    
    // Scoundrel (Rogue) Passive: Slippery
    if (game.classId !== 'rogue') game.lastAvoided = true;

    closeCombat();
    logMsg("Escaped to the shadows. Room marked as avoided.");
}

function closeCombat() {
    document.getElementById('combatModal').style.display = 'none';
    document.getElementById('combatContainer').style.display = 'flex';
    document.getElementById('bonfireUI').style.display = 'none';
    const trapUI = document.getElementById('trapUI');
    if (trapUI) trapUI.style.display = 'none';
    const lockpickUI = document.getElementById('lockpickUI');
    if (lockpickUI) lockpickUI.style.display = 'none';
    // Hide merchant portrait when modal is closed
    audio.setMusicMuffled(false); // Unmuffle music
    const mp = document.getElementById('merchantPortrait');
    if (mp) mp.style.display = 'none';
    updateBossBar(0, 60, false, true); // Hide boss bar
    document.getElementById('combatModal').style.pointerEvents = 'auto'; // Reset

    if (use3dModel) {
        exitCombatView();
    }
    updateUI(); // Ensure HUD reappears
}
window.closeCombat = closeCombat; // Expose for onClick events

function showBonfireUI() {
    const overlay = document.getElementById('combatModal');
    overlay.style.display = 'flex';
    document.getElementById('combatContainer').style.display = 'none';
    document.getElementById('bonfireUI').style.display = 'flex';
    const trapUI = document.getElementById('trapUI');
    if (trapUI) trapUI.style.display = 'none';
    // Ensure merchant portrait is hidden when showing bonfire UI
    const mp = document.getElementById('merchantPortrait');
    if (mp) mp.style.display = 'none';

    // Ensure the native 'Leave' button is visible
    const leaveBtn = document.getElementById('bonfireNotNowBtn');
    if (leaveBtn) leaveBtn.style.display = 'inline-block';
    updateBonfireUI();
}

window.handleBonfire = function (cost) {
    const room = game.activeRoom;
    if (room.restRemaining < cost) return;

    room.restRemaining -= cost;
    // Herbs Check (ID 5)
    const hasHerbs = game.hotbar.some(i => i && i.type === 'item' && i.id === 5);
    const heal = Math.min((5 * cost) + (hasHerbs ? 5 : 0), game.maxHp - game.hp);
    game.hp += heal;
    
    // Ensure we don't exceed max? (Assuming logic allows overheal or not? usually clamped)
    // For now, update UI immediately
    updateBonfireUI();

    game.bonfireUsed = true;
    spawnAboveModalTexture('flame_03.png', window.innerWidth / 2, window.innerHeight / 2, 30, { tint: '#ff6600', blend: 'lighter', sizeRange: [48, 160], intensity: 1.45 });
    logMsg(`Bonfire Rest: +${heal} Vitality.`);

    if (room.restRemaining <= 0) {
        room.state = 'cleared';
        logMsg("The fire fades.");
        audio.stopLoop(`bonfire_${room.id}`);
        updateUI(); // Update HP display before closing
        closeCombat();
    } else {
        updateBonfireUI();
        updateUI();
    }
};

function updateBonfireUI() {
    const room = game.activeRoom;
    document.getElementById('bonfireStatus').innerText = `${room.restRemaining} kindle remaining.`;

    // Update HP Display
    const hpCur = document.getElementById('bonfireHpDisplay');
    const hpMax = document.getElementById('bonfireMaxHpDisplay');
    if (hpCur) hpCur.innerText = game.hp;
    if (hpMax) hpMax.innerText = game.maxHp;

    // Set Avatar Image
    const bgUrl = `assets/images/rest_${game.sex}_large.png`;
    document.getElementById('bonfireImage').style.backgroundImage = `url('${bgUrl}')`;

    // Dim/Disable Buttons
    ['btnRest1', 'btnRest2', 'btnRest3'].forEach((id, idx) => {
        const cost = idx + 1;
        const btn = document.getElementById(id);
        if (room.restRemaining < cost) {
            btn.disabled = true;
            btn.style.opacity = '0.3';
            btn.style.cursor = 'not-allowed';
        } else {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
        }
    });
}

function showTrapUI() {
    const overlay = document.getElementById('combatModal');
    overlay.style.display = 'flex';
    document.getElementById('combatContainer').style.display = 'none';
    document.getElementById('bonfireUI').style.display = 'none';

    let trapUI = document.getElementById('trapUI');
    if (!trapUI) {
        trapUI = document.createElement('div');
        trapUI.id = 'trapUI';
        document.body.appendChild(trapUI);
    }
    trapUI.style.display = 'flex';

    // Check resources
    const hasBomb = game.hotbar.some(i => i && i.type === 'item' && i.id === 0);
    const hasKey = game.hotbar.some(i => i && i.type === 'item' && i.id === 2);
    const canPay = game.soulCoins >= 30;

    trapUI.innerHTML = `
        <h2 style="font-family:'Cinzel'; font-size:3rem; color:#ff4400; text-shadow:0 0 20px #ff0000; margin-bottom:20px;">IT'S A TRAP!</h2>
        <div style="font-style:italic; margin-bottom:40px; color:#aaa; text-align:center; max-width:400px;">
            You've triggered a hidden mechanism. The room is locked down. <br>How will you escape?
        </div>
        <div style="display:flex; flex-direction:column; gap:15px; width:320px;">
            <button class="v2-btn trap-option-btn" onclick="handleTrap('damage')"><span>Take Damage</span> <span style="color:#d00">-5 HP</span></button>
            <button class="v2-btn trap-option-btn" onclick="handleTrap('coin')" ${canPay ? '' : 'disabled'}><span>Bribe Mechanism</span> <span style="color:#d4af37">-30 Coins</span></button>
            <button class="v2-btn trap-option-btn" onclick="handleTrap('bomb')" ${hasBomb ? '' : 'disabled'}><span>Blast It (Bomb)</span> <span style="color:#aaa">Item</span></button>
            <button class="v2-btn trap-option-btn" onclick="handleTrap('key')" ${hasKey ? '' : 'disabled'}><span>Unlock (Key)</span> <span style="color:#aaa">Item</span></button>
            <button class="v2-btn" onclick="closeCombat()" style="background:#444; margin-top:20px;">Not Now (Leave)</button>
        </div>
    `;
}

window.handleTrap = function (action) {
    // Tinkerer (Artificer) Passive: Conservation
    const saveItem = (game.classId === 'artificer' && Math.random() < 0.15);

    if (action === 'damage') {
        takeDamage(5);
        logMsg("You brute-forced the trap. Took 5 damage.");
    } else if (action === 'coin') {
        game.soulCoins -= 30;
        logMsg("You paid the toll. -30 Soul Coins.");
    } else if (action === 'bomb') {
        const idx = game.hotbar.findIndex(i => i && i.type === 'item' && i.id === 0);
        if (idx !== -1) {
            if (!saveItem) game.hotbar[idx] = null;
            else logMsg("Conservation: Bomb saved!");
        }
        logMsg("You blasted the trap mechanism!");
    } else if (action === 'key') {
        const idx = game.hotbar.findIndex(i => i && i.type === 'item' && i.id === 2);
        if (idx !== -1) {
            if (!saveItem) game.hotbar[idx] = null;
            else logMsg("Conservation: Key saved!");
        }
        logMsg("You unlocked the mechanism.");
    }
    game.activeRoom.state = 'cleared';
    updateUI();
    closeCombat();
};

function gameOver() {
    logMsg("DEATH HAS CLAIMED YOU.");

    let monsterSum = 0;
    // Sum monsters in current deck
    game.deck.forEach(c => { if (c.type === 'monster') monsterSum += c.val; });
    // Sum monsters in all rooms (active or unvisited)
    game.rooms.forEach(r => {
        if (r.cards) r.cards.forEach(c => { if (c.type === 'monster') monsterSum += c.val; });
    });
    // Rules say subtract remaining monsters from life
    const score = game.hp - monsterSum;

    // Delete save on death if Hardcore
    if (game.mode === 'hardcore') deleteSave();

    alert(`Game Over! Your vitality reached 0.\n\nFinal Score: ${score}\n(Life: ${game.hp}, Monsters remaining: ${monsterSum})`);
    location.reload();
}

window.useItem = function (idx) {
    // Only allow using items from Hotbar
    const item = game.hotbar[idx];
    if (!item) return;

    if (item.type === 'potion') {
        const heal = Math.min(item.val, game.maxHp - game.hp);
        game.hp += heal;
        spawnFloatingText(`+${heal} HP`, window.innerWidth / 2, window.innerHeight / 2, '#00ff00');
        logMsg(`Used ${item.name}.`);
        game.hotbar[idx] = null;
        updateUI();
        return;
    }

    if (!item || item.type !== 'active') return;

    // Tinkerer (Artificer) Passive: Conservation
    const saveItem = (game.classId === 'artificer' && Math.random() < 0.15);

    if (item.id === 0) { // Bomb
        if (game.combatCards.length > 0) {
            const enemies = game.combatCards.filter(c => c.type === 'monster');
            if (enemies.length > 0) {
                const target = enemies[Math.floor(Math.random() * enemies.length)];
                const dmg = game.equipment.weapon ? Math.max(2, game.equipment.weapon.val - 2) : 2;
                target.val = Math.max(0, target.val - dmg);
                spawnFloatingText("BOMB!", window.innerWidth / 2, window.innerHeight / 2, '#ff0000');
                logMsg(`Bomb hit ${target.name} for ${dmg} dmg.`);
                if (!saveItem) game.hotbar[idx] = null;
                else logMsg("Conservation: Bomb saved!");
                updateUI();
                showCombat(); // Refresh cards
            }
        }
    } else if (item.id === 2) { // Skeleton Key
        if (game.activeRoom && game.activeRoom.state !== 'cleared') {
            game.lastAvoided = false; // Bypass restriction
            avoidRoom();
            if (!saveItem) game.hotbar[idx] = null;
            else logMsg("Conservation: Key saved!");
            updateUI();
        }
    } else if (item.id === 4) { // Hourglass
        // Reshuffle room logic would go here, complex to implement cleanly without deck manipulation
        // For now, let's make it heal 5 HP as a placeholder or skip
        logMsg("Time shifts... (Effect pending)");
    } else if (item.id === 7) { // Music Box
        game.combatCards.forEach(c => {
            if (c.type === 'monster') c.val = Math.max(0, c.val - 2);
        });
        if (!saveItem) game.hotbar[idx] = null;
        else logMsg("Conservation: Music Box saved!");
        updateUI();
        showCombat();
    }
};

function ensureMerchantPortrait() {
    // Remove duplicates if any exist (fixes "Double Merchant" bug)
    const all = document.querySelectorAll('#merchantPortrait');
    if (all.length > 1) {
        for (let i = 1; i < all.length; i++) all[i].remove();
    }

    let mp = all[0];
    if (!mp) {
        mp = document.createElement('div');
        mp.id = 'merchantPortrait';
        document.body.appendChild(mp);
    }
    return mp;
}

function updateMerchantPortraitPosition() {
    const mp = document.getElementById('merchantPortrait');
    if (!mp || mp.style.display === 'none') return;

    const combatArea = document.querySelector('.player-combat-area');
    if (combatArea) {
        const rect = combatArea.getBoundingClientRect();

        // Calculate distance from bottom of screen to top of combat area
        // We use exactly the top to sit him flush on the border
        const bottomOffset = (window.innerHeight - rect.top);

        mp.style.bottom = `${bottomOffset}px`;
        mp.style.top = 'auto';

        // Calculate available space above the UI (rect.top) minus top margin (40px)
        const availableHeight = rect.top - 40;

        mp.style.height = `${Math.min(availableHeight, 600)}px`; // Max 600px or available space

        // Position Left
        const sidebar = document.querySelector('.sidebar');
        const leftOffset = (sidebar && sidebar.getBoundingClientRect) ? (Math.round(sidebar.getBoundingClientRect().width) + 32) : 32;
        mp.style.left = `${leftOffset}px`;
    }
}

function applyTextureToMesh(mesh, type, value, suit) {
    const asset = getAssetData(type, value, suit);
    const tex = getClonedTexture(`assets/images/${asset.file}`);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;

    const isStrip = !asset.file.includes('rest');
    tex.repeat.set(isStrip ? 1 / (asset.sheetCount || 9) : 1, 1);
    tex.offset.set(asset.uv.u, 0);

    mesh.material.map = tex;
    mesh.material.needsUpdate = true;
}

document.getElementById('newGameBtn').onclick = startDive;
document.getElementById('modalAvoidBtn').onclick = avoidRoom;
document.getElementById('exitCombatBtn').onclick = closeCombat;
document.getElementById('descendBtn').onclick = startIntermission;
document.getElementById('bonfireNotNowBtn').onclick = closeCombat;

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.log(`Error attempting to enable fullscreen: ${err.message}`);
        });
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
    }
}

window.toggleControlBox = function (show) {
    const box = document.querySelector('.control-box');
    const restoreBtn = document.getElementById('restoreControlBtn');

    if (show) {
        if (box) box.style.display = 'flex';
        if (restoreBtn) restoreBtn.style.display = 'none';
    } else {
        if (box) box.style.display = 'none';
        if (restoreBtn) restoreBtn.style.display = 'flex';
    }
};

function updateBossBar(val, max, show = false, fadeOut = false) {
    const container = document.getElementById('bossHpContainer');
    const fill = document.getElementById('bossHpFill');
    if (!container || !fill) return;

    if (show) {
        container.style.display = 'block';
        container.style.opacity = '1';
        container.style.transition = 'opacity 0.5s';
    } else if (fadeOut) {
        container.style.opacity = '0';
        setTimeout(() => { if(container.style.opacity === '0') container.style.display = 'none'; }, 500);
    }
    
    const pct = Math.max(0, Math.min(100, (val / max) * 100));
    fill.style.width = `${pct}%`;
}

// --- LAYOUT SETUP ---
function setupLayout() {
    console.log("Initializing Custom Layout...");
    // 1. Create Floating Control Box
    const controlBox = document.createElement('div');
    controlBox.className = 'control-box';
    controlBox.style.display = 'none'; // HIDDEN by default per V3 design
    document.body.appendChild(controlBox);

    // Setup Gameplay Options Button
    const gpOpt = document.getElementById('gameplayOptionsBtn');
    if (gpOpt) {
        gpOpt.onclick = showOptionsModal;
    }

    // Add Fullscreen Button (Top Right Corner)
    const fsBtn = document.createElement('button');
    fsBtn.className = 'v2-btn';
    fsBtn.innerText = "⛶";
    fsBtn.title = "Toggle Fullscreen";
    fsBtn.onclick = toggleFullscreen;
    fsBtn.style.cssText = "position: absolute; top: 5px; right: 5px; width: 32px; height: 32px; padding: 0; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; box-shadow: none; z-index: 10;";
    controlBox.appendChild(fsBtn);

    // Minimize Button (Left of Fullscreen)
    const minBtn = document.createElement('button');
    minBtn.className = 'v2-btn';
    minBtn.innerText = "▼";
    minBtn.title = "Minimize Controls";
    minBtn.onclick = () => toggleControlBox(false);
    minBtn.style.cssText = "position: absolute; top: 5px; right: 42px; width: 32px; height: 32px; padding: 0; display: flex; align-items: center; justify-content: center; font-size: 1.0rem; box-shadow: none; z-index: 10;";
    controlBox.appendChild(minBtn);

    // Options Button (Top Left)
    const optBtn = document.createElement('button');
    optBtn.className = 'v2-btn';
    optBtn.innerText = "⚙";
    optBtn.title = "Options";
    optBtn.onclick = showOptionsModal;
    optBtn.style.cssText = "position: absolute; top: 5px; left: 5px; width: 32px; height: 32px; padding: 0; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; box-shadow: none; z-index: 10;";
    controlBox.appendChild(optBtn);

    // Help Button (Top Left, next to Options)
    const helpBtn = document.createElement('button');
    helpBtn.className = 'v2-btn';
    helpBtn.innerText = "?";
    helpBtn.title = "How to Play";
    helpBtn.onclick = showHelpModal;
    helpBtn.style.cssText = "position: absolute; top: 5px; left: 42px; width: 32px; height: 32px; padding: 0; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; box-shadow: none; z-index: 10;";
    controlBox.appendChild(helpBtn);

    // Version Label
    const ver = document.createElement('div');
    ver.innerText = "v1.0";
    ver.style.cssText = "position:absolute; bottom:2px; right:5px; font-size:10px; color:#444; font-family:monospace;";
    controlBox.appendChild(ver);

    // Move Title/Label
    const title = document.querySelector('.title-area');
    if (title) controlBox.appendChild(title);

    // Add Logo (Hidden by default, shown in Attract Mode)
    const logo = document.createElement('img');
    logo.id = 'gameLogo';
    logo.src = 'assets/images/logo.png';
    document.body.appendChild(logo);


    // Move Log
    const logContainer = document.querySelector('.log-container');
    if (logContainer) {
        controlBox.appendChild(logContainer);
        logContainer.style.maxHeight = '150px'; // Limit height in floating box
    }

    // Move Buttons

    // Add Continue Button if save exists
    if (hasSave()) {
        const contBtn = document.createElement('button');
        contBtn.id = 'continueGameBtn';
        contBtn.className = 'v2-btn';
        contBtn.innerText = "Continue";
        contBtn.onclick = loadGame;
        contBtn.style.width = '100%';
        controlBox.appendChild(contBtn);
    }

    // Add New Dive Button
    const newBtn = document.createElement('button');
    newBtn.className = 'v2-btn';
    newBtn.innerText = "New Dive";
    newBtn.onclick = startDive;
    newBtn.style.width = '100%';
    newBtn.style.marginTop = '5px';
    controlBox.appendChild(newBtn);

    // Reposition Control Box to Bottom Left (above Dock)
    controlBox.style.top = 'auto';
    controlBox.style.bottom = '234px'; // 120px dock + 10px margin + 104px

    // 2. Transform Player Combat Area into Always-Visible Dock
    const combatArea = document.querySelector('.player-combat-area');
    if (combatArea) {
        document.body.appendChild(combatArea); // Move out of modal to body
        combatArea.classList.add('dock-mode');
    }

    // Bind Weapon Icon to Open Inventory
    const weaponIcon = document.getElementById('weaponArtModal');
    if (weaponIcon) {
        weaponIcon.onclick = window.toggleInventory;
        weaponIcon.style.cursor = 'pointer';
    }

    // 3. Hoist Bonfire UI to Body (to ensure z-index works and it's not trapped)
    const bonfireUI = document.getElementById('bonfireUI');
    if (bonfireUI) {
        document.body.appendChild(bonfireUI);
    }

    // 3.5 Create Boss HP Bar
    let bossBar = document.getElementById('bossHpContainer');
    if (!bossBar) {
        bossBar = document.createElement('div');
        bossBar.id = 'bossHpContainer';
        bossBar.innerHTML = `<div id="bossHpLabel">The Soul Broker</div><div id="bossHpBarFrame"><div id="bossHpFill"></div></div>`;
        document.body.appendChild(bossBar);
    }

    // 4. Create Gameplay Inventory Bar (Map HUD) if missing
    // (Moved to ui-manager.js, called via setupInventoryUI or updateUI)
    // Actually, setupInventoryUI creates the modal. updateUI creates the HUD if missing.
    // Let's ensure setupInventoryUI is called.
    setupInventoryUI();

    // 5. Force Resize to ensure 3D canvas fills the new full-width container
    window.dispatchEvent(new Event('resize'));
}

// --- OPTIONS & SETTINGS ---
let gameSettings = {
    masterVolume: 0.5,
    musicMuted: false,
    sfxMuted: false,
    enhancedGraphics: false,
    tiltShiftMode: 'threejs', // 'off', 'css', 'threejs'
    bloomEnabled: true,
    celShadingEnabled: false,
    celOutlineEnabled: true
};

function loadSettings() {
    const s = localStorage.getItem('scoundrelSettings');
    if (s) {
        gameSettings = JSON.parse(s);
        // Migration for old boolean setting
        if (gameSettings.tiltShift !== undefined) {
            gameSettings.tiltShiftMode = gameSettings.tiltShift ? 'css' : 'off';
            delete gameSettings.tiltShift;
        }
        // Apply graphics setting if present
        if (gameSettings.enhancedGraphics !== undefined) use3dModel = gameSettings.enhancedGraphics;
        applyTiltShiftMode(gameSettings.tiltShiftMode);
        if (bloomPass) bloomPass.enabled = (gameSettings.bloomEnabled !== false);
        rebuildComposer();
    }
}

function saveSettings() {
    localStorage.setItem('scoundrelSettings', JSON.stringify(gameSettings));
}

function applyAudioSettings() {
    if (!audio.initialized) return;
    audio.setMasterVolume(gameSettings.masterVolume);
    audio.setMusicMute(gameSettings.musicMuted);
    audio.setSFXMute(gameSettings.sfxMuted);
}

window.showOptionsModal = function () {
    let modal = document.getElementById('optionsModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'optionsModal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '20000';
        document.body.appendChild(modal);
    }

    // Check for True Ending Unlock
    const wins = JSON.parse(localStorage.getItem('scoundrelWins') || '{"m":false, "f":false}');
    const isTrueEndingUnlocked = (wins.m && wins.f);

    let graphicsOption = '';
    if (isTrueEndingUnlocked) {
        graphicsOption = `
            <div style="margin:15px 0; text-align:left; display:flex; align-items:center; gap:10px; border-top: 1px solid #444; padding-top: 15px;">
                <input type="checkbox" id="enhancedGfx" ${gameSettings.enhancedGraphics ? 'checked' : ''} onchange="updateSetting('graphics', this.checked)">
                <label for="enhancedGfx" style="color:var(--gold);">Enhanced Graphics</label>
            </div>
        `;
    }

    modal.innerHTML = `
        <div style="background:rgba(0,0,0,0.9); border:2px solid var(--gold); padding:30px; width:300px; text-align:center; color:#fff; font-family:'Cinzel'; position:relative;">
            <h2 style="color:var(--gold); margin-top:0; margin-bottom:20px;">OPTIONS</h2>
            
            <div style="margin:20px 0; text-align:left;">
                <label style="display:block; margin-bottom:5px;">Master Volume</label>
                <input type="range" min="0" max="1" step="0.05" value="${gameSettings.masterVolume}" style="width:100%;" oninput="updateSetting('vol', this.value)">
            </div>

            <div style="margin:10px 0; padding:10px; border:1px dashed #555; text-align:center;">
                <button class="v2-btn" onclick="runBenchmark()" style="font-size:0.8rem; width:100%;">Auto-Detect Graphics</button>
                <div id="benchmarkResult" style="font-size:0.7rem; color:#aaa; margin-top:5px;"></div>
            </div>
            
            <div style="margin:15px 0; text-align:left; display:flex; align-items:center; gap:10px;">
                <input type="checkbox" id="muteMusic" ${gameSettings.musicMuted ? 'checked' : ''} onchange="updateSetting('music', this.checked)">
                <label for="muteMusic">Mute Music</label>
            </div>
            
            <div style="margin:15px 0; text-align:left; display:flex; align-items:center; gap:10px;">
                <input type="checkbox" id="muteSFX" ${gameSettings.sfxMuted ? 'checked' : ''} onchange="updateSetting('sfx', this.checked)">
                <label for="muteSFX">Mute Sound Effects</label>
            </div>

            <div style="margin:15px 0; text-align:left; display:flex; align-items:center; gap:10px;">
                <button class="v2-btn" id="viewToggleBtn" onclick="toggleView()" style="width:100%; font-size:0.8rem; background:${combatCameraActive ? '#d4af37' : ''};">Combat Camera: ${combatCameraActive ? 'On' : 'Off'}</button>
            </div>

            <div style="margin:15px 0; text-align:left; display:flex; align-items:center; gap:10px;">
                <input type="checkbox" id="tiltShift" ${gameSettings.tiltShiftMode === 'threejs' ? 'checked' : ''} onchange="updateSetting('tiltShift', this.checked)">
                <label for="tiltShift">Tilt-Shift FX</label>
            </div>

            <div style="margin:15px 0; text-align:left; display:flex; align-items:center; gap:10px;">
                <input type="checkbox" id="bloomFX" ${gameSettings.bloomEnabled ? 'checked' : ''} onchange="updateSetting('bloom', this.checked)">
                <label for="bloomFX">Bloom FX</label>
            </div>

            <div style="margin:15px 0; text-align:left; display:flex; align-items:center; gap:10px;">
                <input type="checkbox" id="celShading" ${gameSettings.celShadingEnabled ? 'checked' : ''} onchange="updateSetting('cel', this.checked)">
                <label for="celShading">Cel Shading (Toon)</label>
            </div>
            
            <div id="celOutlineDiv" style="margin:5px 0 15px 25px; text-align:left; display:${gameSettings.celShadingEnabled ? 'flex' : 'none'}; align-items:center; gap:10px;">
                <input type="checkbox" id="celOutline" ${gameSettings.celOutlineEnabled ? 'checked' : ''} onchange="updateSetting('celOutline', this.checked)">
                <label for="celOutline" style="font-size:0.9rem; color:#aaa;">Use Outlines</label>
            </div>

            ${graphicsOption}

            <div style="border-top:1px solid #444; margin-top:20px; padding-top:10px;">
                <button class="v2-btn" onclick="showHelpModal()" style="width:100%; margin-bottom:10px;">How to Play</button>
                <div style="display:flex; gap:10px;">
                    <button class="v2-btn" onclick="if(confirm('Abandon current run?')){ initAttractMode(); document.getElementById('optionsModal').style.display='none'; }" style="flex:1; background:#440000; color:#ffaaaa;">Abandon</button>
                    <button class="v2-btn" onclick="document.getElementById('optionsModal').style.display='none'" style="flex:1;">Close</button>
                </div>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
};

window.updateSetting = function (type, val) {
    if (type === 'vol') gameSettings.masterVolume = parseFloat(val);
    if (type === 'music') gameSettings.musicMuted = val;
    if (type === 'sfx') gameSettings.sfxMuted = val;
    if (type === 'graphics') {
        gameSettings.enhancedGraphics = val;
        show3dmodels(val);
    }
    if (type === 'tiltShift') {
        const mode = val ? 'threejs' : 'off';
        gameSettings.tiltShiftMode = mode;
        applyTiltShiftMode(mode);
    }
    if (type === 'bloom') {
        gameSettings.bloomEnabled = val;
        if (bloomPass) bloomPass.enabled = val;
    }
    if (type === 'cel') {
        gameSettings.celShadingEnabled = val;
        const sub = document.getElementById('celOutlineDiv');
        if(sub) sub.style.display = val ? 'flex' : 'none';
        rebuildComposer();
    }
    if (type === 'celOutline') {
        gameSettings.celOutlineEnabled = val;
        rebuildComposer();
    }

    saveSettings();
    if (type !== 'graphics') applyAudioSettings();
};

function applyTiltShiftMode(mode) {
    // Handle CSS Overlay
    let el = document.getElementById('tiltShiftOverlay');
    if (!el) {
        el = document.createElement('div');
        el.id = 'tiltShiftOverlay';
        el.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:1; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); mask-image: linear-gradient(to bottom, black 0%, transparent 40%, transparent 60%, black 100%); -webkit-mask-image: linear-gradient(to bottom, black 0%, transparent 40%, transparent 60%, black 100%); display:none;";
        document.body.appendChild(el);
    }
    el.style.display = (mode === 'css') ? 'block' : 'none';

    // Handle Three.js Passes
    if (hTilt && vTilt) {
        const enabled = (mode === 'threejs');
        hTilt.enabled = enabled;
        vTilt.enabled = enabled;
    }
}

// --- BENCHMARK SYSTEM (Glenn's Request) ---
window.runBenchmark = function() {
    const resEl = document.getElementById('benchmarkResult');
    if(resEl) resEl.innerText = "Testing... (3s)";
    
    let frames = 0;
    let startTime = performance.now();
    let active = true;

    // Force high load temporarily
    // We modify gameSettings so animate3D renders full FX during the test
    gameSettings.tiltShiftMode = 'threejs';
    gameSettings.bloomEnabled = true;
    gameSettings.celShadingEnabled = true;
    gameSettings.celOutlineEnabled = true;
    if(bloomPass) bloomPass.enabled = true;
    rebuildComposer();

    const loop = () => {
        if(!active) return;
        frames++;
        const now = performance.now();
        if (now - startTime >= 3000) {
            active = false;
            const fps = Math.round((frames / 3) * 10) / 10;
            
            // Decision Matrix
            let mode = "Classic";
            if (fps > 55) {
                updateSetting('graphics', true); updateSetting('tiltShift', true); updateSetting('bloom', true); updateSetting('cel', false); updateSetting('celOutline', false);
                mode = "Ultra (Enhanced + FX)";
            } else if (fps > 40) {
                updateSetting('graphics', true); updateSetting('tiltShift', true); updateSetting('bloom', false); updateSetting('cel', false); updateSetting('celOutline', false);
                mode = "High (Enhanced + Tilt)";
            } else if (fps > 25) {
                updateSetting('graphics', false); updateSetting('tiltShift', true); updateSetting('bloom', true); updateSetting('cel', false); updateSetting('celOutline', false);
                mode = "Medium (Classic + FX)";
            } else {
                updateSetting('graphics', false); updateSetting('tiltShift', false); updateSetting('bloom', false); updateSetting('cel', false); updateSetting('celOutline', false);
                mode = "Low (Classic)";
            }
            
            if(resEl) resEl.innerText = `Result: ${fps} FPS -> Set to ${mode}`;
            
            // Restore UI toggles
            const gfxCheck = document.getElementById('enhancedGfx');
            if(gfxCheck) gfxCheck.checked = gameSettings.enhancedGraphics;
            
            const tiltCheck = document.getElementById('tiltShift');
            if(tiltCheck) tiltCheck.checked = (gameSettings.tiltShiftMode === 'threejs');
            
            const bloomCheck = document.getElementById('bloomFX');
            if(bloomCheck) bloomCheck.checked = gameSettings.bloomEnabled;

            const celCheck = document.getElementById('celShading');
            if(celCheck) celCheck.checked = gameSettings.celShadingEnabled;

            const outlineCheck = document.getElementById('celOutline');
            if(outlineCheck) outlineCheck.checked = gameSettings.celOutlineEnabled;

            showBenchmarkModal(fps);
        } else {
            requestAnimationFrame(loop);
        }
    };
    loop();
}

function showBenchmarkModal(fps) {
    let modal = document.getElementById('benchmarkModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'benchmarkModal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '25000'; // Above options
        document.body.appendChild(modal);
    }

    const canClassic = true;
    const canEnhanced = fps > 40;
    const canTilt = fps > 25;
    const canBloom = fps > 50;
    const canCel = fps > 35;

    const check = (bool) => bool ? '✅' : '❌';
    const color = (bool) => bool ? '#4f4' : '#f44';
    const rowStyle = "display:flex; justify-content:space-between; margin-bottom:8px; border-bottom:1px solid #333; padding-bottom:2px;";

    modal.innerHTML = `
        <div style="background:rgba(10,10,10,0.98); border:2px solid var(--gold); padding:30px; width:400px; max-width:90%; text-align:center; color:#fff; font-family:'Cinzel'; position:relative; box-shadow: 0 0 50px rgba(0,0,0,0.8);">
            <h2 style="color:var(--gold); margin-top:0; margin-bottom:10px; text-shadow:0 2px 4px #000;">SYSTEM ANALYSIS</h2>
            <div style="font-size:1.0rem; margin-bottom:20px; color:#aaa; font-family:'Special Elite';">Stress Test Result: <span style="color:#fff; font-weight:bold; font-size:1.2rem;">${fps} FPS</span></div>
            
            <div style="text-align:left; background:rgba(255,255,255,0.03); padding:20px; border:1px solid #444; margin-bottom:20px; font-family:'Crimson Text'; font-size:1.1rem;">
                <div style="${rowStyle}">
                    <span>Classic Mode (2D)</span> <span style="color:${color(canClassic)}">${check(canClassic)}</span>
                </div>
                <div style="${rowStyle}">
                    <span>Enhanced Models (3D)</span> <span style="color:${color(canEnhanced)}">${check(canEnhanced)}</span>
                </div>
                <div style="${rowStyle}">
                    <span>Tilt-Shift FX</span> <span style="color:${color(canTilt)}">${check(canTilt)}</span>
                </div>
                <div style="display:flex; justify-content:space-between;">
                    <span>Bloom Lighting</span> <span style="color:${color(canBloom)}">${check(canBloom)}</span>
                </div>
                <div style="display:flex; justify-content:space-between;">
                    <span>Cel Shading</span> <span style="color:${color(canCel)}">${check(canCel)}</span>
                </div>
            </div>

            <div style="font-size:0.9rem; color:#d4af37; margin-bottom:20px; font-style:italic;">
                Optimal settings have been applied.
            </div>

            <button class="v2-btn" onclick="document.getElementById('benchmarkModal').style.display='none'" style="width:100%;">ACCEPT</button>
        </div>
    `;
    modal.style.display = 'flex';
}

// --- HELP SYSTEM ---
let currentHelpSlide = 0;
const helpSlides = [
    {
        title: "Navigation",
        img: "assets/images/help/help_map.png",
        text: "Click on adjacent rooms or waypoints to move. You must clear a room (defeat monsters or use items) to pass through it safely. Waypoints (small spheres) are safe spots between rooms."
    },
    {
        title: "The Room Encounter",
        img: "assets/images/help/help_combat.png",
        text: "When you enter a room, you are dealt 4 cards. You must choose 3 to clear the room. The last card is carried over to the next room. Choose wisely to manage your health and resources."
    },
    {
        title: "Combat & Weapons",
        img: "assets/images/help/help_weapon.png",
        text: "Monsters deal damage equal to their value (J=11, Q=12, K=13, A=14). If you have a Weapon, you take damage = (Monster - Weapon). If Weapon >= Monster, you take 0 damage. However, killing a monster weaker than your last kill limits your weapon's max damage for the next fight."
    },
    {
        title: "Items & Inventory",
        img: "assets/images/help/help_items.png",
        text: "Potions heal HP. Items in your backpack can be used at any time. Drag items to the 'Sell' slot to gain Soul Coins and Torch Fuel. Keep your torch lit to see further!"
    }
];

window.showHelpModal = function () {
    let modal = document.getElementById('helpModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'helpModal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '20001'; // Above options
        document.body.appendChild(modal);
    }
    currentHelpSlide = 0;
    updateHelpUI();
    modal.style.display = 'flex';
};

window.updateHelpUI = function () {
    const modal = document.getElementById('helpModal');
    const slide = helpSlides[currentHelpSlide];

    modal.innerHTML = `
        <div style="background:rgba(0,0,0,0.95); border:2px solid var(--gold); padding:20px; width:500px; max-width:90%; text-align:center; color:#fff; font-family:'Cinzel'; position:relative; display:flex; flex-direction:column; gap:15px;">
            <h2 style="color:var(--gold); margin:0;">HOW TO PLAY</h2>
            <div style="font-size:1.2rem; border-bottom:1px solid #444; padding-bottom:5px;">${slide.title}</div>
            
            <div style="width:100%; height:250px; background:#222; display:flex; align-items:center; justify-content:center; overflow:hidden; border:1px solid #444;">
                <img src="${slide.img}" style="max-width:100%; max-height:100%; object-fit:contain;" onerror="this.style.display='none'; this.parentNode.innerText='(Image: ${slide.img})'">
            </div>
            
            <div style="font-family:'Crimson Text'; font-size:1.1rem; line-height:1.4; min-height:80px;">${slide.text}</div>
            
            <div style="display:flex; justify-content:space-between; margin-top:10px;">
                <button class="v2-btn" onclick="changeHelpSlide(-1)" ${currentHelpSlide === 0 ? 'disabled style="opacity:0.5"' : ''}>Previous</button>
                <div style="align-self:center; color:#888;">${currentHelpSlide + 1} / ${helpSlides.length}</div>
                <button class="v2-btn" onclick="changeHelpSlide(1)" ${currentHelpSlide === helpSlides.length - 1 ? 'disabled style="opacity:0.5"' : ''}>Next</button>
            </div>

            <button class="v2-btn" onclick="document.getElementById('helpModal').style.display='none'" style="position:absolute; top:10px; right:10px; width:30px; height:30px; padding:0;">✕</button>
        </div>
    `;
};

window.changeHelpSlide = function (delta) {
    currentHelpSlide += delta;
    if (currentHelpSlide < 0) currentHelpSlide = 0;
    if (currentHelpSlide >= helpSlides.length) currentHelpSlide = helpSlides.length - 1;
    updateHelpUI();
};

// --- ATTRACT MODE ---
function initAttractMode() {
    console.log("Initializing Attract Mode...");
    isAttractMode = true;

    // Hide Control Box & Gameplay Options (Control box always hidden)
    const cb = document.querySelector('.control-box');
    if (cb) cb.style.display = 'none';
    
    // (Gameplay options will be enabled below for unified button)

    // Show Attraction Overlay and Setup Interactions
    const overlay = document.getElementById('attractionOverlay');
    if (overlay) {
        overlay.style.display = 'block';
        
        // Handle Overlay Click -> Open Start Menu
        overlay.onclick = (e) => {
             // Don't trigger if clicked on the options button itself (even global one)
             if (e.target.closest('#gameplayOptionsBtn')) return;
             document.getElementById('startMenuModal').style.display = 'flex';
        };
    }
    
    // Ensure Global Options Button is Visible
    const gpOpt = document.getElementById('gameplayOptionsBtn');
    if (gpOpt) gpOpt.style.display = 'flex';

    // Handle Start Menu Buttons
    const startBtn = document.getElementById('startNewDiveBtn');
    if (startBtn) {
        startBtn.onclick = () => {
             document.getElementById('startMenuModal').style.display = 'none';
             if (overlay) overlay.style.display = 'none';
             // if (cb) cb.style.display = 'flex'; // HIDDEN
             startDive();
        };
    }

    const contBtn = document.getElementById('continueDiveBtn');
    if (contBtn) {
         if (hasSave()) {
             contBtn.style.display = 'block';
             contBtn.onclick = () => {
                 document.getElementById('startMenuModal').style.display = 'none';
                 if (overlay) overlay.style.display = 'none';
                 // if (cb) cb.style.display = 'flex'; // HIDDEN
                 
                 // Show Gameplay Options Button
                 const gpOpt = document.getElementById('gameplayOptionsBtn');
                 if (gpOpt) gpOpt.style.display = 'flex';

                 // Hide Logo
                 const logo = document.getElementById('gameLogo');
                 if (logo) logo.style.opacity = '0';

                 loadGame();
             };
         } else {
             contBtn.style.display = 'none';
         }
    }

    // Hide Dock during attract mode
    const combatArea = document.querySelector('.player-combat-area');
    if (combatArea) combatArea.style.display = 'none';

    game.floor = 1;
    game.rooms = generateDungeon(1);

    preloadSounds(); // Start loading audio immediately
    // Initialize 3D engine
    init3D();

    // Generate floor and atmosphere
    globalFloorMesh = generateFloorCA(scene, 1, game.rooms, corridorMeshes, decorationMeshes, treePositions, loadTexture, getClonedTexture);
    updateAtmosphere(1);

    // Center player/torch for lighting
    if (use3dModel && playerMesh) playerMesh.position.set(0, 0.1, 0);
    if (!use3dModel && playerSprite) playerSprite.position.set(0, 0.75, 0);

    // Ensure logo is visible
    const logo = document.getElementById('gameLogo');
    if (logo) logo.style.opacity = '1';
}
window.initAttractMode = initAttractMode;

// --- SAVE SYSTEM ---
function hasSave() {
    return !!localStorage.getItem('scoundrelSave');
}

function saveGame() {
    const data = {
        hp: game.hp, maxHp: game.maxHp, floor: game.floor,
        soulCoins: game.soulCoins, ap: game.ap, maxAp: game.maxAp,
        sex: game.sex, classId: game.classId, mode: game.mode,
        isBossFight: game.isBossFight,
        isBrokerFight: game.isBrokerFight,
        currentRoomIdx: game.currentRoomIdx,
        bonfireUsed: game.bonfireUsed, merchantUsed: game.merchantUsed,
        slainStack: game.slainStack,
        equipment: game.equipment,
        weaponDurability: game.weaponDurability, // Save durability state
        backpack: game.backpack,
        hotbar: game.hotbar,
        anvil: game.anvil,
        deck: game.deck,
        // Serialize Rooms (strip meshes)
        rooms: game.rooms.map(r => {
            const copy = { ...r };
            delete copy.mesh; // Remove Three.js object
            return copy;
        })
    };
    localStorage.setItem('scoundrelSave', JSON.stringify(data));
    console.log("Game Saved.");
}

function loadGame() {
    // Ensure UI is in correct state for gameplay
    const cb = document.querySelector('.control-box');
    if (cb) cb.style.display = 'none';

    const gpOpt = document.getElementById('gameplayOptionsBtn');
    if (gpOpt) gpOpt.style.display = 'flex';

    // Hide Logo
    const logo = document.getElementById('gameLogo');
    if (logo) logo.style.opacity = '0';

    const json = localStorage.getItem('scoundrelSave');
    if (!json) return;

    const data = JSON.parse(json);

    // Restore State
    Object.assign(game, data);

    // Fallback for older saves missing weaponDurability
    if (game.weaponDurability === undefined) {
        if (game.equipment.weapon && game.equipment.weapon.durability !== undefined) {
            game.weaponDurability = game.equipment.weapon.durability;
        } else {
            game.weaponDurability = Infinity;
        }
    }

    // Hide Attract Mode
    isAttractMode = false;
    // const logo = document.getElementById('gameLogo'); // Redundant
    if (logo) logo.style.opacity = '0';
    const combatArea = document.querySelector('.player-combat-area');
    if (combatArea) combatArea.style.display = 'flex';

    const contBtn = document.getElementById('continueGameBtn');
    if (contBtn) contBtn.style.display = 'none';

    // Re-Initialize 3D
    clear3DScene();
    init3D();
    preloadFXTextures();

    // Re-Generate Floor Visuals (using loaded room data)
    // Note: generateFloorCA uses game.rooms, which we just loaded
    globalFloorMesh = generateFloorCA(scene, game.floor, game.rooms, corridorMeshes, decorationMeshes, treePositions, loadTexture, getClonedTexture);
    updateAtmosphere(game.floor);
    // initWanderers(); // Disabled for now

    // Restore Player Position
    const currentRoom = game.rooms.find(r => r.id === game.currentRoomIdx);
    if (currentRoom) {
        if (use3dModel && playerMesh) playerMesh.position.set(currentRoom.gx, 0.1, currentRoom.gy);
        else if (playerSprite) playerSprite.position.set(currentRoom.gx, 0.75, currentRoom.gy);

        // Snap Camera
        camera.position.set(20, 20, 20);
        camera.lookAt(0, 0, 0);
        controls.target.set(currentRoom.gx, 0, currentRoom.gy);
    }

    // Start Audio
    updateMusicForFloor();

    updateUI();
    logMsg("Game Loaded.");

    // If loaded into a room that isn't cleared, trigger it
    enterRoom(game.currentRoomIdx);
}

function deleteSave() {
    localStorage.removeItem('scoundrelSave');
}

// --- STORY SYSTEM (Intro & Ending) ---
let currentStoryStep = 0;
let storyData = null;
let isEnding = false;
let isTrueEnding = false;

async function loadStoryData() {
    if (storyData) return;
    try {
        const res = await fetch('assets/images/story/intro_sequence.json');
        storyData = await res.json();
    } catch (e) {
        console.warn("Could not load intro_sequence.json", e);
    }
}

async function startIntroSequence() {
    isEnding = false;
    currentStoryStep = 0;
    await loadStoryData();
    showStoryModal();
    updateStoryPanel();
}

async function startEndingSequence() {
    isEnding = true;
    currentStoryStep = 0;
    await loadStoryData();

    // Track Wins for True Ending
    const wins = JSON.parse(localStorage.getItem('scoundrelWins') || '{"m":false, "f":false}');
    wins[game.sex] = true;
    localStorage.setItem('scoundrelWins', JSON.stringify(wins));

    isTrueEnding = (wins.m && wins.f);

    showStoryModal();
    updateStoryPanel();
}

function showStoryModal() {
    let modal = document.getElementById('introModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'introModal';
        document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
}

function updateStoryPanel() {
    if (!storyData) return;

    const modal = document.getElementById('introModal');
    let panel, imgPath, text;
    let isLastStep = false;

    if (!isEnding) {
        // Intro
        if (currentStoryStep >= storyData.intro_panels.length) {
            endStory();
            return;
        }
        panel = storyData.intro_panels[currentStoryStep];
        const imgName = panel.images[game.sex === 'm' ? 'male' : 'female'];
        imgPath = `assets/images/story/${imgName}`;
        text = panel.script;
    } else {
        // Ending
        if (isTrueEnding && currentStoryStep >= storyData.ending_panels.length) {
            // True Ending
            panel = storyData.true_ending;
            imgPath = `assets/images/story/${panel.image}`;
            text = panel.script;
            isLastStep = true;
        } else if (currentStoryStep < storyData.ending_panels.length) {
            // Normal Ending
            panel = storyData.ending_panels[currentStoryStep];
            const imgName = panel.images[game.sex === 'm' ? 'male' : 'female'];
            imgPath = `assets/images/story/${imgName}`;
            text = panel.script;
        } else {
            endStory();
            return;
        }
    }

    modal.innerHTML = `
        <div class="intro-panel" style="background-image: url('${imgPath}');">
            <div class="intro-text-overlay">
                <div style="max-width: 800px;">${text}</div>
            </div>
        </div>
        <div class="intro-controls">
            ${!isEnding ? `<button class="v2-btn" onclick="endStory()">Skip</button>` : ''}
            <button class="v2-btn" onclick="nextStoryStep()">${(isEnding && isLastStep) ? 'The End' : 'Next'}</button>
        </div>
    `;
}

window.nextStoryStep = function () {
    // If we just showed the true ending, finish
    if (isEnding && isTrueEnding && currentStoryStep >= storyData.ending_panels.length) {
        endStory();
        return;
    }
    currentStoryStep++;
    updateStoryPanel();
};

window.endStory = function () {
    const modal = document.getElementById('introModal');
    if (modal) modal.style.display = 'none';

    if (!isEnding) {
        finalizeStartDive();
    } else {
        location.reload(); // Reset game after ending
    }
};

// --- LOCKPICK MINIGAME ---
let lockpickState = null;

function startLockpickGame(room) {
    let modal = document.getElementById('lockpickUI');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'lockpickUI';
        modal.innerHTML = `
            <h2 style="font-family:'Cinzel'; color:var(--gold); margin-bottom:10px;">Mechanism Locked</h2>
            <div style="margin-bottom:10px; color:#aaa; font-size:0.9rem;">Guide the light to the receiver. Click to place mirrors.</div>
            <canvas id="lockpickCanvas" width="480" height="480"></canvas>
            <div class="btn-group" style="margin-top:20px;">
                <button class="v2-btn" onclick="blastLock()">Blast Lock (-5 HP)</button>
                <button class="v2-btn" onclick="cancelLockpick()">Leave</button>
            </div>
        `;
        document.body.appendChild(modal);
    }
    modal.style.display = 'flex';

    // Initialize Puzzle
    const size = 6;
    const grid = [];
    for (let y = 0; y < size; y++) {
        const row = [];
        for (let x = 0; x < size; x++) row.push(0);
        grid.push(row);
    }

    // --- LOGIC PUZZLE GENERATOR (Guaranteed Solvable) ---
    const edges = [];
    for (let i = 0; i < size; i++) {
        edges.push({ x: i, y: -1, dir: { x: 0, y: 1 } }); // Top
        edges.push({ x: i, y: size, dir: { x: 0, y: -1 } }); // Bottom
        edges.push({ x: -1, y: i, dir: { x: 1, y: 0 } }); // Left
        edges.push({ x: size, y: i, dir: { x: -1, y: 0 } }); // Right
    }

    const start = edges[Math.floor(Math.random() * edges.length)];
    let curr = { x: start.x + start.dir.x, y: start.y + start.dir.y };
    let dir = { ...start.dir };

    const pathCells = new Set();
    let end = null;
    let steps = 0;

    // Walk a path
    while (steps < 30) {
        if (curr.x < 0 || curr.x >= size || curr.y < 0 || curr.y >= size) {
            if (steps > 2) {
                // Found an exit. Calculate direction pointing back to grid for the receiver.
                end = { x: curr.x, y: curr.y, dir: { x: -dir.x, y: -dir.y } };
                break;
            } else {
                // Retry
                curr = { x: start.x + start.dir.x, y: start.y + start.dir.y };
                dir = { ...start.dir };
                pathCells.clear();
                steps = 0;
                continue;
            }
        }
        pathCells.add(`${curr.x},${curr.y}`);
        if (Math.random() < 0.3) {
            const turn = Math.random() < 0.5 ? 1 : -1;
            if (turn === 1) dir = { x: -dir.y, y: dir.x };
            else dir = { x: dir.y, y: -dir.x };
        }
        curr.x += dir.x;
        curr.y += dir.y;
        steps++;
    }

    if (!end) {
        end = {
            x: start.x + start.dir.x * (size + 1),
            y: start.y + start.dir.y * (size + 1),
            dir: { x: -start.dir.x, y: -start.dir.y }
        };
    }

    // Place Walls
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            // Only place walls if NOT on the guaranteed path
            if (!pathCells.has(`${x},${y}`) && Math.random() < 0.20) grid[y][x] = 1;
        }
    }

    lockpickState = {
        room: room,
        grid: grid,
        size: size,
        start: start,
        end: end,
        active: true
    };

    const canvas = document.getElementById('lockpickCanvas');
    canvas.onclick = (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left) / (canvas.width / size));
        const y = Math.floor((e.clientY - rect.top) / (canvas.height / size));
        handleLockpickClick(x, y);
    };

    renderLockpickGame();
}

function handleLockpickClick(x, y) {
    if (!lockpickState || !lockpickState.active) return;
    const { grid, size, start, end } = lockpickState;
    if (x < 0 || x >= size || y < 0 || y >= size) return;

    // Prevent clicking on Start/End tiles (Emitter/Receiver)
    const sx = start.x + start.dir.x;
    const sy = start.y + start.dir.y;
    const ex = end.x + end.dir.x;
    const ey = end.y + end.dir.y;

    if ((x === sx && y === sy) || (x === ex && y === ey)) return;

    const cell = grid[y][x];
    if (cell === 1) return; // Wall

    // Cycle: Empty -> / -> \ -> Empty
    if (cell === 0) grid[y][x] = 2;
    else if (cell === 2) grid[y][x] = 3;
    else grid[y][x] = 0;

    renderLockpickGame();
}

function renderLockpickGame() {
    if (!lockpickState) return;
    const canvas = document.getElementById('lockpickCanvas');
    const ctx = canvas.getContext('2d');
    const { grid, size, start, end } = lockpickState;
    const cellSize = canvas.width / size;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Grid
    const blockTex = loadTexture('assets/images/block.png').image; // Use raw image
    const itemsTex = loadTexture('assets/images/items.png').image;
    const bgTileX = 6 * 128; // Sprite #6
    const wallTileX = 3 * 128; // Sprite #3

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            // Draw Background
            if (blockTex && blockTex.complete) {
                ctx.drawImage(blockTex, bgTileX, 0, 128, 128, x * cellSize, y * cellSize, cellSize, cellSize);
            } else {
                ctx.fillStyle = '#222';
                ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
                ctx.strokeStyle = '#444';
                ctx.strokeRect(x * cellSize, y * cellSize, cellSize, cellSize);
            }

            const cell = grid[y][x];
            const cx = x * cellSize + cellSize / 2;
            const cy = y * cellSize + cellSize / 2;

            if (cell === 1) { // Wall
                if (blockTex && blockTex.complete) ctx.drawImage(blockTex, wallTileX, 0, 128, 128, x * cellSize, y * cellSize, cellSize, cellSize);
                else { ctx.fillStyle = '#555'; ctx.fillRect(x * cellSize + 4, y * cellSize + 4, cellSize - 8, cellSize - 8); }
            } else if (cell === 2) { // Mirror /
                ctx.strokeStyle = '#00ffff';
                ctx.lineWidth = 4;
                ctx.beginPath(); ctx.moveTo(x * cellSize + 10, y * cellSize + cellSize - 10); ctx.lineTo(x * cellSize + cellSize - 10, y * cellSize + 10); ctx.stroke();
            } else if (cell === 3) { // Mirror \
                ctx.strokeStyle = '#00ffff';
                ctx.lineWidth = 4;
                ctx.beginPath(); ctx.moveTo(x * cellSize + 10, y * cellSize + 10); ctx.lineTo(x * cellSize + cellSize - 10, y * cellSize + cellSize - 10); ctx.stroke();
            }
        }
    }

    // Draw Emitter/Receiver
    // Draw Emitter/Receiver (On top of beam)
    const drawPort = (pt, spriteIdx, color) => {
        const gx = pt.x + pt.dir.x; const gy = pt.y + pt.dir.y; // Draw in adjacent valid cell
        const px = gx * cellSize; const py = gy * cellSize;
        if (itemsTex && itemsTex.complete) ctx.drawImage(itemsTex, spriteIdx * 128, 0, 128, 128, px, py, cellSize, cellSize);
        else { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px + cellSize / 2, py + cellSize / 2, cellSize / 3, 0, Math.PI * 2); ctx.fill(); }
    };

    drawPort(start, 2, '#00ff00'); // Lantern
    drawPort(end, 6, '#ff0000');   // Mirror

    // Raycast Beam
    ctx.strokeStyle = '#ccffcc';
    ctx.lineWidth = 2;
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#00ff00';

    let curr = { x: start.x + start.dir.x, y: start.y + start.dir.y };
    let dir = { ...start.dir };
    let path = [{ x: (start.x + 0.5) * cellSize, y: (start.y + 0.5) * cellSize }];

    const beamTex = loadFXImage('trace_01.png');

    // Calculate Receiver Tile (Inside Grid)
    const rx = end.x + end.dir.x;
    const ry = end.y + end.dir.y;

    let steps = 0;
    let won = false;

    while (steps < 100) {
        // Check Win (Hit Receiver Tile)
        if (curr.x === rx && curr.y === ry) {
            won = true;
            path.push({ x: (curr.x + 0.5) * cellSize, y: (curr.y + 0.5) * cellSize });
            break;
        }
        if (curr.x < 0 || curr.x >= size || curr.y < 0 || curr.y >= size) {
            path.push({ x: (curr.x + 0.5) * cellSize, y: (curr.y + 0.5) * cellSize }); // Off screen
            break;
        }

        path.push({ x: (curr.x + 0.5) * cellSize, y: (curr.y + 0.5) * cellSize });

        const cell = grid[curr.y][curr.x];
        if (cell === 1) break; // Hit wall
        if (cell === 2) { // / Mirror
            // (1,0) -> (0,-1) | (-1,0) -> (0,1) | (0,1) -> (-1,0) | (0,-1) -> (1,0)
            const oldDir = { ...dir };
            dir.x = -oldDir.y;
            dir.y = -oldDir.x;
        } else if (cell === 3) { // \ Mirror
            const oldDir = { ...dir };
            dir.x = oldDir.y;
            dir.y = oldDir.x;
        }

        curr.x += dir.x;
        curr.y += dir.y;
        steps++;
    }

    // Draw Beam
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke();
    ctx.shadowBlur = 0;

    if (won) {
        lockpickState.active = false;
        setTimeout(() => {
            document.getElementById('lockpickUI').style.display = 'none';
            logMsg("Mechanism unlocked!");
            lockpickState.room.isLocked = false;
            enterRoom(lockpickState.room.id);
        }, 500);
    }
}

window.cancelLockpick = function () {
    document.getElementById('lockpickUI').style.display = 'none';
    closeCombat(); // Reset state
};

window.blastLock = function () {
    // Check for Bomb Item
    const bombIdx = game.hotbar.findIndex(i => i && i.type === 'item' && i.id === 0);
    if (bombIdx !== -1) {
        game.hotbar[bombIdx] = null;
        logMsg("Used Bomb to blast the lock! (5 Damage taken)");
    } else {
        logMsg("Smashed the lock mechanism! (5 Damage taken)");
    }
    takeDamage(5);
    updateUI();

    if (game.hp > 0) {
        document.getElementById('lockpickUI').style.display = 'none';
        lockpickState.room.isLocked = false;
        enterRoom(lockpickState.room.id);
    } else {
        gameOver();
    }
};

// --- POTION MINIGAME ---
let potionState = null;
const potionImages = { bottle: new Image(), mask: new Image(), buffer: document.createElement('canvas') };
potionImages.bottle.src = 'assets/images/minigames/potion_bottle_base.png';
potionImages.mask.src = 'assets/images/minigames/potion_bottle_mask.png';

window.startPotionGame = function(room) {
    let modal = document.getElementById('potionUI');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'potionUI';
        modal.className = 'modal-overlay';
        modal.style.display = 'none';
        modal.style.flexDirection = 'column';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.style.zIndex = '7000';
        document.body.appendChild(modal);
    }
    
    // Generate Target Color
    const targets = [
        { name: "Crimson Vitality", r: 200, g: 20, b: 20 },
        { name: "Azure Intellect", r: 20, g: 50, b: 220 },
        { name: "Golden Greed", r: 220, g: 200, b: 20 },
        { name: "Void Essence", r: 80, g: 0, b: 120 },
        { name: "Emerald Toxin", r: 40, g: 180, b: 40 },
        { name: "Liquid Starlight", r: 200, g: 255, b: 255 },
        { name: "Obsidian Oil", r: 40, g: 40, b: 45 },
        { name: "Amber Sap", r: 255, g: 140, b: 0 },
        { name: "Royal Blood", r: 120, g: 0, b: 60 },
        { name: "Ghost Mist", r: 180, g: 220, b: 230 }
    ];
    const target = targets[Math.floor(Math.random() * targets.length)];

    potionState = {
        room: room,
        target: target,
        current: { r: 150, g: 150, b: 180, vol: 15 }, // Start with water base (Lower volume = easier)
        active: true
    };

    // Vial Buttons Data
    const vials = [
        { color: 'Red', r: 255, g: 0, b: 0, hex: '#ff0000', img: 'vial_red.png' },
        { color: 'Green', r: 0, g: 255, b: 0, hex: '#00ff00', img: 'vial_green.png' },
        { color: 'Blue', r: 0, g: 0, b: 255, hex: '#0000ff', img: 'vial_blue.png' },
        { color: 'White', r: 255, g: 255, b: 255, hex: '#ffffff', img: 'vial_white.png' },
        { color: 'Black', r: 0, g: 0, b: 0, hex: '#111111', img: 'vial_black.png' }
    ];

    const vialHtml = vials.map(v => `
        <div onclick="mixPotion(${v.r}, ${v.g}, ${v.b})" style="cursor:pointer; transition: transform 0.1s; display:flex; flex-direction:column; align-items:center;" onmousedown="this.style.transform='scale(0.9)'" onmouseup="this.style.transform='scale(1)'">
            <div style="width:40px; height:60px; background:${v.hex}; border:2px solid #aaa; border-radius:0 0 15px 15px; position:relative; box-shadow:inset 0 0 10px rgba(0,0,0,0.5);">
                <div style="position:absolute; top:-5px; left:10px; width:16px; height:10px; background:#888; border:1px solid #fff;"></div>
                <!-- Fallback to CSS shape, but use img if available -->
                <img src="assets/images/minigames/${v.img}" style="position:absolute; top:-5px; left:-2px; width:40px; height:65px; display:none;" onload="this.style.display='block'; this.parentElement.style.background='transparent'; this.parentElement.style.border='none'; this.parentElement.style.boxShadow='none';">
            </div>
            <div style="font-size:10px; color:#aaa; margin-top:4px;">${v.color}</div>
        </div>
    `).join('');

    modal.innerHTML = `
        <div style="background:rgba(10,10,10,0.95); border:2px solid var(--gold); padding:20px; width:500px; max-width:90%; text-align:center; color:#fff; font-family:'Cinzel'; position:relative; display:flex; flex-direction:column; gap:15px; box-shadow: 0 0 50px rgba(0,0,0,0.8);">
            <h2 style="color:var(--gold); margin:0;">ALCHEMY STATION</h2>
            <div style="font-size:1.0rem; color:#aaa;">Brew: <span style="color:#fff; font-weight:bold;">${target.name}</span></div>
            
            <div style="display:flex; justify-content:center; gap:30px; align-items:flex-start;">
                <!-- Bottle Canvas -->
                <div style="display:flex; flex-direction:column; align-items:center; gap:5px;">
                    <div style="position:relative; width:154px; height:269px;">
                        <canvas id="potionCanvas" width="154" height="269"></canvas>
                    </div>
                </div>
                
                <!-- Resonance Meter (Closeness) -->
                <div style="display:flex; flex-direction:column; align-items:center; gap:5px; height:269px; justify-content:center;">
                    <div style="font-size:0.8rem; color:#d4af37; writing-mode: vertical-rl; text-orientation: mixed;">RESONANCE</div>
                    <div style="width:20px; height:200px; border:2px solid #444; background:#111; position:relative; border-radius:4px; overflow:hidden;">
                        <div id="potionMeterFill" style="position:absolute; bottom:0; left:0; width:100%; height:0%; background:linear-gradient(to top, #550000, #ffaa00, #00ff00); transition:height 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);"></div>
                        <div style="position:absolute; top:15%; left:0; width:100%; height:2px; background:rgba(255,255,255,0.3);"></div> <!-- Target Line -->
                    </div>
                </div>
            </div>

            <!-- Controls -->
            <div style="display:flex; justify-content:center; gap:15px; margin-top:10px; align-items:flex-end;">
                ${vialHtml}
                <button class="v2-btn" onclick="resetPotion()" style="background:#444; color:#fff; padding:10px; width:60px; height:40px; font-size:0.8rem; border:1px solid #666;">Dump</button>
            </div>
            
            <div style="display:flex; gap:10px; margin-top:10px;">
                <button class="v2-btn" onclick="checkPotion()" style="flex:1; background:var(--gold); color:#000;">BREW</button>
                <button class="v2-btn" onclick="closePotionGame()" style="flex:1; background:#444;">Leave</button>
            </div>
            
            <div id="potionFeedback" style="height:20px; font-size:0.9rem; color:#ffaa00;"></div>
        </div>
    `;
    
    modal.style.display = 'flex';
    renderPotionCanvas();
    updatePotionUI();
};

window.mixPotion = function(r, g, b) {
    if (!potionState || !potionState.active) return;
    const cur = potionState.current;
    const addVol = 20;
    // Weighted Average Mixing
    cur.r = (cur.r * cur.vol + r * addVol) / (cur.vol + addVol);
    cur.g = (cur.g * cur.vol + g * addVol) / (cur.vol + addVol);
    cur.b = (cur.b * cur.vol + b * addVol) / (cur.vol + addVol);
    cur.vol += addVol;
    renderPotionCanvas();
    updatePotionUI();
    
    // Play Sound
    if (audio && audio.initialized) audio.play('potion_pour', { volume: 0.5, rate: 0.9 + Math.random() * 0.2 });
};

window.resetPotion = function() {
    if (!potionState) return;
    potionState.current = { r: 150, g: 150, b: 180, vol: 15 }; // Reset to base
    renderPotionCanvas();
    updatePotionUI();
    document.getElementById('potionFeedback').innerText = "Mixture reset.";
    document.getElementById('potionFeedback').style.color = "#aaa";
};

window.updatePotionUI = function() {
    const meter = document.getElementById('potionMeterFill');
    if (!meter || !potionState) return;
    const c = potionState.current;
    const t = potionState.target;
    
    // Calculate Euclidean distance in RGB space
    const dist = Math.sqrt(Math.pow(c.r - t.r, 2) + Math.pow(c.g - t.g, 2) + Math.pow(c.b - t.b, 2));
    
    // Max possible distance is ~442 (distance between black and white)
    // We want the meter to be full (100%) when dist is 0, and empty (0%) when dist > 200
    // This makes the meter sensitive only when you are getting somewhat close
    const maxRange = 200;
    const pct = Math.max(0, Math.min(100, 100 * (1 - (dist / maxRange))));
    
    meter.style.height = `${pct}%`;
    
    // Color shift based on closeness
    if (pct > 85) meter.style.background = '#00ff00'; // Green (Good)
    else if (pct > 50) meter.style.background = '#ffaa00'; // Orange (Okay)
    else meter.style.background = '#550000'; // Red (Bad)
};

window.checkPotion = function() {
    if (!potionState) return;
    const cur = potionState.current;
    const tgt = potionState.target;
    const dist = Math.sqrt(Math.pow(cur.r - tgt.r, 2) + Math.pow(cur.g - tgt.g, 2) + Math.pow(cur.b - tgt.b, 2));
    const feedback = document.getElementById('potionFeedback');
    
    if (dist < 40) {
        feedback.innerText = "Perfect Match!";
        feedback.style.color = "#00ff00";
        setTimeout(() => {
            closePotionGame();
            
            // Reward Logic
            const potionItem = { type: 'potion', val: 20, name: potionState.target.name, suit: '♥', desc: "A perfectly brewed masterwork potion." };
            
            if (addToBackpack(potionItem)) {
                spawnFloatingText("Potion Brewed!", window.innerWidth/2, window.innerHeight/2, '#00ff00');
                logMsg(`Brewed ${potionItem.name}. Added to backpack.`);
            } else {
                game.hp = game.maxHp; // Full heal if inventory full
                spawnFloatingText("Fully Healed!", window.innerWidth/2, window.innerHeight/2, '#00ff00');
                logMsg(`Brewed ${potionItem.name}. Inventory full, drank immediately.`);
            }
            
            if (potionState.room) { potionState.room.state = 'cleared'; updateUI(); }
        }, 1000);
    } else {
        feedback.innerText = "The mixture is unstable... (Too far)";
        feedback.style.color = "#ff0000";
    }
};

window.closePotionGame = function() {
    const modal = document.getElementById('potionUI');
    if (modal) modal.style.display = 'none';
    potionState = null;
};

function renderPotionCanvas() {
    if (!potionState) return;
    const canvas = document.getElementById('potionCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { r, g, b } = potionState.current;

    // Ensure buffer matches size
    if (potionImages.buffer.width !== canvas.width || potionImages.buffer.height !== canvas.height) {
        potionImages.buffer.width = canvas.width;
        potionImages.buffer.height = canvas.height;
    }
    const bCtx = potionImages.buffer.getContext('2d');
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    bCtx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 1. Draw Bottle Base (Background)
    if (potionImages.bottle.complete && potionImages.bottle.naturalWidth > 0) {
        ctx.drawImage(potionImages.bottle, 0, 0, canvas.width, canvas.height);
    }

    // 2. Create Colored Liquid Shape in Buffer
    if (potionImages.mask.complete && potionImages.mask.naturalWidth > 0) {
        bCtx.drawImage(potionImages.mask, 0, 0, canvas.width, canvas.height);
        bCtx.globalCompositeOperation = 'source-in';
        bCtx.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
        bCtx.fillRect(0, 0, canvas.width, canvas.height);
        bCtx.globalCompositeOperation = 'source-over';
    } else {
        // Fallback
        bCtx.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
        bCtx.beginPath(); bCtx.arc(canvas.width/2, canvas.height*0.6, canvas.width*0.3, 0, Math.PI*2); bCtx.fill();
    }

    // 3. Tint Overlay (Draw Color ON TOP of Bottle)
    ctx.globalCompositeOperation = 'hard-light'; // Tints the opaque bottle
    ctx.globalCompositeOperation = 'overlay'; // Tints the opaque bottle while keeping highlights
    ctx.drawImage(potionImages.buffer, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
}

function showAlchemyPrompt() {
    const overlay = document.getElementById('combatModal');
    overlay.style.display = 'flex';
    document.getElementById('combatContainer').style.display = 'none';
    document.getElementById('bonfireUI').style.display = 'none';

    let trapUI = document.getElementById('trapUI');
    if (!trapUI) {
        trapUI = document.createElement('div');
        trapUI.id = 'trapUI';
        document.body.appendChild(trapUI);
    }
    trapUI.style.display = 'flex';

    trapUI.innerHTML = `
        <h2 style="font-family:'Cinzel'; font-size:3rem; color:#00ffaa; text-shadow:0 0 20px #004400; margin-bottom:20px;">ALCHEMY LAB</h2>
        <div style="font-style:italic; margin-bottom:40px; color:#aaa; text-align:center; max-width:400px;">
            An ancient brewing station sits here, bubbling with potential. <br>Do you wish to brew a potion?
        </div>
        <div style="display:flex; gap:20px;">
            <button class="v2-btn" onclick="document.getElementById('trapUI').style.display='none'; startPotionGame(game.activeRoom);" style="width:140px;">Brew</button>
            <button class="v2-btn" onclick="closeCombat()" style="background:#444; width:140px;">Leave</button>
        </div>
    `;
}

function showShrineUI() {
    const overlay = document.getElementById('combatModal');
    overlay.style.display = 'flex';
    document.getElementById('combatContainer').style.display = 'none';
    document.getElementById('bonfireUI').style.display = 'none';

    let trapUI = document.getElementById('trapUI');
    if (!trapUI) {
        trapUI = document.createElement('div');
        trapUI.id = 'trapUI';
        document.body.appendChild(trapUI);
    }
    trapUI.style.display = 'flex';

    trapUI.innerHTML = `
        <h2 style="font-family:'Cinzel'; font-size:3rem; color:#d4af37; text-shadow:0 0 20px #000; margin-bottom:20px;">ANCIENT SHRINE</h2>
        <div style="font-style:italic; margin-bottom:40px; color:#aaa; text-align:center; max-width:400px;">
            A forgotten idol stands before you. It demands tribute or offers solace.
        </div>
        <div style="display:flex; flex-direction:column; gap:15px; width:320px;">
            <button class="v2-btn trap-option-btn" onclick="handleShrine('pray')"><span>Pray</span> <span style="color:#0f0">+2 HP</span></button>
            <button class="v2-btn trap-option-btn" onclick="handleShrine('sacrifice')"><span>Sacrifice Blood</span> <span style="color:#d00">-5 HP, +1 Max AP</span></button>
            <button class="v2-btn" onclick="handleShrine('leave')" style="background:#444; margin-top:20px;">Ignore</button>
        </div>
    `;
}

window.handleShrine = function(action) {
    if (action === 'pray') {
        const heal = Math.min(2, game.maxHp - game.hp);
        game.hp += heal;
        logMsg(`You prayed at the shrine. +${heal} HP.`);
        spawnFloatingText("BLESSED", window.innerWidth/2, window.innerHeight/2, '#00ff00');
    } else if (action === 'sacrifice') {
        takeDamage(5);
        game.maxAp += 1;
        game.ap += 1;
        logMsg("You sacrificed vitality for power. -5 HP, +1 Max AP.");
        spawnFloatingText("POWER GAINED", window.innerWidth/2, window.innerHeight/2, '#ff0000');
    } else {
        logMsg("You ignored the shrine.");
    }
    
    game.activeRoom.state = 'cleared';
    updateUI();
    closeCombat();
};

// --- ENHANCED COMBAT (3D) ---
class Standee extends THREE.Group {
    constructor() {
        super();
        this.artMesh = null;
        this.pendingTex = null;
        this.pendingConfig = null;
        this.isAnimated = false;
        this.frameCount = 1;
        this.currentFrame = 0;

        this.frameMesh = null;
        this.textMesh = null;

        // Load the Standee GLB
        loadGLB('assets/images/glb/standee-web.glb', (model) => {
            this.add(model);

            // Find the face for art (Material named 'CardFace' OR Mesh named 'CardFace')
            model.traverse((child) => {
                if (child.isMesh && (child.name === 'CardFace' || (child.material && child.material.name === 'CardFace'))) {
                    this.artMesh = child;
                    this.artMesh.visible = false; // Hide original face, we will build layers on top
                }
            });
        }, 1.0);
    }

    assemble(card, assetData) {
        // 1. Determine Rarity & Config
        const val = card.val;
        let rarity = 'common';
        if (val >= 6 && val <= 10) rarity = 'uncommon';
        else if (val >= 11 && val <= 14) rarity = 'rare';
        else if (val > 14) rarity = 'boss';

        // Access config from the global CardDesigner instance
        const layout = window.cardDesigner.config[rarity] || window.cardDesigner.config['common'];

        // 2. Setup Art Texture (Animated)
        const artTex = getClonedTexture(`assets/images/${assetData.file}`);
        this.isAnimated = assetData.isAnimated || false;
        this.frameCount = assetData.sheetCount || 1;

        if (assetData.isStrip) {
            artTex.repeat.set(1 / this.frameCount, 1);
            artTex.offset.set(assetData.uv.u, 0);
        } else {
            artTex.repeat.set(1, 1);
        }

        // 3. Setup Frame Texture
        const frameTex = getClonedTexture(layout.frame);

        // 4. Generate Text Texture
        const textCanvas = document.createElement('canvas');
        textCanvas.width = 770; textCanvas.height = 1346;
        const ctx = textCanvas.getContext('2d');

        // Helper to draw text (copied logic from CardDesigner)
        const drawTxt = (txt, settings) => {
            if (!settings) return;
            ctx.save();
            const size = settings.size || 40;
            const font = settings.font || 'Cinzel';
            ctx.font = `bold ${size}px ${font}, Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            if (settings.shadow > 0) { ctx.shadowColor = "black"; ctx.shadowBlur = settings.shadow; }
            if (settings.strokeWidth > 0) {
                ctx.strokeStyle = settings.stroke || '#000';
                ctx.lineWidth = settings.strokeWidth;
                ctx.strokeText(txt, settings.x, settings.y);
            }
            ctx.fillStyle = settings.color || '#fff';
            ctx.fillText(txt, settings.x, settings.y);
            ctx.restore();
        };

        drawTxt(card.name, layout.name);
        drawTxt(card.suit, layout.suit);
        drawTxt(`${card.val}`, layout.val);

        const textTex = new THREE.CanvasTexture(textCanvas);

        // 5. Build Layers
        // Card Dimensions in 3D (Approx based on GLB scale)
        const cardW = 1.0;
        const cardH = 1.75; // 1346/770 ratio
        const pxTo3D = 1.0 / 770; // Conversion factor for WYSIWYG

        // Helper to create a layer mesh
        const createLayer = (tex, zOffset, width = cardW, height = cardH) => {
            const geo = new THREE.PlaneGeometry(width, height);
            const mat = new THREE.MeshBasicMaterial({
                map: tex,
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: false // Important for transparency stacking
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(0, 1.0, zOffset); // Center vertically approx
            mesh.renderOrder = 1; // Base render order, will be overridden
            return mesh;
        };

        // Clear old layers
        if (this.layersGroup) this.remove(this.layersGroup);
        this.layersGroup = new THREE.Group();
        this.add(this.layersGroup);

        const layers = layout.layers || ['art', 'frame', 'text'];

        layers.forEach((layerName, idx) => {
            const z = idx * 0.02; // Increased Z separation slightly
            if (layerName === 'frame') {
                const mesh = createLayer(frameTex, z);
                mesh.renderOrder = idx + 10; // Force draw order
                this.layersGroup.add(mesh);
            } else if (layerName === 'text') {
                const mesh = createLayer(textTex, z);
                mesh.renderOrder = idx + 10;
                this.layersGroup.add(mesh);
            } else if (layerName === 'art') {
                // Use square geometry for sprite to avoid distortion
                const mesh = createLayer(artTex, z, 1.0, 1.0);
                mesh.renderOrder = idx + 10;

                if (layout.art) {
                    const artScale = layout.art.scale || 1.0;
                    // Base sprite size is 128px
                    const spriteSize = 128 * artScale;
                    const scale3D = spriteSize * pxTo3D;

                    mesh.scale.set(scale3D, scale3D, 1.0);

                    const artY = layout.art.y !== undefined ? layout.art.y : 673;
                    // Invert Y (Canvas 0 is top, 3D +Y is up)
                    // Delta from center in pixels
                    const dyPx = 673 - artY;
                    const dy3D = dyPx * pxTo3D;
                    mesh.position.y += dy3D;
                }

                this.artMesh = mesh; // Save ref for animation
                this.layersGroup.add(mesh);
            }
        });
    }


    update(time) {
        if (this.isAnimated && this.artMesh && this.artMesh.material.map) {
            // 12 FPS animation
            const frame = Math.floor((time * 12) % this.frameCount);
            if (frame !== this.currentFrame) {
                this.currentFrame = frame;
                this.artMesh.material.map.offset.x = frame / this.frameCount;
            }
        }
    }
}

class OpenChest extends THREE.Group {
    constructor() {
        super();
        this.isAnimated = false;
        this.frameCount = 1;
        this.currentFrame = 0;

        // Load Chest GLB
        loadGLB('assets/images/glb/openchest-web.glb', (model) => {
            this.add(model);
        }, 1.0);

        // Floating Item Sprite (The "Card")
        const spriteMat = new THREE.SpriteMaterial({ color: 0xffffff, transparent: true, fog: false });
        this.icon = new THREE.Sprite(spriteMat);
        this.icon.position.set(0, 1.5, 0); // Adjust height based on model
        this.icon.scale.set(0.8, 0.8, 1);
        this.add(this.icon);

        this.floatOffset = Math.random() * 100;
    }

    setArt(assetData) {
        const tex = getClonedTexture(`assets/images/${assetData.file}`);
        this.isAnimated = assetData.isAnimated || false;
        this.frameCount = assetData.sheetCount || 1;

        if (assetData.isStrip) {
            tex.repeat.set(1 / this.frameCount, 1);
            tex.offset.set(assetData.uv.u, 0);
        }
        this.icon.material.map = tex;
    }

    update(time) {
        // Gentle bobbing animation for the icon
        this.icon.position.y = 1.5 + Math.sin(time * 3 + this.floatOffset) * 0.1;

        if (this.isAnimated && this.icon.material.map) {
            const frame = Math.floor((time * 12) % this.frameCount);
            if (frame !== this.currentFrame) {
                this.currentFrame = frame;
                this.icon.material.map.offset.x = frame / this.frameCount;
            }
        }
    }

    setLabel(text, subtext, color = '#ffffff') {
        if (this.labelSprite) this.remove(this.labelSprite);

        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 128;
        const ctx = canvas.getContext('2d');

        ctx.font = 'bold 18px Arial';
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 2;
        ctx.strokeText(text, 128, 50);
        ctx.fillText(text, 128, 50);

        if (subtext) {
            ctx.font = 'bold 14px Arial';
            ctx.strokeText(subtext, 128, 80);
            ctx.fillText(subtext, 128, 80);
        }

        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false });
        this.labelSprite = new THREE.Sprite(mat);
        this.labelSprite.position.set(0, 0.6, 0); // Below the icon
        this.labelSprite.scale.set(1.5, 0.75, 1);
        this.add(this.labelSprite);
    }
}

// --- COMBAT VISIBILITY HELPERS ---
function hideNearbyDecorations(center, radius) {
    const dummy = new THREE.Object3D();
    decorationMeshes.forEach(mesh => {
        const hidden = [];
        for (let i = 0; i < mesh.count; i++) {
            mesh.getMatrixAt(i, dummy.matrix);
            dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
            // Check distance (2D check on XZ plane)
            const dist = Math.hypot(dummy.position.x - center.x, dummy.position.z - center.z);
            if (dist < radius) {
                hidden.push({ index: i, matrix: dummy.matrix.clone() });
                // Hide by scaling to 0
                dummy.scale.set(0, 0, 0);
                dummy.updateMatrix();
                mesh.setMatrixAt(i, dummy.matrix);
            }
        }
        if (hidden.length > 0) {
            mesh.instanceMatrix.needsUpdate = true;
            hiddenDecorationIndices.set(mesh.uuid, hidden);
        }
    });
}

function restoreDecorations() {
    hiddenDecorationIndices.forEach((hidden, uuid) => {
        const mesh = decorationMeshes.find(m => m.uuid === uuid);
        if (mesh) {
            hidden.forEach(item => {
                mesh.setMatrixAt(item.index, item.matrix);
            });
            mesh.instanceMatrix.needsUpdate = true;
        }
    });
    hiddenDecorationIndices.clear();
}

function enterCombatView() {
    if (isCombatView || !use3dModel) return;
    isCombatView = true;

    // Stop any active movement so player doesn't drift off Battle Island
    if (playerMoveTween) {
        playerMoveTween.stop();
        playerMoveTween = null;
    }

    // Save Camera State
    savedCamState.pos.copy(camera.position);
    savedCamState.target.copy(controls.target);
    savedCamState.zoom = camera.zoom;

    // Save Player Position
    if (playerMesh) savedPlayerPos.copy(playerMesh.position);
    else if (playerSprite) savedPlayerPos.copy(playerSprite.position);

    // Add Combat Group to Scene
    scene.add(combatGroup);

    // --- BATTLE ISLAND TELEPORT ---
    const arenaPos = BattleIsland.getAnchor();
    
    // Teleport Player to Arena
    if (playerMesh) {
        playerMesh.position.copy(arenaPos);
        playerMesh.rotation.set(0, 0, 0); // Reset rotation to face North
    }

    // Note: Camera movement happens in showCombat, which will now target the arenaPos

    // Note: Actual camera movement and entity spawning will happen in showCombat
    // when we know where the player is and what enemies to spawn.
}

function exitCombatView() {
    if (!isCombatView) return;
    isCombatView = false;
    scene.remove(combatGroup);

    // Restore Room Mesh Visibility (Safety check)
    if (game.activeRoom && roomMeshes.has(game.activeRoom.id)) {
        roomMeshes.get(game.activeRoom.id).visible = true;
    }

    // Restore camera
    controls.object = camera; // Switch controls back to Ortho camera
    controls.enableRotate = true; // Restore rotation
    controls.enablePan = true; 
    controls.autoRotate = false; // Stop spinning
    controls.maxPolarAngle = Math.PI; // Reset vertical limit
    controls.minDistance = 0;
    controls.maxDistance = Infinity;
    
    // Restore default controls
    controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN
    };

    controls.target.copy(savedCamState.target);
    controls.update();

    // Restore Player Position from Battle Island
    if (playerMesh) {
        if (game.activeRoom) {
            // Place player at the center of the room they are currently in
            playerMesh.position.set(game.activeRoom.gx, 0.1, game.activeRoom.gy);
        } else {
            playerMesh.position.copy(savedPlayerPos);
        }
    }

    // Optional: Tween Ortho camera back if we moved it, but we mostly moved Perspective camera.
    // We just switch active camera in render loop, so instant switch back is fine for "exiting mind space".
}

// --- CINEMATIC MODE (For Trailer/Screenshots) ---
window.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') {
        const sidebar = document.querySelector('.sidebar');
        const controls = document.querySelector('.control-box');
        const logo = document.getElementById('gameLogo');

        const isHidden = sidebar.style.display === 'none';

        sidebar.style.display = isHidden ? 'block' : 'none';
        if (controls) controls.style.display = isHidden ? 'block' : 'none';
        if (logo) logo.style.display = isHidden ? 'block' : 'none';

        // Trigger resize to allow 3D canvas to fill the space (or revert)
        setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
        console.log(`Cinematic Mode: ${isHidden ? 'OFF' : 'ON'}`);
    }
});

// --- DEBUG CONSOLE COMMANDS ---
window.setgame = function (mode, arg) {
    console.log(`Debug Command: ${mode}`, arg || '');
    switch (mode.toLowerCase()) {
        case 'finalboss':
            game.floor = 9;
            if (!game.activeRoom) game.activeRoom = game.rooms[0];
            startSoulBrokerEncounter();
            break;
        case 'boss':
            if (!game.activeRoom) game.activeRoom = game.rooms[0];
            startBossFight();
            break;
        case 'merchant':
            if (game.activeRoom) {
                game.activeRoom.isSpecial = true;
                game.activeRoom.isBonfire = false;
                game.activeRoom.isTrap = false;
                game.activeRoom.state = 'uncleared';
                game.activeRoom.generatedContent = null;
                enterRoom(game.activeRoom.id);
            }
            break;
        case 'bonfire':
            if (game.activeRoom) {
                game.activeRoom.isBonfire = true;
                game.activeRoom.isSpecial = false;
                game.activeRoom.isTrap = false;
                game.activeRoom.state = 'uncleared';
                game.activeRoom.restRemaining = 3;
                enterRoom(game.activeRoom.id);
            }
            break;
        case 'showhidden':
            game.rooms.forEach(r => {
                r.isRevealed = true;
                if (!r.correveals) r.correveals = {};
                r.connections.forEach(cid => r.correveals[`cor_${r.id}_${cid}`] = true);
            });
            break;
        case 'godmode':
            game.hp = 100;
            game.maxHp = 100;
            game.soulCoins = 5000;
            game.ap = 20;
            game.maxAp = 20;
            updateUI();
            logMsg("God Mode Enabled.");
            break;
        case 'floor':
            if (arg) {
                game.floor = parseInt(arg) - 1;
                descendToNextFloor();
            }
            break;
        case 'lockpick':
            if (game.activeRoom) startLockpickGame(game.activeRoom);
            break;
        case 'trap':
            if (game.activeRoom) showTrapUI();
            break;
        case 'potion':
            startPotionGame(game.activeRoom);
            break;
        default:
            console.log("Commands: finalboss, boss, merchant, bonfire, showhidden, godmode, floor [n], lockpick, trap");
    }
};

window.testmfglb = function (arg) {
    if (!playerMesh) {
        console.log("No 3D player model loaded. Enable 'Enhanced Graphics' in options.");
        return;
    }
    const anims = playerMesh.userData.animations || [];
    
    if (arg === undefined) {
        console.log("%c--- Loaded Animations ---", "color: #00ff00; font-weight: bold;");
        anims.forEach((a, i) => console.log(`[${i}] ${a.name} (Duration: ${a.duration.toFixed(2)}s)`));
        console.log("%c-------------------------", "color: #00ff00;");
        console.log("Current Mappings:");
        if (actions.idle) console.log(`Idle: ${actions.idle.getClip().name}`);
        if (actions.walk) console.log(`Walk: ${actions.walk.getClip().name}`);
        if (actions.attack) console.log(`Attack: ${actions.attack.getClip().name}`);
        if (actions.hit) console.log(`Hit: ${actions.hit.getClip().name}`);
        console.log("%c-------------------------", "color: #00ff00;");
        console.log("Run testmfglb(index) or testmfglb('name') to play.");
    } else {
        let clip = null;
        if (typeof arg === 'number') clip = anims[arg];
        else clip = anims.find(a => a.name === arg);
        
        if (clip) {
            console.log(`Playing ${clip.name}...`);
            mixer.stopAllAction();
            const act = mixer.clipAction(clip);
            act.setLoop(THREE.LoopRepeat);
            act.play();
        } else {
            console.log(`Animation '${arg}' not found.`);
        }
    }
};

window.use3dmodels = function (bool) {
    use3dModel = bool;
    console.log(`3D Models: ${use3dModel}`);

    // Ensure config is loaded before reloading scene
    const reloadScene = () => {
        const currentRoom = game.rooms.find(r => r.id === game.currentRoomIdx);
        clear3DScene();
        init3D();
        globalFloorMesh = generateFloorCA(scene, game.floor, game.rooms, corridorMeshes, decorationMeshes, treePositions, loadTexture, getClonedTexture);
        updateAtmosphere(game.floor);

        // Restore position
        if (currentRoom) {
            if (use3dModel && playerMesh) playerMesh.position.set(currentRoom.gx, 0.1, currentRoom.gy);
            else if (playerSprite) playerSprite.position.set(currentRoom.gx, 0.75, currentRoom.gy);
        }
    };

    if (Object.keys(roomConfig).length === 0) {
        console.log("Reloading Room Config...");
        loadRoomConfig().then(reloadScene);
    } else {
        reloadScene();
    }
}
window.show3dmodels = window.use3dmodels; // Alias

window.setAnimSpeed = function (speed) {
    globalAnimSpeed = speed;
    console.log(`Animation Speed: ${globalAnimSpeed}`);
};

// --- MAP EDITOR ---
window.editmap = function (bool) {
    isEditMode = bool;
    console.log(`Edit Mode: ${isEditMode}`);

    if (scene && scene.fog) scene.fog.density = isEditMode ? 0 : 0.045;

    let ui = document.getElementById('editorUI');
    if (isEditMode) {
        controls.minZoom = 0.1; // Allow zooming closer
        if (!ui) {
            ui = document.createElement('div');
            ui.id = 'editorUI';
            ui.style.cssText = "position:fixed; bottom:20px; right:20px; width:320px; background:rgba(0,0,0,0.9); border:2px solid #0ff; padding:15px; color:#fff; font-family:monospace; z-index:10000; display:flex; flex-direction:column; gap:8px; font-size:12px;";

            const row = (label, id, min, max, step, def) => `
                <div style="display:flex; align-items:center; justify-content:space-between;">
                    <label style="width:60px;">${label}</label>
                    <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${def}" style="flex-grow:1; margin:0 10px;">
                    <button class="v2-btn" onclick="resetField('${id}', ${def})" style="padding:0 5px; font-size:10px; min-width:20px;">↺</button>
                    <span id="${id}_val" style="width:35px; text-align:right;">${def}</span>
                </div>`;

            ui.innerHTML = `
                <h3 style="margin:0; color:#0ff;">Map Editor</h3>
                <div id="editorTarget" style="font-size:0.8rem; color:#aaa;">No selection</div>
                
                ${row('<span style="color:#ff6666">Pos X</span>', 'edPosX', -5, 5, 0.05, 0)}
                ${row('<span style="color:#66ff66">Pos Y</span>', 'edPosY', -5, 5, 0.05, 0)}
                ${row('<span style="color:#6666ff">Pos Z</span>', 'edPosZ', -5, 5, 0.05, 0)}
                
                ${row('Rot Y', 'edRotY', 0, 6.28, 0.1, 0)}
                
                ${row('Scale', 'edScale', 0.1, 5, 0.1, 1)}
                ${row('Height', 'edScaleY', 0.1, 5, 0.1, 1)}
                
                <button class="v2-btn" onclick="saveRoomConfig()" style="margin-top:10px; padding:5px;">Save Config (JSON)</button>
            `;
            document.body.appendChild(ui);

            // Bind inputs
            ['edPosX', 'edPosY', 'edPosZ', 'edRotY', 'edScale', 'edScaleY'].forEach(id => {
                document.getElementById(id).addEventListener('input', (e) => {
                    document.getElementById(id + '_val').innerText = e.target.value;
                    applyEditorTransform();
                });
            });
        }
        ui.style.display = 'flex';
    } else {
        if (ui) ui.style.display = 'none';
        if (selectedMesh) {
            // Reset highlight
            selectedMesh.traverse(c => { if (c.isMesh && c.material.emissive) c.material.emissive.setHex(0x000000); });
            if (currentAxesHelper) {
                if (currentAxesHelper.parent) currentAxesHelper.parent.remove(currentAxesHelper);
                currentAxesHelper = null;
            }
            selectedMesh = null;
        }
        controls.minZoom = 0.5; // Reset zoom
    }
};

window.resetField = function (id, def) {
    if (!selectedMesh) return;
    const el = document.getElementById(id);
    if (el) {
        el.value = def;
        document.getElementById(id + '_val').innerText = def;
        applyEditorTransform();
    }
};

function handleEditClick(event) {
    const container = document.getElementById('v3-container');
    const rect = container.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / container.clientWidth) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / container.clientHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);

    for (let i = 0; i < intersects.length; i++) {
        // Find the root GLB model (usually a Group inside the Room Mesh)
        let obj = intersects[i].object;
        while (obj.parent && obj.parent !== scene && !obj.userData.roomId) {
            // Check if this is a loaded GLB root (usually a Group)
            if (obj.type === 'Group' || obj.type === 'Scene') break;
            obj = obj.parent;
        }

        // If we found a GLB inside a room mesh
        if (obj && obj.parent && obj.parent.userData && obj.parent.userData.roomId !== undefined) {
            // Check for Door Warning
            if (obj.userData.configKey && obj.userData.configKey.includes('door')) {
                if (!confirm("⚠️ WARNING: Doors are auto-positioned by the game logic.\n\nEditing this will create a static override for ALL doors, which may break their alignment in other rooms.\n\nAre you sure you want to edit the door config?")) {
                    return;
                }
            }

            selectEditorMesh(obj);
            break;
        }
    }
}

function selectEditorMesh(mesh) {
    if (selectedMesh) {
        // Reset old highlight
        selectedMesh.traverse(c => { if (c.isMesh && c.material.emissive) c.material.emissive.setHex(0x000000); });
        if (currentAxesHelper) {
            if (currentAxesHelper.parent) currentAxesHelper.parent.remove(currentAxesHelper);
            currentAxesHelper = null;
        }
    }
    selectedMesh = mesh;
    // Highlight new
    selectedMesh.traverse(c => { if (c.isMesh && c.material.emissive) c.material.emissive.setHex(0x00ffff); });

    // Add Axes Helper (Red=X, Green=Y, Blue=Z)
    currentAxesHelper = new THREE.AxesHelper(2.5);
    currentAxesHelper.material.depthTest = false; // See through walls
    currentAxesHelper.renderOrder = 999; // Draw on top
    selectedMesh.add(currentAxesHelper);

    const key = mesh.userData.configKey || "Unknown Model";
    document.getElementById('editorTarget').innerText = `Selected: ${key}`;

    // Update UI values
    const updateInput = (id, val) => {
        const el = document.getElementById(id);
        if (el) {
            el.value = val; // Rounding might be needed
            document.getElementById(id + '_val').innerText = Math.round(val * 100) / 100;
        }
    };

    updateInput('edPosX', mesh.position.x);
    updateInput('edPosY', mesh.position.y);
    updateInput('edPosZ', mesh.position.z);
    updateInput('edRotY', mesh.rotation.y);
    updateInput('edScale', mesh.scale.x); // Assume uniform X/Z
    updateInput('edScaleY', mesh.scale.y);
}

function applyEditorTransform() {
    if (!selectedMesh) return;

    const px = parseFloat(document.getElementById('edPosX').value);
    const py = parseFloat(document.getElementById('edPosY').value);
    const pz = parseFloat(document.getElementById('edPosZ').value);
    const ry = parseFloat(document.getElementById('edRotY').value);
    const s = parseFloat(document.getElementById('edScale').value);
    const sy = parseFloat(document.getElementById('edScaleY').value);

    selectedMesh.position.set(px, py, pz);
    selectedMesh.rotation.y = ry;
    selectedMesh.scale.set(s, sy, s); // X and Z linked to Scale, Y independent

    // Update Config Object
    // We need to know WHICH file this is. 
    // Since we don't store the filename on the mesh, we have to infer or store it during load.
    // Let's assume the user knows what they are editing for now, or we add userData during load.
    // For now, let's just log it.
}

window.saveRoomConfig = function () {
    if (!selectedMesh) return;

    // Auto-detect key or prompt
    let key = selectedMesh.userData.configKey;
    if (!key) {
        key = prompt("Enter filename key (e.g., gothic_tower-web.glb):");
        if (!key) return;
    }

    roomConfig[key] = {
        pos: { x: selectedMesh.position.x, y: selectedMesh.position.y, z: selectedMesh.position.z },
        rot: { x: selectedMesh.rotation.x, y: selectedMesh.rotation.y, z: selectedMesh.rotation.z },
        scale: { x: selectedMesh.scale.x, y: selectedMesh.scale.y, z: selectedMesh.scale.z }
    };

    console.log("Updated Config:", JSON.stringify(roomConfig, null, 2));

    // Download
    const blob = new Blob([JSON.stringify(roomConfig, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'room_config.json';
    link.click();
};

async function loadRoomConfig() {
    try {
        const res = await fetch('assets/images/glb/room_config.json?v=' + Date.now());
        if (res.ok) {
            roomConfig = await res.json();
            console.log("Loaded Room Config", roomConfig);
        } else {
            console.warn(`Room Config not found: ${res.status}`);
        }
    } catch (e) {
        console.warn("Error loading Room Config:", e);
    }
}

// Global Mouse Down Tracker for Drag Detection
window.addEventListener('mousedown', (e) => {
    clickStart.x = e.clientX;
    clickStart.y = e.clientY;
});

// Initialize Layout
loadSettings();
loadRoomConfig().then(() => {
    setupLayout();
    initAttractMode();
});
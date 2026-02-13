// <script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { SoundManager } from './sound-manager.js';
import { MagicCircleFX } from './magic-circle.js';

// --- CORE GAME STATE ---
const game = {
    hp: 20, maxHp: 20,
    slain: 0,
    rooms: [],
    currentRoomIdx: 0,
    moves: 0,
    lastAvoided: false,
    potionsUsedThisTurn: false,
    sex: 'm', // m or f
    classId: 'knight', // knight, rogue, occultist
    mode: 'checkpoint', // checkpoint (standard) or hardcore

    // Encounter State
    activeRoom: null,
    chosenCount: 0,
    combatCards: [],
    slainStack: [],
    carryCard: null, // THE global carry-over card
    combatBusy: false, // Prevent double-clicking during animations
    soulCoins: 0,
    equipment: { head: null, chest: null, hands: null, legs: null, weapon: null },
    backpack: [], // 24 slots
    hotbar: [], // 6 slots (Provisioning)
    ap: 0, // Current Armor Points
    maxAp: 0, // Max AP based on equipment
    bonfireUsed: false, // Track for Ascetic bonus
    merchantUsed: false, // Track for Independent bonus
    pendingPurchase: null, // Track item waiting for inventory space
    isBossFight: false, // Flag for boss state
    torchCharge: 20, // Torch fuel
    anvil: [null, null] // Crafting slots
};

let roomConfig = {}; // Stores custom transforms for GLB models

// Touch Drag State
let touchDragGhost = null;
let touchDragData = null;
let touchDragMoved = false;

const ITEMS_SHEET_COUNT = 10; // Change to 10 when you add the ring graphic!
const WEAPON_SHEET_COUNT = 10; // Updated for Cursed Blade

const CURSED_ITEMS = [
    { id: 'cursed_blade', name: "Bloodthirst Blade", cost: 66, type: 'weapon', val: 12, suit: '♦', desc: "12 DMG. Drains 1 HP per room.", isCursed: true },
    { id: 'cursed_ring', name: "Ring of Burden", cost: 66, type: 'passive', desc: "+10 Max HP. Cannot Flee.", isCursed: true }
];

const ARMOR_DATA = [
    { id: 0, name: "Studded Gloves", ap: 2, cost: 25, slot: "hands", desc: "Light hand protection." },
    { id: 1, name: "Articulated Gauntlets", ap: 5, cost: 50, slot: "hands", desc: "Heavy plated hand protection." },
    { id: 2, name: "Iron Pot Helm", ap: 5, cost: 45, slot: "head", desc: "Solid iron headgear." },
    { id: 3, name: "Heavy Greaves", ap: 5, cost: 45, slot: "legs", desc: "Thick leg armor." },
    { id: 4, name: "Padded Gambeson", ap: 1, cost: 25, slot: "chest", desc: "Basic cloth armor." },
    { id: 5, name: "Reinforced Leather", ap: 2, cost: 30, slot: "chest", desc: "Hardened leather chestpiece." },
    { id: 6, name: "Chainmail Hauberk", ap: 3, cost: 40, slot: "chest", desc: "Interlinked metal rings." },
    { id: 7, name: "Steel Breastplate", ap: 4, cost: 55, slot: "chest", desc: "Solid steel chest protection." },
    { id: 8, name: "Gothic Plate", ap: 5, cost: 75, slot: "chest", desc: "Masterwork full plate." }
];

const ITEM_DATA = [
    { id: 0, name: "Volatile Bomb", cost: 30, type: 'active', desc: "Deal weapon dmg to random enemy." },
    { id: 1, name: "Spectral Lantern", cost: 50, type: 'passive', desc: "Permanent Gold Light." },
    { id: 2, name: "Skeleton Key", cost: 35, type: 'active', desc: "Avoid room (even if last avoided)." },
    { id: 3, name: "Leather Map", cost: 40, type: 'passive', desc: "Reveal all room locations." },
    { id: 4, name: "Purple Hourglass", cost: 30, type: 'active', desc: "Redraw current room." },
    { id: 5, name: "Protective Herbs", cost: 25, type: 'passive', desc: "+5 HP from Bonfires." },
    { id: 6, name: "Silver Mirror", cost: 60, type: 'passive', desc: "Survive fatal blow once." },
    { id: 7, name: "Music Box", cost: 35, type: 'active', desc: "-2 to all monsters in room." },
    { id: 8, name: "Iron-Bound Tome", cost: 50, type: 'passive', desc: "+2 Soul Coins per kill." }
];

const SUITS = { HEARTS: '♥', DIAMONDS: '♦', CLUBS: '♣', SPADES: '♠', SKULLS: '💀', MENACES: '👺' };

const CLASS_DATA = {
    knight: {
        name: "Knight",
        desc: "A stalwart defender. Starts with a Rusty Sword and basic armor.",
        hp: 20,
        items: [{ type: 'weapon', id: 'rusty_sword', val: 4, suit: '♦', name: "Rusty Sword" }, { type: 'armor', id: 0 }], // Studded Gloves
        icon: { type: 'class-icon', val: 0 } // Knight Helm
    },
    rogue: {
        name: "Rogue",
        desc: "Cunning and greedy. Starts with a Skeleton Key and a Tome for extra coins.",
        hp: 20,
        items: [{ type: 'item', id: 2 }, { type: 'item', id: 8 }], // Key, Tome
        icon: { type: 'class-icon', val: 1 } // Rogue Key
    },
    occultist: {
        name: "Occultist",
        desc: "Seeker of forbidden knowledge. Starts with the Spectral Lantern but has less health.",
        hp: 15,
        items: [{ type: 'item', id: 1 }], // Lantern
        icon: { type: 'class-icon', val: 2 } // Occultist Book
    }
};

const INTRO_STORY_DEFAULTS = [
    "The entrance to the Gilded Depths looms before you. Legends say a great Guardian protects the treasures within.",
    "You have prepared for this moment all your life. Your equipment is ready, your resolve is steel.",
    "But beware... the darkness is alive here. Light your torch, Scoundrel. Your destiny awaits."
];

// --- PROC-GEN DUNGEON (Grid Based) ---
function generateDungeon() {
    // Escalation Logic
    let numRooms = 12;
    let merchantCount = 0;

    if (game.floor <= 3) {
        numRooms = 12;
        merchantCount = 4 - game.floor; // 1->3, 2->2, 3->1
    } else if (game.floor <= 6) {
        numRooms = 24;
        // Levels 4(2), 5(1), 6(0)
        if (game.floor === 4) merchantCount = 2;
        else if (game.floor === 5) merchantCount = 1;
        else merchantCount = 0;
    } else {
        numRooms = 36;
        // Levels 7(1), 8(0), 9(0)
        if (game.floor === 7) merchantCount = 1;
        else merchantCount = 0;
    }

    const rooms = [];
    const occupied = new Set(["0,0"]);

    // 1. Create start room
    rooms.push({
        id: 0, gx: 0, gy: 0, w: 1, h: 1,
        state: 'cleared', cards: [], connections: [],
        isWaypoint: false, isRevealed: true
    });

    const frontier = [rooms[0]];
    let roomCount = 1;

    // 2. Branching Generation
    while (roomCount < numRooms && frontier.length > 0) {
        const parent = frontier[Math.floor(Math.random() * frontier.length)];
        const dirs = shuffle([{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]);

        let found = false;
        for (const d of dirs) {
            const nx = parent.gx + d.x * 4;
            const ny = parent.gy + d.y * 4;
            if (!occupied.has(`${nx},${ny}`)) {
                const newRoom = {
                    id: roomCount++,
                    gx: nx, gy: ny,
                    w: Math.random() > 0.7 ? 2 : 1,
                    h: Math.random() > 0.7 ? 2 : 1,
                    state: 'uncleared',
                    cards: [],
                    connections: [],
                    isSpecial: false, // Assigned later
                    isBonfire: false, // Assigned later
                    restRemaining: 3,
                    isWaypoint: false,
                    shape: ['rect', 'rect', 'round', 'dome', 'spire'][Math.floor(Math.random() * 5)], // Random shape
                    depth: 1.5 + Math.random() * 3, // 1.5x to 4.5x depth
                    isRevealed: false
                };

                // Link with waypoints
                insertWaypoints(parent, newRoom, rooms);

                rooms.push(newRoom);
                occupied.add(`${nx},${ny}`);
                frontier.push(newRoom);
                found = true;
                break;
            }
        }
        if (!found) frontier.splice(frontier.indexOf(parent), 1);
    }

    // 3. Assign Specials (1 Bonfire, 1-3 Merchants)

    // FIRST: Set Boss in the "furthest" room (non-waypoint) to ensure it exists
    const realRooms = rooms.filter(r => !r.isWaypoint);
    const dists = realRooms.map(r => Math.abs(r.gx) + Math.abs(r.gy));
    const maxDistIdx = dists.indexOf(Math.max(...dists));
    if (maxDistIdx !== -1) {
        realRooms[maxDistIdx].isFinal = true;
        realRooms[maxDistIdx].isSpecial = false;
        realRooms[maxDistIdx].isBonfire = false;
    }

    // Filter out start room (id 0) and final room from potential special rooms
    const potentialSpecials = rooms.filter(r => r.id !== 0 && !r.isFinal && !r.isWaypoint);
    shuffle(potentialSpecials); // Randomize list

    // Assign 1 Bonfire
    if (potentialSpecials.length > 0) {
        const b = potentialSpecials.pop();
        b.isBonfire = true;
        b.restRemaining = 3;
    }

    // Assign 1-3 Merchants
    for (let i = 0; i < merchantCount; i++) {
        if (potentialSpecials.length > 0) {
            const m = potentialSpecials.pop();
            m.isSpecial = true;
            m.generatedContent = null; // Will store the fixed items
        }
    }

    // 4. Assign Trap Rooms (1-2)
    const potentialTraps = rooms.filter(r => r.id !== 0 && !r.isFinal && !r.isWaypoint && !r.isSpecial && !r.isBonfire);
    shuffle(potentialTraps);
    const trapCount = 1 + (Math.random() > 0.5 ? 1 : 0);
    for(let i=0; i<trapCount; i++) {
        if(potentialTraps.length > 0) {
            const t = potentialTraps.pop();
            t.isTrap = true;
        }
    }

    // 5. Create Secret Room (1 per floor)
    // Find a room with an empty neighbor
    const potentialParents = rooms.filter(r => !r.isWaypoint && !r.isFinal);
    shuffle(potentialParents);
    let secretCreated = false;
    
    for(const p of potentialParents) {
        if(secretCreated) break;
        const dirs = shuffle([{x:1, y:0}, {x:-1, y:0}, {x:0, y:1}, {x:0, y:-1}]);
        for(const d of dirs) {
            const nx = p.gx + d.x * 4;
            const ny = p.gy + d.y * 4;
            // Check collision with existing rooms/waypoints
            const collide = rooms.some(r => Math.abs(r.gx - nx) < 2 && Math.abs(r.gy - ny) < 2);
            if(!collide) {
                // Create Secret Room
                const sRoom = {
                    id: roomCount++,
                    gx: nx, gy: ny, w: 1, h: 1,
                    state: 'uncleared', cards: [], connections: [],
                    isSpecial: true, isSecret: true, isLocked: true, // It's a special room (Merchant), Locked
                    generatedContent: null, // Will generate merchant
                    isWaypoint: false,
                    shape: 'rect', depth: 2, isRevealed: false
                };
                
                // Create Hidden Waypoint
                const wp = {
                    id: `wp_secret_${p.id}_${sRoom.id}`,
                    gx: p.gx + (nx - p.gx) * 0.5,
                    gy: p.gy + (ny - p.gy) * 0.5,
                    state: 'cleared', cards: [], connections: [p.id, sRoom.id],
                    isWaypoint: true, isHidden: true
                };
                
                p.connections.push(wp.id);
                sRoom.connections.push(wp.id);
                
                rooms.push(sRoom, wp);
                secretCreated = true;
                break;
            }
        }
    }

    // 6. Randomly Lock 1 other room (High value or random)
    const potentialLocks = rooms.filter(r => !r.isWaypoint && !r.isSpecial && !r.isBonfire && !r.isTrap && r.id !== 0);
    if (potentialLocks.length > 0) {
        const r = potentialLocks[Math.floor(Math.random() * potentialLocks.length)];
        r.isLocked = true;
    }

    // Remaining are monsters (default)

    return rooms;
}

function insertWaypoints(r1, r2, allRooms) {
    const wp1 = {
        id: `wp_${r1.id}_${r2.id}_a`,
        gx: r1.gx + (r2.gx - r1.gx) * 0.33, gy: r1.gy + (r2.gy - r1.gy) * 0.33,
        state: 'cleared', cards: [], connections: [r1.id], isWaypoint: true
    };
    const wp2 = {
        id: `wp_${r1.id}_${r2.id}_b`,
        gx: r1.gx + (r2.gx - r1.gx) * 0.66, gy: r1.gy + (r2.gy - r1.gy) * 0.66,
        state: 'cleared', cards: [], connections: [wp1.id, r2.id], isWaypoint: true
    };
    wp1.connections.push(wp2.id);
    r1.connections.push(wp1.id);
    // We only need to push to r1 here, r2's connections will be handled in its object
    r2.connections.push(wp2.id);
    allRooms.push(wp1, wp2);
}

// --- 3D RENDERING (Three.js Tableau) ---
let scene, camera, renderer, controls, raycaster, mouse;
let playerMarker; // Crystal marker
let torchLight;
let hemisphereLight; // Soft global fill light to improve readability under fog
let fogRings = []; // Fog ring sprites for atmospheric LOD
let roomMeshes = new Map();
let terrainMeshes = new Map();
let waypointMeshes = new Map();
let corridorMeshes = new Map();
let doorMeshes = new Map();
let decorationMeshes = []; // Store instanced meshes for cleanup
let treePositions = []; // Store tree locations for FX
let animatedMaterials = []; // Track shaders that need time updates

// Audio State
const audio = new SoundManager();
const magicFX = new MagicCircleFX();

function preloadSounds() {
    // Placeholders - You will need to add these files to assets/sounds/
    audio.load('torch_loop', 'assets/sounds/torch.ogg');
    audio.load('bonfire_loop', 'assets/sounds/campfire.ogg');
    audio.load('card_flip', 'assets/sounds/card_flip.ogg');
    audio.load('attack_slash', 'assets/sounds/attack_slash.ogg');
    audio.load('attack_blunt', 'assets/sounds/attack_blunt.ogg');
    audio.load('bgm_dungeon', 'assets/sounds/bgm_dungeon.ogg');
    // audio.load('footstep', 'assets/sounds/footstep.ogg');
    audio.load('card_shuffle', 'assets/sounds/card_shuffle.ogg');

    // Use code-generated sounds for missing files (like torch/bonfire):
    audio.loadPlaceholders();
    // audio.loadPlaceholders();
}

let ghosts = []; // Active ghost sprites
let is3DView = true;
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
let globalAnimSpeed = 1.0;
let isEditMode = false;
let selectedMesh = null;
const textureLoader = new THREE.TextureLoader();
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
    if (original.image && !original.image.complete) {
        const onImgLoad = () => {
            clone.needsUpdate = true;
            original.image.removeEventListener('load', onImgLoad);
        };
        original.image.addEventListener('load', onImgLoad);
    }
    return clone;
}

function loadGLB(path, callback, scale = 1.0, configKey = null) {
    console.log(`[GLB] Loading: ${path} (Scale: ${scale})`);
    gltfLoader.load(path, (gltf) => {
        console.log(`[GLB] Loaded: ${path}`);
        const model = gltf.scene;
        model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                child.material.side = THREE.DoubleSide; // Ensure walls are visible from inside
            }
        });
        model.scale.set(scale, scale, scale);
        
        // Store config key for editor auto-save
        if (configKey) model.userData.configKey = configKey;

        // Apply saved config if available
        if (configKey && roomConfig[configKey]) {
            const c = roomConfig[configKey];
            if (c.pos) model.position.set(c.pos.x, c.pos.y, c.pos.z);
            if (c.rot) model.rotation.set(c.rot.x, c.rot.y, c.rot.z);
            if (c.scale) model.scale.set(c.scale.x, c.scale.y, c.scale.z);
        }

        if (callback) callback(model, gltf.animations);
    }, undefined, (error) => {
        console.warn(`Could not load model: ${path}`, error);
    });
}

// FX State
const fxCanvas = document.getElementById('fxCanvas');
const fxCtx = fxCanvas.getContext('2d');
let particles = [];
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
        renderer.setSize(container.clientWidth, container.clientHeight);
    }
}
window.addEventListener('resize', handleWindowResize);

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

    const aspect = container.clientWidth / container.clientHeight;
    const d = 10;
    camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 1, 1000);
    camera.position.set(20, 20, 20);
    camera.lookAt(0, 0, 0);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.maxZoom = 2;
    controls.minZoom = 0.5;

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
        // Load Walking Textures
        walkAnims.m.up = loadTexture('assets/images/animations/m_walk_up.png');
        walkAnims.m.down = loadTexture('assets/images/animations/m_walk_down.png');
        walkAnims.f.up = loadTexture('assets/images/animations/f_walk_up.png');
        walkAnims.f.down = loadTexture('assets/images/animations/f_walk_down.png');

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

    animate3D();
    window.addEventListener('click', on3DClick);
}

function loadPlayerModel() {
    // Check for True Ending Unlock
    const wins = JSON.parse(localStorage.getItem('scoundrelWins') || '{"m":false, "f":false}');
    const isTrueEndingUnlocked = (wins.m && wins.f);
    
    const suffix = isTrueEndingUnlocked ? '_evil' : '';
    const path = `assets/images/glb/${game.sex === 'm' ? 'male' : 'female'}${suffix}-web.glb`;
    
    loadGLB(path, (model, animations) => {
        playerMesh = model;
        // Shrink model in-game as requested (Adjust 0.5 if still too big/small)
        playerMesh.scale.set(0.7, 0.7, 0.7); 
        
        playerMesh.position.set(0, 0.1, 0);
        scene.add(playerMesh);

        // Setup Animations
        if (animations && animations.length > 0) {
            mixer = new THREE.AnimationMixer(playerMesh);
            actions = {};
            
            console.log(`Animations loaded for ${game.sex}:`, animations.map(a => a.name));
            
            // Auto-detect animations or fallback to index
            // Improved detection: Look for 'idle', 'stand', 'wait', or specific names like 'Idle_03'/'Idle_15'
            const idleClip = animations.find(a => /idle|stand|wait/i.test(a.name)) || animations.find(a => a.name === 'Idle_03' || a.name === 'Idle_15') || animations[0];
            const walkClip = animations.find(a => /walk/i.test(a.name)) || animations.find(a => /run|move/i.test(a.name)) || animations.find(a => a !== idleClip) || animations[0];

            if (walkClip) actions.walk = mixer.clipAction(walkClip);
            if (idleClip) actions.idle = mixer.clipAction(idleClip);
            
            // Start Idle
            if (actions.idle) actions.idle.reset().play();
            else if (actions.walk) actions.walk.play();
        }
        
        // Position correctly if game is running
        const currentRoom = game.rooms.find(r => r.id === game.currentRoomIdx);
        if (currentRoom) {
            playerMesh.position.set(currentRoom.gx, 0.1, currentRoom.gy);
        }
    });
}

// Initialize Audio on first interaction
window.addEventListener('click', () => audio.init(), { once: true });

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

function on3DClick(event) {
    if (isEditMode) {
        handleEditClick(event);
        return;
    }
    // Prevent interaction if any modal is open
    const blockers = ['combatModal', 'lockpickUI', 'introModal', 'avatarModal', 'inventoryModal', 'classModal'];
    const isBlocked = blockers.some(id => {
        const el = document.getElementById(id);
        return el && window.getComputedStyle(el).display !== 'none';
    });
    if (isBlocked) return;

    const container = document.getElementById('v3-container');
    const rect = container.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / container.clientWidth) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / container.clientHeight) * 2 + 1;

    if (mouse.x < -1 || mouse.x > 1 || mouse.y < -1 || mouse.y > 1) return;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);

    // Iterate to find first CLICKABLE object (skipping particles)
    for (let i = 0; i < intersects.length; i++) {
        const obj = intersects[i].object;
        if (obj.userData && obj.userData.roomId !== undefined) {
            const roomIdx = obj.userData.roomId;
            const current = game.rooms.find(r => r.id === game.currentRoomIdx);

            if (current && current.connections.includes(roomIdx)) {
                enterRoom(roomIdx);
                break;
            }
            
            // Allow clicking SELF if it has an active event (Trap, Bonfire, Merchant)
            if (current && current.id === roomIdx && (current.isTrap || current.isBonfire || current.isSpecial) && current.state !== 'cleared') {
                enterRoom(roomIdx);
                break;
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
                torchLight.color.setHex(0x00ccff); torchLight.intensity = (is3DView ? baseInt * 1.5 : baseInt * 2.5);
                torchLight.distance = baseDist * 1.5; vRad = 8.0;
            } else if (game.equipment.weapon.val >= 6 || hasLantern) {
                torchLight.color.setHex(0xd4af37); torchLight.intensity = (is3DView ? baseInt * 1.2 : baseInt * 2.0);
                torchLight.distance = baseDist * 1.2; vRad = 5.0;
            } else {
                torchLight.color.setHex(0xffaa44); torchLight.intensity = (is3DView ? baseInt : baseInt * 1.5);
                torchLight.distance = baseDist; vRad = 3.5;
            }
        } else {
            torchLight.color.setHex(0xffaa44); torchLight.intensity = (is3DView ? baseInt * 0.8 : baseInt * 1.2);
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

            if (r.isRevealed) {
                if (r.isWaypoint) {
                    // Hidden Waypoint Logic
                    if (r.isHidden) {
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
                    mesh.visible = true;
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
                        } else if (r.isSpecial && !r.isFinal) { // Merchant/Special
                            if (r.isSecret) {
                                // Secret Room: Large Boulder/Mound
                                geo = new THREE.DodecahedronGeometry(Math.min(rw, rh) * 0.9, 1);
                            } else {
                                // Merchant: Octagonal Room
                                const rad = Math.min(rw, rh) * 0.45;
                                geo = new THREE.CylinderGeometry(rad, rad * 0.8, rDepth, 8);
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
                        } else if (r.shape === 'dome' || r.isSecret) {
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
                            portalMesh.position.y = -rDepth/2 + 0.2; // Slightly above floor
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
                    mesh.visible = true;
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
                        else if (r.isSpecial) { eCol = 0x8800ff; eInt = (isVisible ? 1.5 : 0.3); }
                    }

                    if (mesh.material.color.getHex() !== targetColor) mesh.material.color.setHex(targetColor);
                    if (mesh.material.emissive.getHex() !== eCol) mesh.material.emissive.setHex(eCol);
                    if (mesh.material.emissiveIntensity !== eInt) mesh.material.emissiveIntensity = eInt;
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
                    mesh.visible = (r.correveals && r.correveals[corridorId]);
                    if (mesh.visible) mesh.material.emissiveIntensity = (isDir ? 0.3 : 0.05);
                }
            });
        });

        if (currentRoom && !isAttractMode) {
            const targetPos = new THREE.Vector3(currentRoom.gx, 0, currentRoom.gy);
            controls.target.lerp(targetPos, 0.05);
        }
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

    // Rotate fog rings slowly for subtle motion
    const t = Date.now();
    fogRings.forEach(f => {
        if (!f.sprite) return;
        f.sprite.material.rotation = (t * f.speed) % (Math.PI * 2);
    });

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
    }

    // Throttled render so we don't render >30fps
    if (now - lastRenderTime >= RENDER_INTERVAL) {
        renderer.render(scene, camera);
        lastRenderTime = now;
    }

    if (window.TWEEN) TWEEN.update();
    
    // Update Animation Mixer
    if (use3dModel && mixer) {
        const delta = clock.getDelta();
        mixer.update(delta * globalAnimSpeed);
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
    if (!is3DView) {
        playerSprite.rotation.x = Math.PI / 2; playerSprite.position.y = 0.8;
        playerSprite.material.map = walkAnims[game.sex].up;
    } else {
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
            actions.walk.setEffectiveTimeScale(1.0);
            actions.walk.setEffectiveWeight(1.0);
            actions.idle.crossFadeTo(actions.walk, 0.2, true).play();
        }
        new TWEEN.Tween(playerMesh.position).to({ x: r2.gx, z: r2.gy }, 600).easing(TWEEN.Easing.Quadratic.Out).onComplete(() => {
            // Return to Idle
            if (actions.walk && actions.idle) {
                actions.walk.crossFadeTo(actions.idle, 0.2, true).play();
            }
        }).start();
    } else if (playerSprite) {
        playerSprite.material.map = (r2.gy > r1.gy) ? walkAnims[game.sex].up : walkAnims[game.sex].down;
        new TWEEN.Tween(playerSprite.position).to({ x: r2.gx, z: r2.gy }, 600).easing(TWEEN.Easing.Quadratic.Out).start();
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
                if (!roomConfig[configKey]) {
                    model.position.set(posX, -(room.rDepth / 2), posZ);
                    model.rotation.y = rotY;
                }
                mesh.add(model);
            }, 1.0, configKey);
        } else {
            const door = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), new THREE.MeshStandardMaterial({ map: tex, transparent: true, side: THREE.FrontSide }));
            door.matrixAutoUpdate = false;
            door.position.set(posX, posY, posZ);
            door.rotation.y = rotY;
            door.updateMatrix();
            mesh.add(door);
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
}

const THEMES = [
    { id: 1, name: 'Dirt', tile: 1, color: 0x3d2817, fogDensity: 0.05, hemiIntensity: 0.35 },    // Brown
    { id: 2, name: 'Stone', tile: 2, color: 0x222222, fogDensity: 0.05, hemiIntensity: 0.34 },   // Grey
    { id: 3, name: 'Moss', tile: 3, color: 0x173d1a, fogDensity: 0.04, hemiIntensity: 0.36 },    // Green
    { id: 4, name: 'Ancient', tile: 4, color: 0x3d173d, fogDensity: 0.05, hemiIntensity: 0.34 }, // Purple
    { id: 5, name: 'Magma', tile: 5, color: 0x3d1717, fogDensity: 0.06, hemiIntensity: 0.30 },   // Red
    { id: 6, name: 'Ice', tile: 6, color: 0x173d3d, fogDensity: 0.03, hemiIntensity: 0.42 },     // Cyan/Teal
    { id: 7, name: 'Abyss', tile: 7, color: 0x050505, fogDensity: 0.07, hemiIntensity: 0.22 },   // Near Black
    { id: 8, name: 'Bone', tile: 8, color: 0x3d3517, fogDensity: 0.04, hemiIntensity: 0.36 },    // Yellow/Bone
    { id: 9, name: 'Ruins', tile: 9, color: 0x282222, fogDensity: 0.035, hemiIntensity: 0.38 },   // Dusty
];

function getThemeForFloor(floor) {
    // map floor 1 -> index 0 (theme 1)
    // wrap around 1-9
    const idx = (floor - 1) % 9;
    return THEMES[idx];
}

function updateAtmosphere(floor) {
    const theme = getThemeForFloor(floor);
    
    // Darker, cleaner atmosphere (No colored fog)
    const black = new THREE.Color(0x050505);
    scene.background = black;
    // Black fog creates "fade to darkness" LOD effect
    scene.fog = new THREE.FogExp2(0x000000, 0.045);

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
}

function generateFloorCA() {
    const theme = getThemeForFloor(game.floor);
    const bounds = 12 + (game.floor * 2);
    console.debug(`Generating floor CA with theme ${theme.name} and bounds ${bounds}`);

    const size = bounds * 2 + 1;
    let grid = {};

    // ========================================
    // STEP 1: Initialize grid
    // ========================================
    for (let x = -bounds; x <= bounds; x++) {
        grid[x] = {};
        for (let z = -bounds; z <= bounds; z++) {
            let alive = Math.random() < 0.45;

            const nearRoom = game.rooms.some(r => {
                return x >= r.gx - r.w / 2 - 1 && x <= r.gx + r.w / 2 + 1 &&
                    z >= r.gy - r.h / 2 - 1 && z <= r.gy + r.h / 2 + 1;
            });

            const nearCorr = Array.from(corridorMeshes.values()).some(m => {
                const p = m.position;
                return Math.abs(x - p.x) < 2 && Math.abs(z - p.z) < 2;
            });

            if (nearRoom || nearCorr) alive = true;
            grid[x][z] = alive;
        }
    }

    // ========================================
    // STEP 2: CA Steps
    // ========================================
    for (let step = 0; step < 3; step++) {
        let nextGrid = JSON.parse(JSON.stringify(grid));
        for (let x = -bounds; x <= bounds; x++) {
            for (let z = -bounds; z <= bounds; z++) {
                let n = countNeighbors(grid, x, z, bounds);
                if (grid[x] && grid[x][z]) {
                    if (n < 3) nextGrid[x][z] = false;
                    else nextGrid[x][z] = true;
                } else {
                    if (n > 4) {
                        if (!nextGrid[x]) nextGrid[x] = {};
                        nextGrid[x][z] = true;
                    }
                }

                const protectedCell = game.rooms.some(r =>
                    x >= r.gx - r.w / 2 - 1 && x <= r.gx + r.w / 2 + 1 &&
                    z >= r.gy - r.h / 2 - 1 && z <= r.gy + r.h / 2 + 1
                );
                if (protectedCell) {
                    if (!nextGrid[x]) nextGrid[x] = {};
                    nextGrid[x][z] = true;
                }
            }
        }
        grid = nextGrid;
    }

    // ========================================
    // STEP 3: MERGED GEOMETRY - CORRECT WINDING
    // ========================================

    const positions = [];
    const uvs = [];
    const indices = [];

    const treeInstances = [];
    const rockInstances = [];
    let vertexCount = 0;

    // Pre-calculate all paths (including secret ones) for flattening
    const paths = [];
    game.rooms.forEach(r => {
        r.connections.forEach(cid => {
            const target = game.rooms.find(rm => rm.id === cid);
            if (target && r.id < target.id) { // Avoid duplicates
                paths.push({ x1: r.gx, z1: r.gy, x2: target.gx, z2: target.gy });
            }
        });
    });

    function distToSegment(px, pz, x1, z1, x2, z2) {
        const l2 = (x1 - x2) * (x1 - x2) + (z1 - z2) * (z1 - z2);
        if (l2 === 0) return Math.hypot(px - x1, pz - z1);
        let t = ((px - x1) * (x2 - x1) + (pz - z1) * (z2 - z1)) / l2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - (x1 + t * (x2 - x1)), pz - (z1 + t * (z2 - z1)));
    }

    // Helper to get height at a specific corner coordinate (world space)
    function getVertexHeight(vx, vz) {
        // 1. Flatten near rooms/corridors
        for (const r of game.rooms) {
            // Check if vertex is inside or on edge of room (with small margin)
            if (vx >= r.gx - r.w / 2 - 0.1 && vx <= r.gx + r.w / 2 + 0.1 &&
                vz >= r.gy - r.h / 2 - 0.1 && vz <= r.gy + r.h / 2 + 0.1) {
                return 0;
            }
        }
        
        // 2. Flatten along ALL paths (visible and secret)
        for (const p of paths) {
            if (distToSegment(vx, vz, p.x1, p.z1, p.x2, p.z2) < 0.8) return 0;
        }

        // 3. Terrain Noise
        const noise = Math.sin(vx * 0.15) + Math.cos(vz * 0.23);
        if (noise > 1.2) return 1.5; // Mountain
        if (noise > 0.5) return 0.75; // Hill
        return 0;
    }

    function addSolidPrism(x, z, tileIndex) {
        // Get heights for 4 corners of this tile
        // Tile x,z is centered at x,z. Corners are +/- 0.5
        const h_bl = getVertexHeight(x - 0.5, z + 0.5); // Back-Left
        const h_br = getVertexHeight(x + 0.5, z + 0.5); // Back-Right
        const h_fr = getVertexHeight(x + 0.5, z - 0.5); // Front-Right
        const h_fl = getVertexHeight(x - 0.5, z - 0.5); // Front-Left

        const base = -2.0; // Deep base to prevent floating

        // UVs
        const tileWidth = 1.0 / 9;
        const u = (tileIndex % 9) * tileWidth;

        // Helper to push quad
        const pushQuad = (v0, v1, v2, v3, uv0, uv1, uv2, uv3) => {
            positions.push(...v0, ...v1, ...v2, ...v3);
            uvs.push(...uv0, ...uv1, ...uv2, ...uv3);
            indices.push(vertexCount, vertexCount + 1, vertexCount + 2, vertexCount, vertexCount + 2, vertexCount + 3);
            vertexCount += 4;
        };

        // TOP FACE (Sloped)
        pushQuad(
            [x - 0.5, h_bl, z + 0.5], [x + 0.5, h_br, z + 0.5],
            [x + 0.5, h_fr, z - 0.5], [x - 0.5, h_fl, z - 0.5],
            [u, 1], [u + tileWidth, 1], [u + tileWidth, 0], [u, 0]
        );

        // SIDES (Skirts down to base)
        // Front (z-0.5)
        pushQuad(
            [x - 0.5, h_fl, z - 0.5], [x + 0.5, h_fr, z - 0.5],
            [x + 0.5, base, z - 0.5], [x - 0.5, base, z - 0.5],
            [u, 1], [u + tileWidth, 1], [u + tileWidth, 0], [u, 0]
        );
        // Back (z+0.5)
        pushQuad(
            [x + 0.5, h_br, z + 0.5], [x - 0.5, h_bl, z + 0.5],
            [x - 0.5, base, z + 0.5], [x + 0.5, base, z + 0.5],
            [u, 1], [u + tileWidth, 1], [u + tileWidth, 0], [u, 0]
        );
        // Left (x-0.5)
        pushQuad(
            [x - 0.5, h_bl, z + 0.5], [x - 0.5, h_fl, z - 0.5],
            [x - 0.5, base, z - 0.5], [x - 0.5, base, z + 0.5],
            [u, 1], [u + tileWidth, 1], [u + tileWidth, 0], [u, 0]
        );
        // Right (x+0.5)
        pushQuad(
            [x + 0.5, h_fr, z - 0.5], [x + 0.5, h_br, z + 0.5],
            [x + 0.5, base, z + 0.5], [x + 0.5, base, z - 0.5],
            [u, 1], [u + tileWidth, 1], [u + tileWidth, 0], [u, 0]
        );
    }

    // Build the merged floor mesh
    let tileCount = 0;
    const dummy = new THREE.Object3D(); // Helper for matrix calculation

    // Check if a coordinate is "structural" (reserved for rooms/paths)
    function isStructuralTile(x, z) {
        // Check rooms
        if (game.rooms.some(r =>
            x >= r.gx - r.w / 2 - 1.5 && x <= r.gx + r.w / 2 + 1.5 &&
            z >= r.gy - r.h / 2 - 1.5 && z <= r.gy + r.h / 2 + 1.5
        )) return true;

        // Check corridors
        if (Array.from(corridorMeshes.values()).some(m =>
            Math.abs(x - m.position.x) < 2.5 && Math.abs(z - m.position.z) < 2.5
        )) return true;
        return false;
    }

    // Calculate max variation ONCE (not inside the loop!)
    const maxVar = (theme.tile <= 7) ? 3 : 2;

    for (let x = -bounds; x <= bounds; x++) {
        for (let z = -bounds; z <= bounds; z++) {
            if (grid[x][z]) {
                // Calculate varied tile index
                // Randomize variation to avoid diagonal patterns
                const variation = Math.floor(Math.random() * maxVar);
                // Ensure we don't exceed the sprite sheet (indices 0-8)
                const tileIndex = Math.min(8, (theme.tile - 1) + variation);

                addSolidPrism(x, z, tileIndex);

                // --- DECORATIONS ---
                // Only spawn on non-structural tiles
                if (!isStructuralTile(x, z)) {
                    const h = getVertexHeight(x, z);
                    // Trees (Dead/Spooky)
                    if (Math.random() < 0.05) {
                        dummy.position.set(x, h, z);
                        dummy.rotation.set((Math.random() - 0.5) * 0.2, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.2);
                        dummy.scale.setScalar(0.8 + Math.random() * 0.5);
                        dummy.updateMatrix();
                        treeInstances.push(dummy.matrix.clone());
                        treePositions.push(new THREE.Vector3(x, h, z));
                    }
                    // Rocks/Boulders
                    else if (Math.random() < 0.08) {
                        dummy.position.set(x, h, z);
                        dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
                        dummy.scale.setScalar(0.5 + Math.random() * 0.6);
                        dummy.updateMatrix();
                        rockInstances.push(dummy.matrix.clone());
                    }
                }
                tileCount++;
            }
        }
    }

    // ========================================
    // STEP 4: Create the final merged mesh
    // ========================================

    const mergedGeometry = new THREE.BufferGeometry();
    mergedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    mergedGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    mergedGeometry.setIndex(indices);
    mergedGeometry.computeVertexNormals();

    // Load texture
    const blockTex = getClonedTexture('assets/images/block.png');
    blockTex.repeat.set(1, 1);
    blockTex.offset.set(0, 0);
    blockTex.wrapS = THREE.RepeatWrapping;
    blockTex.wrapT = THREE.RepeatWrapping;

    // Determine emissive properties based on theme (Performance-friendly Glow)
    let emissiveColor = 0x000000;
    let emissiveIntensity = 0.0;
    
    if (theme.name === 'Magma') {
        emissiveColor = 0xff4400;
        emissiveIntensity = 0.5;
    } else if (theme.name === 'Ice') {
        emissiveColor = 0x0088ff;
        emissiveIntensity = 0.4;
    } else if (theme.name === 'Moss') {
        emissiveColor = 0x225522;
        emissiveIntensity = 0.25;
    } else if (theme.name === 'Ancient') {
        emissiveColor = 0x440044;
        emissiveIntensity = 0.3;
    }

    // Create material
    const floorMaterial = new THREE.MeshStandardMaterial({
        map: blockTex,
        color: 0xffffff,
        roughness: 0.9,
        metalness: 0.1,
        side: THREE.FrontSide,  // Only render front faces
        emissive: emissiveColor,
        emissiveIntensity: emissiveIntensity
    });

    // Create ONE mesh for the entire floor
    const floorMesh = new THREE.Mesh(mergedGeometry, floorMaterial);
    floorMesh.receiveShadow = true;
    floorMesh.matrixAutoUpdate = false;
    floorMesh.updateMatrix();

    scene.add(floorMesh);

    // ========================================
    // STEP 5: INSTANCED DECORATIONS (Optimized)
    // ========================================
    if (treeInstances.length > 0) {
        const treeGeo = new THREE.CylinderGeometry(0.05, 0.15, 1.5, 5);
        treeGeo.translate(0, 0.75, 0); // Pivot at bottom
        const treeMat = new THREE.MeshStandardMaterial({ color: 0x2a1d15, roughness: 1.0 });
        const treeMesh = new THREE.InstancedMesh(treeGeo, treeMat, treeInstances.length);

        for (let i = 0; i < treeInstances.length; i++) {
            treeMesh.setMatrixAt(i, treeInstances[i]);
        }
        treeMesh.castShadow = true;
        treeMesh.receiveShadow = true;
        scene.add(treeMesh);
        decorationMeshes.push(treeMesh);
    }

    if (rockInstances.length > 0) {
        const rockGeo = new THREE.DodecahedronGeometry(0.3);
        rockGeo.translate(0, 0.15, 0); // Pivot at bottom
        const rockMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 });
        const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, rockInstances.length);

        for (let i = 0; i < rockInstances.length; i++) {
            rockMesh.setMatrixAt(i, rockInstances[i]);
        }
        rockMesh.castShadow = false; // Optimization: Small rocks don't need to cast shadows
        rockMesh.receiveShadow = true;
        scene.add(rockMesh);
        decorationMeshes.push(rockMesh);
    }

    console.log(`✅ Floor: ${tileCount} solid tiles in 1 draw call (was ${tileCount} draw calls)`);
}

function countNeighbors(grid, x, z, b) {
    let count = 0;
    for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
            if (i === 0 && j === 0) continue;
            const nx = x + i; const nz = z + j;
            if (nx < -b || nx > b || nz < -b || nz > b) continue;
            if (grid[nx][nz]) count++;
        }
    }
    return count;
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
    is3DView = !is3DView;
    const btn = document.getElementById('viewToggleBtn');
    btn.innerText = `VIEW: ${is3DView ? '3D' : '2D'}`;
    if (is3DView) { camera.position.set(20, 20, 20); controls.enableRotate = true; torchLight.intensity = 300; torchLight.distance = 40; }
    else { camera.position.set(0, 40, 0); camera.lookAt(0, 0, 0); controls.enableRotate = false; torchLight.intensity = 1500; torchLight.distance = 60; }
    camera.updateProjectionMatrix();
}
document.getElementById('viewToggleBtn').onclick = toggleView;



function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function createDeck() {
    // Deck Scaling: 1x for 1-3, 2x for 4-6, 3x for 7-9
    let multiplier = 1;
    if (game.floor >= 4) multiplier = 2;
    if (game.floor >= 7) multiplier = 3;

    // Biome Logic
    let monsterSuits = [SUITS.CLUBS, SUITS.MENACES]; // Floors 1-3: Beasts & Humanoids
    if (game.floor >= 4) monsterSuits = [SUITS.SPADES, SUITS.SKULLS]; // Floors 4-6: Shadows & Undead
    if (game.floor >= 7) monsterSuits = [SUITS.MENACES, SUITS.SKULLS]; // Floors 7-9: Deep Dark

    const deck = [];
    for (let i = 0; i < multiplier; i++) {
        // Monsters: 2-14 of selected suits
        monsterSuits.forEach(suit => {
            for (let v = 2; v <= 14; v++) {
                deck.push({ suit, val: v, type: 'monster', name: getMonsterName(v, suit) });
            }
        });
        // Weapons: 2-10 Diamonds (9)
        for (let v = 2; v <= 10; v++) {
            if (game.classId === 'occultist') {
                deck.push({ suit: SUITS.DIAMONDS, val: v, type: 'weapon', name: getSpellName(v), isSpell: true });
            } else {
                deck.push({ suit: SUITS.DIAMONDS, val: v, type: 'weapon', name: `Weapon lv.${v}` });
            }
        }
        // Potions: 2-10 Hearts (9)
        for (let v = 2; v <= 10; v++) {
            deck.push({ suit: SUITS.HEARTS, val: v, type: 'potion', name: `HP Incense ${v}` });
        }
    }
    return shuffle(deck);
}

function getSpellName(v) {
    const names = {
        2: "Fire Bolt", 3: "Ice Dagger", 4: "Poison Dart",
        5: "Lightning", 6: "Ball Lightning", 7: "Fireball",
        8: "Abyssal Rift", 9: "Comet Fall", 10: "Eldritch Annihilation",
        // Merchant/Gift Tiers (Jack-Ace) map to high tier spells
        11: "Fireball", 12: "Abyssal Rift", 13: "Comet Fall", 14: "Eldritch Annihilation"
    };
    return names[v] || "Unknown Spell";
}

function getMonsterName(v, suit) {
    if (suit === SUITS.SKULLS) {
        if (v <= 3) return 'Skeleton';
        if (v <= 5) return 'Zombie';
        if (v <= 7) return 'Ghost';
        if (v <= 9) return 'Skeletal Warrior';
        if (v === 10) return 'Ghoul';
        if (v === 11) return 'Wight';
        if (v === 12) return 'Wraith';
        if (v === 13) return 'Vampire';
        if (v === 14) return 'Lich Lord';
    } else if (suit === SUITS.MENACES) {
        if (v <= 3) return 'Kobold';
        if (v <= 5) return 'Goblin';
        if (v <= 7) return 'Gremlin';
        if (v <= 9) return 'Hobgoblin';
        if (v === 10) return 'Orc';
        if (v === 11) return 'Gnoll';
        if (v === 12) return 'Lizard-man';
        if (v === 13) return 'Yuan-ti';
        if (v === 14) return 'Bugbear Chief';
    } else {
        // Default / Spades / Clubs (Beasts/Shadows)
        if (v <= 3) return 'Shadow Creeper';
        if (v <= 5) return 'Graveling';
        if (v <= 7) return 'Rat-Bat';
        if (v <= 9) return 'Spined Horror';
        if (v === 10) return 'Grue';
        if (v === 11) return 'Jack of Spite';
        if (v === 12) return 'Queen of Sorrow';
        if (v === 13) return 'King of Ruin';
        if (v === 14) return 'Primeval Ace';
    }
    return `Monster (${v})`;
}

function startDive() {
    // Hide Logo
    const logo = document.getElementById('gameLogo');
    if (logo) logo.style.opacity = '0';

    document.getElementById('avatarModal').style.display = 'flex';
}
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

    const iconStyle = (idx) => `width:64px; height:64px; margin:0 auto 10px; background-image:url('assets/images/classes.png'); background-size:900% 100%; background-position:${(idx/9)*112.5}% 0%; border:2px solid var(--gold); background-color:rgba(0,0,0,0.5); box-shadow: 0 0 10px rgba(0,0,0,0.5);`;

    modal.innerHTML = `
        <h2 style="font-family:'Cinzel'; font-size:2.5rem; color:var(--gold); margin-bottom:20px;">Select Class</h2>
        <div class="class-selection-container">
            <div class="class-card selected" data-id="knight" onclick="selectClassUI('knight')">
                <div style="${iconStyle(0)}"></div>
                <div class="class-name">Knight</div>
                <div class="class-desc">Starts with Rusty Sword (4) and Studded Gloves (+2 AP).</div>
                <div style="margin-top:15px; font-weight:bold; color:#4f4; font-family:'Cinzel';">Easy Mode</div>
            </div>
            <div class="class-card" data-id="rogue" onclick="selectClassUI('rogue')">
                <div style="${iconStyle(1)}"></div>
                <div class="class-name">Rogue</div>
                <div class="class-desc">Starts with Skeleton Key and Iron-Bound Tome (+2 Coins/kill).</div>
                <div style="margin-top:15px; font-weight:bold; color:#d4af37; font-family:'Cinzel';">Normal Mode</div>
            </div>
            <div class="class-card" data-id="occultist" onclick="selectClassUI('occultist')">
                <div style="${iconStyle(2)}"></div>
                <div class="class-name">Occultist</div>
                <div class="class-desc">Starts with Spectral Lantern (Perm. Light). <br><span style="color:#d00">-5 Max HP.</span></div>
                <div style="margin-top:15px; font-weight:bold; color:#d00; font-family:'Cinzel';">Hard Mode</div>
            </div>
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

    // Update Control Box Buttons
    const viewBtn = document.getElementById('viewToggleBtn');
    if (viewBtn) viewBtn.style.display = 'inline-block';
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
    game.rooms = generateDungeon(); game.currentRoomIdx = 0; game.lastAvoided = false;
    game.bonfireUsed = false; game.merchantUsed = false;

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
    preloadSounds();
    generateFloorCA(); // Generate Atmosphere and Floor
    updateAtmosphere(game.floor);

    updateUI();
    logMsg("The descent begins. Room 0 explored.");

    // Reset Camera for Gameplay
    camera.position.set(20, 20, 20);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);

    // Start BGM
    audio.startLoop('bgm', 'bgm_dungeon', { volume: 0.4, isMusic: true });
    
    // Initial Save
    saveGame();
    enterRoom(0);
}

function startIntermission() {
    // Calculate Bonuses
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

    const itemsContainer = document.createElement('div');
    itemsContainer.style.cssText = "display:flex; justify-content:center; gap:15px; flex-wrap:wrap; width:100%;";
    enemyArea.appendChild(itemsContainer);

    // Render Shop Items (Random selection of 4)
    // Mix armor and items
    const pool = [...ARMOR_DATA.map(a => ({ ...a, type: 'armor' })), ...ITEM_DATA.map(i => ({ ...i, type: 'item' })), ...CURSED_ITEMS];
    shuffle(pool);

    for (let i = 0; i < 4; i++) {
        const item = pool[i];
        const card = document.createElement('div');
        card.className = 'card shop-item';

        const asset = getAssetData(item.type, item.id || item.val, null);
        
        const tint = item.isCursed ? 'filter: sepia(1) hue-rotate(60deg) saturate(3) contrast(1.2);' : '';
        const sheetCount = asset.sheetCount || 9;
        const bgSize = `${sheetCount * 100}% 100%`;
        const bgPos = `${(asset.uv.u * sheetCount) / (sheetCount - 1) * 100}% 0%`;

        card.innerHTML = `
            <div class="card-art-container" style="background-image: url('assets/images/${asset.file}'); background-size: ${bgSize}; background-position: ${bgPos}; ${tint}"></div>
            <div class="name" style="bottom: 40px; font-size: 14px; ${item.isCursed ? 'color:#adff2f;' : ''}">${item.name}</div>
            <div class="val" style="font-size: 16px; color: #ffd700;">${item.cost}</div>
            <div style="position:absolute; bottom:5px; width:100%; text-align:center; font-size:10px; color:#aaa;">${item.type === 'armor' ? `+${item.ap} AP` : (item.isCursed ? 'Cursed' : 'Item')}</div>
        `;

        card.onclick = () => {
            if (game.soulCoins >= item.cost) {
                if (getFreeBackpackSlot() === -1) {
                    spawnFloatingText("Backpack Full!", window.innerWidth / 2, window.innerHeight / 2, '#ffaa00');
                    return;
                }
                game.soulCoins -= item.cost;
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
    game.deck = createDeck(); game.rooms = generateDungeon();
    game.currentRoomIdx = 0; game.lastAvoided = false;
    game.bonfireUsed = false; game.merchantUsed = false;
    game.pendingPurchase = null;
    game.isBossFight = false;

    // Map Item Check
    const hasMap = game.hotbar.some(i => i && i.type === 'item' && i.id === 3);
    if (hasMap) {
        game.rooms.forEach(r => r.isRevealed = true);
    }

    clear3DScene(); init3D();
    // Preload FX textures for particle effects
    preloadFXTextures();
    preloadSounds();
    generateFloorCA();
    updateAtmosphere(game.floor);

    updateUI();
    logMsg(`Descending deeper... Floor ${game.floor}`);
    enterRoom(0);

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
        updateUI();
    }

    // Hardcore Auto-Save on Room Entry
    if (game.mode === 'hardcore') saveGame();

    if (room.isWaypoint) { logMsg("Traversing corridors..."); return; }

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

                    gifts.push({
                        suit: SUITS.DIAMONDS, val: val, type: 'gift', name: name,
                        actualGift: { suit: SUITS.DIAMONDS, val: val, type: 'weapon', name: name, isSpell: isSpell }
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
                    gifts.push({ suit: '🛡️', val: armor.ap, type: 'gift', name: armor.name, actualGift: { ...armor, type: 'armor' } });
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
        logMsg(`Merchant encountered! Pick your blessing.`);
        showCombat();
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
        room.cards = game.carryCard ? [game.carryCard] : [];
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
    game.combatCards.push({ type: 'monster', val: 15 + (game.floor * 2), suit: SUITS.SKULLS, name: "The Guardian", bossSlot: 'boss-guardian', customAnim: selectedGuardian });

    showCombat();
}

function startSoulBrokerEncounter() {
    game.isBossFight = true;
    game.isBrokerFight = true;
    game.activeRoom.state = 'boss_active';
    game.chosenCount = 0;

    logMsg("The Soul Broker reveals his true form!");
    
    // Narrative Popup (Optional, using log for now)
    spawnFloatingText("THE FINAL DEBT", window.innerWidth/2, window.innerHeight/2 - 100, '#d4af37');

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
            customAnim: 'final', 
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

    if (game.isBossFight) {
        enemyArea.classList.add('boss-grid');
    } else {
        enemyArea.classList.remove('boss-grid');
    }

    game.combatCards.forEach((c, idx) => {
        const card = document.createElement('div');
        card.className = `card ${c.type} dealing ${c.bossSlot || ''}`;
        card.style.animationDelay = `${idx * 0.1}s`;

        let asset = getAssetData(c.type, c.val, c.suit, c.type === 'gift' ? c.actualGift : null);
        let bgUrl = `assets/images/${asset.file}`;
        const sheetCount = asset.sheetCount || 9;
        let bgSize = asset.isStrip ? `${sheetCount * 100}% 100%` : 'cover';
        let bgPos = `${(asset.uv.u * sheetCount) / (sheetCount - 1) * 100}% 0%`;
        let animClass = "";

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
            const allCleared = game.rooms.every(r => r.isWaypoint || r.state === 'cleared' || r.state === 'boss_active');
            if (allCleared) {
                msgEl.innerText = "The Guardian awaits.";
                document.getElementById('descendBtn').style.display = 'block';
                document.getElementById('descendBtn').innerText = "Confront Guardian";
                document.getElementById('descendBtn').onclick = startBossFight;
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

function getDisplayVal(v) {
    const map = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
    return map[v] || v;
}

function spawnFloatingText(text, x, y, color) {
    const el = document.createElement('div');
    el.innerText = text;
    el.style.position = 'fixed';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.transform = 'translate(-50%, -50%)';
    el.style.color = color || '#fff';
    el.style.fontSize = '32px';
    el.style.fontWeight = 'bold';
    el.style.textShadow = '0 2px 4px #000';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '10000';
    el.style.transition = 'all 1s ease-out';
    el.style.opacity = '1';
    document.body.appendChild(el);

    requestAnimationFrame(() => {
        el.style.top = (y - 80) + 'px';
        el.style.opacity = '0';
        el.style.transform = 'translate(-50%, -50%) scale(1.5)';
    });
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1000);
}

// Helper for player attack visuals
function triggerPlayerAttackAnim(x, y, weapon) {
    // Occultist Spell FX
    if (weapon && game.classId === 'occultist' && weapon.isSpell) {
        const val = weapon.val;
        
        // Trigger Magic Circle Shader
        let circleColor = [1, 1, 1];
        if (val === 2 || val === 7 || val === 11) circleColor = [1.0, 0.5, 0.0]; // Orange/Red
        else if (val === 3) circleColor = [0.0, 1.0, 1.0]; // Ice Blue
        else if (val === 4) circleColor = [0.0, 1.0, 0.0]; // Neon Green
        else if (val === 5) circleColor = [0.2, 0.5, 1.0]; // Lightning Blue
        else if (val === 6) circleColor = [0.4, 0.4, 1.0]; // Dark Lightning
        else if (val === 8) circleColor = [0.8, 0.0, 1.0]; // Purple
        else if (val === 9) circleColor = [0.8, 0.9, 1.0]; // Blue-White
        else if (val === 10 || val === 14) circleColor = [0.2, 1.0, 0.2]; // Green
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

function pickCard(idx, event) {
    if ((game.chosenCount >= 3 && !game.isBossFight) || game.combatBusy) return;

    let card = game.combatCards[idx];
    let cardEl = event.target.closest('.card');
    
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
                cardEl.style.pointerEvents = 'auto';
                cardEl.style.transform = 'none';
                cardEl.style.opacity = '1';
                return;
            }
            break;
        case 'monster':
            game.combatBusy = true;
            // Compute damage/state but defer applying until animation finishes
            let dmg = card.val;
            const cardRect = event.target.getBoundingClientRect();
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
                game.equipment.weapon = null; game.weaponDurability = Infinity; game.slainStack = [];
                logMsg(`CRACK! The ${brokeName} has broken!`);
            } else {
                dmg = effectiveCardVal;
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
            spawnAboveModalTexture('twirl_01.png', window.innerWidth / 2, window.innerHeight / 2, 26, { tint: '#d4af37', blend: 'lighter', sizeRange: [40, 160], intensity: 1.45 });

            if (gift.type === 'weapon') {
                if (addToBackpack(gift)) {
                    logMsg(`Merchant's Blessing: Looted ${gift.name}.`);
                } else {
                    spawnFloatingText("Backpack Full!", centerX, centerY, '#ff0000');
                    cardEl.style.pointerEvents = 'auto'; cardEl.style.transform = 'none'; cardEl.style.opacity = '1';
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
                     cardEl.style.pointerEvents = 'auto'; cardEl.style.transform = 'none'; cardEl.style.opacity = '1';
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
        game.isBossFight = false;
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
            setTimeout(() => { startEndingSequence(); }, 4000);
            return;
        }

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
                logMsg("The air grows heavy. The Soul Broker approaches...");
                startSoulBrokerEncounter();
                return;
            }

            // Update message and show descend button immediately
            document.getElementById('combatMessage').innerText = "Floor Purged! The Guardian awaits.";
            document.getElementById('descendBtn').style.display = 'block';
            document.getElementById('descendBtn').innerText = "Confront Guardian";
            document.getElementById('descendBtn').onclick = startBossFight;
            document.getElementById('exitCombatBtn').style.display = 'none';
            logMsg("Floor Purged! The Guardian awaits.");
        } else {
            logMsg("Floor Purged! Return to the Guardian's lair to descend.");
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
        spawnFloatingText("CANNOT FLEE!", window.innerWidth/2, window.innerHeight/2, '#adff2f');
        return;
    }

    const room = game.activeRoom;
    game.deck.push(...room.cards);
    room.cards = [];
    room.state = 'avoided';
    game.lastAvoided = true;

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

window.handleTrap = function(action) {
    if (action === 'damage') {
        takeDamage(5);
        logMsg("You brute-forced the trap. Took 5 damage.");
    } else if (action === 'coin') {
        game.soulCoins -= 30;
        logMsg("You paid the toll. -30 Soul Coins.");
    } else if (action === 'bomb') {
        const idx = game.hotbar.findIndex(i => i && i.type === 'item' && i.id === 0);
        if (idx !== -1) game.hotbar[idx] = null;
        logMsg("You blasted the trap mechanism!");
    } else if (action === 'key') {
        const idx = game.hotbar.findIndex(i => i && i.type === 'item' && i.id === 2);
        if (idx !== -1) game.hotbar[idx] = null;
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

    if (item.id === 0) { // Bomb
        if (game.combatCards.length > 0) {
            const enemies = game.combatCards.filter(c => c.type === 'monster');
            if (enemies.length > 0) {
                const target = enemies[Math.floor(Math.random() * enemies.length)];
                const dmg = game.equipment.weapon ? Math.max(2, game.equipment.weapon.val - 2) : 2;
                target.val = Math.max(0, target.val - dmg);
                spawnFloatingText("BOMB!", window.innerWidth / 2, window.innerHeight / 2, '#ff0000');
                logMsg(`Bomb hit ${target.name} for ${dmg} dmg.`);
                game.hotbar[idx] = null;
                updateUI();
                showCombat(); // Refresh cards
            }
        }
    } else if (item.id === 2) { // Skeleton Key
        if (game.activeRoom && game.activeRoom.state !== 'cleared') {
            game.lastAvoided = false; // Bypass restriction
            avoidRoom();
            game.hotbar[idx] = null;
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
        game.hotbar[idx] = null;
        updateUI();
        showCombat();
    }
};

// --- INVENTORY HELPERS ---
function getFreeBackpackSlot() {
    return game.backpack.findIndex(s => s === null);
}

function addToBackpack(item) {
    const idx = getFreeBackpackSlot();
    if (idx !== -1) {
        game.backpack[idx] = item;
        updateUI();
        return true;
    }
    return false;
}

function addToHotbar(item) {
    const idx = game.hotbar.findIndex(s => s === null);
    if (idx !== -1) {
        game.hotbar[idx] = item;
        updateUI();
        return true;
    }
    return false;
}

function recalcAP() {
    let total = 0;
    Object.values(game.equipment).forEach(i => {
        if (i && i.type === 'armor') total += i.ap;
    });
    game.maxAp = total;
    // Clamp current AP
    if (game.ap > game.maxAp) game.ap = game.maxAp;
}


// --- UI UTILS ---
function updateUI() {
    // Update Sidebar
    document.getElementById('hpValueSidebar').innerText = game.hp;
    document.getElementById('hpBarSidebar').style.width = `${(game.hp / game.maxHp) * 100}%`;

    // Visual Progression: Change sidebar background block based on floor
    const blockNum = Math.min(9, game.floor).toString().padStart(3, '0');
    document.querySelector('.sidebar').style.backgroundImage = `url('assets/images/individuals/block_${blockNum}.png')`;

    // Update Modal
    document.getElementById('hpValueModal').innerText = game.hp;
    document.getElementById('hpBarModal').style.width = `${(game.hp / game.maxHp) * 100}%`;

    // Update AP Bar (Inject if needed)
    let apBar = document.getElementById('apBarModal');
    if (!apBar) {
        const hpContainer = document.getElementById('hpBarModal').parentNode;
        // FIX: Ensure parent is relative so absolute child is contained
        if (getComputedStyle(hpContainer).position === 'static') {
            hpContainer.style.position = 'relative';
        }
        apBar = document.createElement('div');
        apBar.id = 'apBarModal';
        apBar.style.cssText = "position:absolute; top:0; left:0; height:100%; background:#88aaff; opacity:0.6; transition: width 0.3s;";
        hpContainer.appendChild(apBar);
    }
    apBar.style.width = `${(game.ap / Math.max(1, game.maxAp)) * 100}%`;

    // Inject Soul Coins UI if missing
    const weaponDurEl = document.getElementById('weaponDurSidebar');
    if (weaponDurEl && !document.getElementById('soulCoinsContainer')) {
        const div = document.createElement('div');
        div.id = 'soulCoinsContainer';
        div.style.marginTop = '10px';
        div.style.textAlign = 'center';
        div.style.color = '#d4af37';
        div.style.fontWeight = 'bold';
        div.style.textShadow = '0 1px 2px #000';
        div.innerHTML = `Soul Coins: <span id="soulCoinsValueSidebar" style="color: #fff;">0</span>`;
        weaponDurEl.parentNode.appendChild(div);
    }

        // Inject Torch Fuel UI into Dock/Modal (Vertical Bar)
    const statSubgrid = document.querySelector('.player-combat-area .stat-subgrid');
    if (statSubgrid && !document.getElementById('torchFuelDock')) {
        const torchCol = document.createElement('div');
        torchCol.id = 'torchFuelDock';
        torchCol.className = 'stat-col torch';
        torchCol.style.cssText = "flex: 0 0 auto; display: flex; flex-direction: column; align-items: center; margin-left: 20px; justify-content: flex-end;";
        
        torchCol.innerHTML = `
            <div class="stat-label" style="font-size: 0.7rem; margin-bottom: 5px; color: #ffaa44;">FUEL</div>
            <div style="position: relative; width: 14px; height: 42px; background: #111; border: 1px solid #444;">
                <div id="torchBarDock" style="position: absolute; bottom: 0; left: 0; width: 100%; height: 100%; background: #ffaa44; transition: height 0.3s;"></div>
            </div>
            <div id="torchValueDock" style="font-size: 0.9rem; color: #fff; margin-top: 2px; font-weight: bold; text-shadow: 0 1px 2px #000;">20</div>
        `;
        statSubgrid.appendChild(torchCol);
    }
    
    const coinEl = document.getElementById('soulCoinsValueSidebar');
    if (coinEl) coinEl.innerText = game.soulCoins;
    const coinModalEl = document.getElementById('soulCoinsValueModal');
    if (coinModalEl) coinModalEl.innerText = game.soulCoins;

    const floorEl = document.getElementById('floorValue');
    if (floorEl) floorEl.innerText = game.floor;
    const floorModalEl = document.getElementById('floorValueModal');
    if (floorModalEl) floorModalEl.innerText = game.floor;

    const torchBar = document.getElementById('torchBarDock');
    const torchVal = document.getElementById('torchValueDock');
    if (torchBar && torchVal) {
        const maxFuel = 30; // Visual scale max
        const pct = Math.min(100, (game.torchCharge / maxFuel) * 100);
        torchBar.style.height = `${pct}%`;
        torchVal.innerText = game.torchCharge;
        
        if (game.torchCharge <= 5) {
            torchVal.style.color = '#ff4444';
            torchBar.style.background = '#ff4444';
        } else {
            torchVal.style.color = '#fff';
            torchBar.style.background = '#ffaa44';
        }
    }

    // const totalRooms = game.rooms ? game.rooms.filter(r => !r.isWaypoint).length : 0;
    // const clearedRooms = game.rooms ? game.rooms.filter(r => !r.isWaypoint && r.state === 'cleared').length : 0;
        // Only count MANDATORY rooms for progress (Monsters & Traps)
    // Exclude Waypoints, Specials (Merchants/Secret), and Bonfires
    const mandatoryRooms = game.rooms ? game.rooms.filter(r => !r.isWaypoint && !r.isSpecial && !r.isBonfire) : [];
    const totalRooms = mandatoryRooms.length;
    const clearedRooms = mandatoryRooms.filter(r => r.state === 'cleared').length;


    const progressEl = document.getElementById('progressValue');
    // if (progressEl) progressEl.innerText = `${clearedRooms} / ${totalRooms}`;
    // const progressModalEl = document.getElementById('progressValueModal');
    // if (progressModalEl) progressModalEl.innerText = `${clearedRooms} / ${totalRooms}`;
        if (progressEl) progressEl.innerText = `${clearedRooms} / ${totalRooms}`;
    const progressModalEl = document.getElementById('progressValueModal');
    if (progressModalEl) progressModalEl.innerText = `${clearedRooms} / ${totalRooms}`;

    const deckEl = document.getElementById('deckValue');
    if (deckEl) deckEl.innerText = game.deck.length;
    const deckModalEl = document.getElementById('deckValueModal');
    if (deckModalEl) deckModalEl.innerText = game.deck.length;

    const weaponLabel = document.getElementById('weaponNameModal');
    const weaponDetail = document.getElementById('weaponLastDealModal');
    const weaponArtModal = document.getElementById('weaponArtModal');

    if (game.equipment.weapon) {
        // Ensure name doesn't already have (X) before adding it
        const cleanName = game.equipment.weapon.name.split(' (')[0];
        weaponLabel.innerText = `${cleanName} (${game.equipment.weapon.val})`;
        weaponDetail.innerText = game.weaponDurability === Infinity ? "Clean Weapon: No limit" : `Bloody: Next <${game.weaponDurability}`;
        weaponLabel.style.color = 'var(--gold)';

        const asset = getAssetData('weapon', game.equipment.weapon.val, game.equipment.weapon.suit);
        const sheetCount = asset.sheetCount || 9;
        const bgSize = `${sheetCount * 100}% 100%`;
        const bgPos = `${(asset.uv.u * sheetCount) / (sheetCount - 1) * 100}% 0%`;

        // Update Modal Art
        if (weaponArtModal) {
            weaponArtModal.style.backgroundImage = `url('assets/images/${asset.file}')`;
            weaponArtModal.style.backgroundSize = bgSize;
            weaponArtModal.style.backgroundPosition = bgPos;
        }

        // Update Sidebar Slot
        const weaponArtSidebar = document.getElementById('weaponArtSidebar');
        if (weaponArtSidebar) {
            weaponArtSidebar.style.backgroundImage = `url('assets/images/${asset.file}')`;
            weaponArtSidebar.style.backgroundSize = bgSize;
            weaponArtSidebar.style.backgroundPosition = bgPos;
        }
        const nameSidebar = document.getElementById('weaponNameSidebar');
        if (nameSidebar) nameSidebar.innerText = `${cleanName} (${game.equipment.weapon.val})`;
        const durSidebar = document.getElementById('weaponDurSidebar');
        if (durSidebar) durSidebar.innerText = game.weaponDurability === Infinity ? "Next: Any" : `Next: <${game.weaponDurability}`;
    } else {
        weaponLabel.innerText = "BARE HANDS";
        weaponDetail.innerText = "No protection";
        weaponLabel.style.color = '#fff';
        if (weaponArtModal) weaponArtModal.style.backgroundImage = "none";

        // Update Sidebar Slot
        const weaponArtSidebar = document.getElementById('weaponArtSidebar');
        if (weaponArtSidebar) weaponArtSidebar.style.backgroundImage = "none";
        const nameSidebar = document.getElementById('weaponNameSidebar');
        if (nameSidebar) nameSidebar.innerText = "UNARMED";
        const durSidebar = document.getElementById('weaponDurSidebar');
        if (durSidebar) durSidebar.innerText = "No limit";
    }

    // Update Inventory UI
    let invContainer = document.getElementById('inventorySidebar');
    if (!invContainer) {
        invContainer = document.createElement('div');
        invContainer.id = 'inventorySidebar';
        invContainer.style.cssText = "display:grid; grid-template-columns:repeat(3, 1fr); gap:4px; margin-top:10px;";
        document.querySelector('.sidebar').appendChild(invContainer);
    } else {
        // Reset style in case it was highlighted for swap
        invContainer.style.boxShadow = "none";
    }

    // Create Tooltip Element if missing
    let tooltip = document.getElementById('gameTooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'gameTooltip';
        tooltip.style.cssText = "position:fixed; pointer-events:none; background:rgba(0,0,0,0.95); border:1px solid #666; color:#fff; padding:8px; font-size:12px; z-index:10000; display:none; max-width:200px; border-radius:4px; box-shadow: 0 4px 8px rgba(0,0,0,0.5);";
        document.body.appendChild(tooltip);
    }

    const protectionFloor = Object.values(game.equipment).filter(i => i && i.type === 'armor').length;
    const isArmorBroken = game.ap <= protectionFloor;

    invContainer.innerHTML = '';
    for (let i = 0; i < 6; i++) {
        const slot = document.createElement('div');
        slot.style.cssText = "width:100%; aspect-ratio:1; background:rgba(0,0,0,0.5); border:1px solid #444; position:relative; cursor: pointer;";
        if (game.hotbar[i]) {
            const item = game.hotbar[i];
            const val = item.type === 'potion' ? item.val : item.id;
            const asset = getAssetData(item.type, val, item.suit);

            // Broken Armor Tint (Red) - only if it's armor and we are at the floor
            let tint = (item.type === 'armor' && isArmorBroken) ? 'filter: sepia(1) hue-rotate(-50deg) saturate(5) contrast(0.8);' : '';
            
            const sheetCount = asset.sheetCount || 9;
            const bgSize = `${sheetCount * 100}% 100%`;
            const bgPos = `${(asset.uv.u * sheetCount) / (sheetCount - 1) * 100}% 0%`;

            // Cursed Item Tint (Sickly Green/Yellow)
            if (item.isCursed) {
                tint = 'filter: sepia(1) hue-rotate(60deg) saturate(3) contrast(1.2);';
            }

            slot.innerHTML = `<div style="width:100%; height:100%; background-image:url('assets/images/${asset.file}'); background-size:${bgSize}; background-position:${bgPos}; ${tint}" onclick="useItem(${i})"></div>`;

            // Durability Label
            if (item.type === 'weapon' && item.durability !== undefined && item.durability !== Infinity) {
                slot.innerHTML += `<div class="item-durability">${item.durability}</div>`;
            }

            // Tooltip Events
            slot.onmouseenter = () => {
                tooltip.style.display = 'block';
                tooltip.innerHTML = `<strong style="color:#ffd700; font-size:13px;">${item.name}</strong><br/><span style="color:#aaa; font-size:11px;">${item.type === 'armor' ? `+${item.ap} AP (${item.slot})` : 'Item'}</span><br/><div style="margin-top:4px; color:#ddd;">${item.desc || ''}</div>`;
                const rect = slot.getBoundingClientRect();
                tooltip.style.left = (rect.right + 10) + 'px';
                tooltip.style.top = rect.top + 'px';
            };
            slot.onmouseleave = () => { tooltip.style.display = 'none'; };
        }
        invContainer.appendChild(slot);
    }

    // Update Combat Modal Inventory (Segment 2)
    let combatInvContainer = document.getElementById('combatInventory');
    if (combatInvContainer) {
        combatInvContainer.innerHTML = '';
        for (let i = 0; i < 6; i++) {
            const slot = document.createElement('div');
            // Size and border now handled by CSS .combat-inventory-grid > div
            slot.style.position = "relative";
            slot.style.cursor = "pointer";
            slot.style.transition = "background 0.2s, transform 0.1s";

            if (game.hotbar[i]) {
                const item = game.hotbar[i];
                const val = item.type === 'potion' ? item.val : item.id;
                const asset = getAssetData(item.type, val, item.suit);
                const sheetCount = asset.sheetCount || 9;
                const bgSize = `${sheetCount * 100}% 100%`;
                const bgPos = `${(asset.uv.u * sheetCount) / (sheetCount - 1) * 100}% 0%`;
                let tint = (item.type === 'armor' && isArmorBroken) ? 'filter: sepia(1) hue-rotate(-50deg) saturate(5) contrast(0.8);' : '';
                
                if (item.isCursed) {
                    tint = 'filter: sepia(1) hue-rotate(60deg) saturate(3) contrast(1.2);';
                }

                slot.innerHTML = `<div style="width:100%; height:100%; background-image:url('assets/images/${asset.file}'); background-size:${bgSize}; background-position:${bgPos}; ${tint}" onclick="useItem(${i})"></div>`;

                // Durability Label
                if (item.type === 'weapon' && item.durability !== undefined && item.durability !== Infinity) {
                    slot.innerHTML += `<div class="item-durability">${item.durability}</div>`;
                }

                // Tooltip Events
                slot.onmouseenter = () => {
                    tooltip.style.display = 'block';
                    tooltip.innerHTML = `<strong style="color:#ffd700; font-size:13px;">${item.name}</strong><br/><span style="color:#aaa; font-size:11px;">${item.type === 'armor' ? `+${item.ap} AP (${item.slot})` : 'Item'}</span><br/><div style="margin-top:4px; color:#ddd;">${item.desc || ''}</div>`;
                    const rect = slot.getBoundingClientRect();
                    tooltip.style.left = (rect.left) + 'px';
                    tooltip.style.top = (rect.top - 80) + 'px';
                    slot.style.background = "rgba(255,255,255,0.15)";
                };
                slot.onmouseleave = () => {
                    tooltip.style.display = 'none';
                    slot.style.background = "rgba(255,255,255,0.05)";
                };
            }
            combatInvContainer.appendChild(slot);
        }
    }

    // Render the Full Inventory Modal if open
    renderInventoryUI();

    // Global buttons
    document.getElementById('modalAvoidBtn').disabled = (game.lastAvoided || game.chosenCount > 0);

    // Update Trophies
    const shelf = document.getElementById('trophyShelf');
    if (shelf) {
        shelf.innerHTML = '';
        game.slainStack.forEach(c => {
            const t = document.createElement('div');
            const isRed = c.suit === '♥' || c.suit === '♦';
            t.className = `mini-trophy ${isRed ? 'red' : 'black'}`;
            t.innerHTML = `<div class="suit">${c.suit}</div><div class="val">${getDisplayVal(c.val)}</div>`;
            shelf.appendChild(t);
        });
    }

    // Call portrait update to ensure it stays snapped to the bar if it shifts
    updateMerchantPortraitPosition();
}

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

// --- ASSET HELPERS ---
function getUVForCell(cellIdx, totalCells = 9) {
    // cellIdx is 0-based index
    return { u: cellIdx / totalCells, v: 0 };
}

function getAssetData(type, value, suit, extra) {
    let file = 'block.png';
    let v = value;
    let s = suit;

    // Basic Types
    if (type === 'monster') {
        if (suit === SUITS.CLUBS) file = 'club.png';
        else if (suit === SUITS.SPADES) file = 'spade.png';
        else if (suit === SUITS.SKULLS) file = 'skull.png';
        else if (suit === SUITS.MENACES) file = 'menace.png';
        else file = 'club.png';
    }
    else if (type === 'weapon' || type === 'passive') {
        // Handle Cursed Items
        if (value === 'cursed_blade') file = 'diamond.png';
        else if (value === 'cursed_ring') file = 'items.png';
        else {
            if (game.classId === 'occultist' && type === 'weapon') file = 'occultist.png';
            else file = 'diamond.png';
        }
    }
    else if (type === 'class-icon') file = 'classes.png';
    else if (type === 'potion') file = 'heart.png';
    else if (type === 'block') file = 'block.png';
    else if (type === 'bonfire') file = 'rest_m_large.png';
    else if (type === 'gift' && extra) {
        if (extra.type === 'armor') {
            file = 'armor.png';
            v = extra.id;
        } else {
                if (extra.type === 'weapon') {
                    if (extra.id === 'cursed_blade') file = 'diamond.png';
                    else
                    file = (game.classId === 'occultist') ? 'occultist.png' : 'diamond.png';
                } else {
                    file = 'heart.png';
                }
            v = extra.val; s = extra.suit;
        }
    }
    else if (type === 'armor') {
        file = 'armor.png';
        v = value;
    }
    else if (type === 'item') {
        file = 'items.png';
        v = value;
    }

    let cellIdx = 0;
    let sheetCount = 9;
    if (file === 'items.png') sheetCount = ITEMS_SHEET_COUNT;
    if (file === 'diamond.png') sheetCount = WEAPON_SHEET_COUNT;

    if (type === 'block') {
        cellIdx = value % 9;
    } else if (type === 'bonfire') {
        cellIdx = 0; // rest_m.png
    } else if (type === 'armor' || type === 'item') {
        if (file === 'items.png') sheetCount = ITEMS_SHEET_COUNT;
        cellIdx = value; // Direct mapping 0-8
        
        // Special mapping for Cursed Ring if it's in items.png
        if (value === 'cursed_ring') {
            // If you add the ring as the 10th item (index 9)
            cellIdx = 9; 
        }
    } else if (type === 'weapon' || type === 'class-icon') {
        if (value === 'cursed_blade') {
            cellIdx = 9; // Index 9 is the 10th sprite
        }
        else if (type === 'weapon' && game.classId === 'occultist' && value > 10) {
            // Map 11->5 (J), 12->6 (Q), 13->7 (K), 14->8 (A) to match high tier spells
            // 11 - 6 = 5
            cellIdx = value - 6;
        } else {
            cellIdx = Math.max(0, value - (type === 'weapon' ? 2 : 0)); // Weapons 2-10 -> 0-8, Class 0-8 -> 0-8
        }
    } else if (type === 'gift' && extra && extra.type === 'armor') {
        cellIdx = v; // v is extra.id
    } else if (type === 'gift' && extra && extra.type === 'weapon') {
        // Handle weapon gifts (Merchant)
        if (extra.id === 'cursed_blade') {
            cellIdx = 9;
        }
        else if (game.classId === 'occultist' && v > 10) {
            cellIdx = v - 6; // Map 11->5, 12->6, etc.
        } else {
            cellIdx = Math.max(0, v - 2);
        }
    } else {
        // WEIGHTED MAPPING (Must match getMonsterName)
        if (v <= 3) cellIdx = 0;
        else if (v <= 5) cellIdx = 1;
        else if (v <= 7) cellIdx = 2;
        else if (v <= 9) cellIdx = 3;
        else if (v === 10) cellIdx = 4;
        else if (v === 11) cellIdx = 5;
        else if (v === 12) cellIdx = 6;
        else if (v === 13) cellIdx = 7;
        else if (v === 14) cellIdx = 8;
        else cellIdx = 0;
    }
    const isStrip = !file.includes('rest');
    return { file, uv: getUVForCell(cellIdx, sheetCount), isStrip, sheetCount };
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

function logMsg(m) {
    const log = document.getElementById('gameLog');
    const entry = document.createElement('div');
    entry.innerText = `> ${m}`;
    log.prepend(entry);
}

document.getElementById('newGameBtn').onclick = startDive;
document.getElementById('modalAvoidBtn').onclick = avoidRoom;
document.getElementById('exitCombatBtn').onclick = closeCombat;
document.getElementById('descendBtn').onclick = startIntermission;
document.getElementById('bonfireNotNowBtn').onclick = closeCombat;

// Toggle Inventory (Bound to Weapon Icon click in setupLayout or here)
window.toggleInventory = function() {
    const modal = document.getElementById('inventoryModal');
    if (modal.style.display === 'flex') {
        modal.style.display = 'none';
    } else {
        modal.style.display = 'flex';
        updateUI(); // Refresh contents
    }
};

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.log(`Error attempting to enable fullscreen: ${err.message}`);
        });
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
    }
}

// --- LAYOUT SETUP ---
function setupLayout() {
    console.log("Initializing Custom Layout...");
    // 1. Create Floating Control Box
    const controlBox = document.createElement('div');
    controlBox.className = 'control-box';
    document.body.appendChild(controlBox);

    // Add Fullscreen Button (Top Right Corner)
    const fsBtn = document.createElement('button');
    fsBtn.className = 'v2-btn';
    fsBtn.innerText = "⛶"; 
    fsBtn.title = "Toggle Fullscreen";
    fsBtn.onclick = toggleFullscreen;
    fsBtn.style.cssText = "position: absolute; top: 5px; right: 5px; width: 32px; height: 32px; padding: 0; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; box-shadow: none; z-index: 10;";
    controlBox.appendChild(fsBtn);

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
    const newGameBtn = document.getElementById('newGameBtn');
    const viewBtn = document.getElementById('viewToggleBtn');
    if (viewBtn) viewBtn.style.display = 'none'; // Hide initially
    const btnContainer = document.createElement('div');
    btnContainer.className = 'btn-group';
    btnContainer.style.marginTop = '10px';
    
    // Add Continue Button if save exists
    if (hasSave()) {
        const contBtn = document.createElement('button');
        contBtn.id = 'continueGameBtn';
        contBtn.className = 'v2-btn';
        contBtn.innerText = "Continue";
        contBtn.onclick = loadGame;
        btnContainer.appendChild(contBtn);
    }

    if (newGameBtn) btnContainer.appendChild(newGameBtn);
    if (viewBtn) btnContainer.appendChild(viewBtn);
    
    controlBox.appendChild(btnContainer);

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

    // 4. Create Inventory Modal
    setupInventoryUI();

    // 5. Force Resize to ensure 3D canvas fills the new full-width container
    window.dispatchEvent(new Event('resize'));
}

// --- ATTRACT MODE ---
function initAttractMode() {
    console.log("Initializing Attract Mode...");
    isAttractMode = true;
    // Hide Dock during attract mode
    const combatArea = document.querySelector('.player-combat-area');
    if (combatArea) combatArea.style.display = 'none';

    game.floor = 1;
    game.rooms = generateDungeon();
    
    // Initialize 3D engine
    init3D();
    
    // Generate floor and atmosphere
    generateFloorCA();
    updateAtmosphere(1);

    // Center player/torch for lighting
    if (use3dModel && playerMesh) playerMesh.position.set(0, 0.1, 0);
    if (!use3dModel && playerSprite) playerSprite.position.set(0, 0.75, 0);
    
    // Ensure logo is visible
    const logo = document.getElementById('gameLogo');
    if (logo) logo.style.opacity = '1';
}

function setupInventoryUI() {
    const modal = document.createElement('div');
    modal.id = 'inventoryModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="inventory-content">
            <div class="inventory-left">
                <div id="classIconDisplay" class="class-icon-display"></div>
                <div id="paperDoll" class="paper-doll" style="background-image: url('assets/images/visualnovel/${game.sex}_doll.png');">
                    <div class="equip-slot head" data-slot="head" data-slot-type="equipment" data-slot-idx="head"></div>
                    <div class="equip-slot chest" data-slot="chest" data-slot-type="equipment" data-slot-idx="chest"></div>
                    <div class="equip-slot hands" data-slot="hands" data-slot-type="equipment" data-slot-idx="hands"></div>
                    <div class="equip-slot legs" data-slot="legs" data-slot-type="equipment" data-slot-idx="legs"></div>
                    <div class="equip-slot weapon" data-slot="weapon" data-slot-type="equipment" data-slot-idx="weapon"></div>
                </div>
            </div>
            <div class="inventory-right">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #333; margin-bottom:10px;">
                    <h3 style="color:var(--gold); font-family:'Cinzel'; margin:0;">Backpack</h3>
                    <button class="v2-btn" onclick="sortInventory()" style="padding:2px 8px; font-size:0.8rem; margin-right: 12px;">Sort</button>
                </div>
                <div id="backpackGrid" class="backpack-grid"></div>
                <div id="sellSlot" class="sell-slot" ondragover="event.preventDefault()" ondrop="handleDrop(event, 'sell', 0)" data-slot-type="sell" data-slot-idx="0">
                    Drag here for Torch fuel + 1 Coin
                </div>
                
                <!-- Anvil Section -->
                <div class="anvil-section">
                    <h4 style="color:var(--gold); font-family:'Cinzel'; margin:0;">The Anvil</h4>
                    <div class="anvil-slots">
                        <div id="anvilSlot0" class="anvil-slot" data-slot-type="anvil" data-slot-idx="0" ondragover="event.preventDefault()" ondrop="handleDrop(event, 'anvil', 0)"></div>
                        <div id="anvilSlot1" class="anvil-slot" data-slot-type="anvil" data-slot-idx="1" ondragover="event.preventDefault()" ondrop="handleDrop(event, 'anvil', 1)"></div>
                    </div>
                    <button class="v2-btn" onclick="forgeItems()" style="padding: 4px 12px; font-size: 0.9rem;">Forge (Combine)</button>
                </div>
            </div>
            <div class="inventory-bottom">
                <div class="inventory-hotbar-section">
                     <h3 style="color:var(--gold); font-family:'Cinzel';">Provisioning (Hotbar)</h3>
                     <div id="modalHotbarGrid" class="hotbar-grid"></div>
                </div>
                <div id="invDescription" class="inventory-desc-section">
                    <div style="opacity:0.5; font-style:italic;">Select an item to view details...</div>
                </div>
            </div>
            <button class="v2-btn close-inv-btn" onclick="toggleInventory()" style="position:absolute; top:5px; right:5px; width:32px; height:32px; padding:0; display:flex; align-items:center; justify-content:center; font-size:1.2rem; box-shadow:none; z-index:10;">✕</button>
        </div>
    `;
    document.body.appendChild(modal);
}

window.forgeItems = function() {
    const i1 = game.anvil[0];
    const i2 = game.anvil[1];

    if (!i1 || !i2) {
        spawnFloatingText("Need 2 items!", window.innerWidth/2, window.innerHeight/2, '#ff0000');
        return;
    }
    if (i1.type !== i2.type) {
        spawnFloatingText("Types must match!", window.innerWidth/2, window.innerHeight/2, '#ff0000');
        return;
    }
    if (i1.type !== 'weapon' && i1.type !== 'potion') {
        spawnFloatingText("Only Weapons/Potions!", window.innerWidth/2, window.innerHeight/2, '#ff0000');
        return;
    }

    // Logic: New Val = v1 + v2 - 1 (Capped at 16)
    const newVal = Math.min(16, i1.val + i2.val - 1);
    
    // Randomly consume one
    const survivorIdx = Math.random() < 0.5 ? 0 : 1;
    const survivor = survivorIdx === 0 ? i1 : i2;
    
    survivor.val = newVal;
    if (survivor.type === 'weapon') {
        survivor.name = survivor.name.split(' (')[0] + ` (${newVal})`; // Update name val
        survivor.durability = Infinity; // Reset durability
    } else {
        survivor.name = survivor.name.split(' (')[0] + ` (${newVal})`;
    }

    game.anvil = [survivor, null]; // Keep survivor in slot 0
    spawnFloatingText("Forged!", window.innerWidth/2, window.innerHeight/2, '#00ff00');
    updateUI();
};

window.sortInventory = function() {
    // Sort logic: Type Priority (Weapon > Armor > Potion > Item) -> Value (High to Low)
    const typePriority = { 'weapon': 1, 'armor': 2, 'potion': 3, 'item': 4 };
    
    game.backpack.sort((a, b) => {
        if (!a && !b) return 0;
        if (!a) return 1; // nulls last
        if (!b) return -1;
        
        const typeA = typePriority[a.type] || 5;
        const typeB = typePriority[b.type] || 5;
        
        if (typeA !== typeB) return typeA - typeB;
        return b.val - a.val; // Descending value
    });
    
    updateUI();
};

function renderInventoryUI() {
    const modal = document.getElementById('inventoryModal');
    if (!modal || modal.style.display === 'none') return;

    // Update Doll Image (in case sex changed)
    const doll = document.getElementById('paperDoll');
    if (doll) doll.style.backgroundImage = `url('assets/images/visualnovel/${game.sex}_doll.png')`;

    // Update Class Icon
    const classIcon = document.getElementById('classIconDisplay');
    const cData = CLASS_DATA[game.classId];
    if (classIcon && cData && cData.icon) {
        const asset = getAssetData(cData.icon.type, cData.icon.val, null);
        const sheetCount = asset.sheetCount || 9;
        classIcon.style.backgroundImage = `url('assets/images/${asset.file}')`;
        classIcon.style.backgroundSize = `${sheetCount * 100}% 100%`;
        classIcon.style.backgroundPosition = `${(asset.uv.u * sheetCount) / (sheetCount - 1) * 100}% 0%`;
        classIcon.title = cData.name;
    }

    // Helper to create draggable item
    const createItemEl = (item, source, idx) => {
        if (!item) return null;
        const div = document.createElement('div');
        div.className = 'inv-item-drag';
        div.style.width = '100%'; div.style.height = '100%';
        const asset = getAssetData(item.type, item.val || item.id, item.suit);
        const sheetCount = asset.sheetCount || 9;
        div.style.backgroundImage = `url('assets/images/${asset.file}')`;
        div.style.backgroundSize = `${sheetCount * 100}% 100%`;
        div.style.backgroundPosition = `${(asset.uv.u * sheetCount) / (sheetCount - 1) * 100}% 0%`;
        
        if (item.type === 'weapon' && item.durability !== undefined && item.durability !== Infinity) {
            div.innerHTML = `<div class="item-durability">${item.durability}</div>`;
        }

        div.draggable = true;
        div.ondragstart = (e) => {
            e.dataTransfer.setData('text/plain', JSON.stringify({ source, idx }));
        };
        
        // Touch Drag Support
        div.ontouchstart = (e) => {
            if (e.touches.length > 1) return;
            const touch = e.touches[0];
            touchDragData = { source, idx };
            
            touchDragGhost = div.cloneNode(true);
            touchDragGhost.style.position = 'fixed';
            touchDragGhost.style.zIndex = '10000';
            touchDragGhost.style.opacity = '0.8';
            touchDragGhost.style.pointerEvents = 'none';
            touchDragGhost.style.width = div.getBoundingClientRect().width + 'px';
            touchDragGhost.style.height = div.getBoundingClientRect().height + 'px';
            touchDragGhost.style.left = (touch.clientX - touchDragGhost.offsetWidth / 2) + 'px';
            touchDragGhost.style.top = (touch.clientY - touchDragGhost.offsetHeight / 2) + 'px';
            document.body.appendChild(touchDragGhost);
        };

        div.onclick = (e) => {
            e.stopPropagation();
            updateItemDescription(item);
        };
        return div;
    };

    // Render Equipment
    ['head', 'chest', 'hands', 'legs', 'weapon'].forEach(slot => {
        const el = doll.querySelector(`.${slot}`);
        el.innerHTML = '';
        el.ondragover = (e) => e.preventDefault();
        el.ondrop = (e) => handleDrop(e, 'equipment', slot);
        
        const item = game.equipment[slot];
        if (item) {
            el.appendChild(createItemEl(item, 'equipment', slot));
        }
    });

    // Render Backpack
    const bpGrid = document.getElementById('backpackGrid');
    bpGrid.innerHTML = '';
    game.backpack.forEach((item, idx) => {
        const div = document.createElement('div');
        div.className = 'inv-slot';
        div.ondragover = (e) => e.preventDefault();
        div.ondrop = (e) => handleDrop(e, 'backpack', idx);
        div.dataset.slotType = 'backpack';
        div.dataset.slotIdx = idx;
        if (item) {
            div.appendChild(createItemEl(item, 'backpack', idx));
        }
        bpGrid.appendChild(div);
    });

    // Render Hotbar
    const hbGrid = document.getElementById('modalHotbarGrid');
    hbGrid.innerHTML = '';
    game.hotbar.forEach((item, idx) => {
        const div = document.createElement('div');
        div.className = 'inv-slot';
        div.style.width = '64px';
        div.ondragover = (e) => e.preventDefault();
        div.ondrop = (e) => handleDrop(e, 'hotbar', idx);
        div.dataset.slotType = 'hotbar';
        div.dataset.slotIdx = idx;
        if (item) {
            div.appendChild(createItemEl(item, 'hotbar', idx));
        }
        hbGrid.appendChild(div);
    });

    // Render Anvil
    [0, 1].forEach(idx => {
        const el = document.getElementById(`anvilSlot${idx}`);
        if (el) {
            el.innerHTML = '';
            const item = game.anvil[idx];
            if (item) el.appendChild(createItemEl(item, 'anvil', idx));
        }
    });
}

function updateItemDescription(item) {
    const container = document.getElementById('invDescription');
    if (!container || !item) return;

    let desc = item.desc;
    if (!desc) {
        // Generate generic description if missing
        if (item.type === 'weapon') desc = `Deals ${item.val} damage.`;
        else if (item.type === 'potion') desc = `Restores up to ${item.val} Health.`;
        else desc = "No details available.";
    }

    container.innerHTML = `
        <div class="desc-title">${item.name}</div>
        <div>${desc}</div>
        <div style="margin-top:5px; font-size:0.8rem; color:#888;">Type: ${item.type.toUpperCase()} | Value: ${item.val || '-'}</div>
    `;
}

window.handleDrop = handleDrop; // Expose to window for HTML attribute access
function handleDrop(e, targetType, targetIdx) {
    e.preventDefault();
    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
    const srcType = data.source;
    const srcIdx = data.idx;

    // Get Source Item
    let item;
    if (srcType === 'equipment') item = game.equipment[srcIdx];
    else if (srcType === 'backpack') item = game.backpack[srcIdx];
    else if (srcType === 'hotbar') item = game.hotbar[srcIdx];
    else if (srcType === 'anvil') item = game.anvil[srcIdx];

    if (!item) return;

    // Handle Selling
    if (targetType === 'sell') {
        if (srcType === 'equipment') game.equipment[srcIdx] = null;
        else if (srcType === 'backpack') game.backpack[srcIdx] = null;
        else if (srcType === 'hotbar') game.hotbar[srcIdx] = null;
        else if (srcType === 'anvil') game.anvil[srcIdx] = null;
        
        // Add Torch Fuel + Coin
        game.soulCoins++;
        
        let fuelAmount = (item.val || 5);
        // Special case: Spectral Lantern (ID 1) gives massive fuel
        if (item.id === 1) {
            fuelAmount = 150;
            logMsg("The Spectral Lantern shatters, releasing its eternal flame!");
        }
        game.torchCharge += fuelAmount;
        spawnFloatingText(`+${fuelAmount} Fuel`, e.clientX, e.clientY - 30, '#ffaa00');
        spawnFloatingText("+1 Soul Coin", e.clientX, e.clientY, '#d4af37');
        
        if (item.type === 'armor') recalcAP();
        updateUI();
        return;
    }

    // Validation: Equipment Slots
    if (targetType === 'equipment') {
        if (targetIdx === 'weapon' && item.type !== 'weapon') {
            spawnFloatingText("Only weapons go here!", e.clientX, e.clientY, '#ff0000');
            return;
        }
        // Occultist Restriction: Cannot equip physical weapons > 5
        if (targetIdx === 'weapon' && game.classId === 'occultist' && !item.isSpell && item.val > 5) {
            spawnFloatingText("Occultists can't use complex weapons!", e.clientX, e.clientY, '#ff0000');
            return;
        }

        if (targetIdx !== 'weapon' && (item.type !== 'armor' || item.slot !== targetIdx)) {
            spawnFloatingText(`Only ${targetIdx} armor!`, e.clientX, e.clientY, '#ff0000');
            return;
        }
    }

    // Get Target Item (Swap)
    let targetItem;
    if (targetType === 'equipment') targetItem = game.equipment[targetIdx];
    else if (targetType === 'backpack') targetItem = game.backpack[targetIdx];
    else if (targetType === 'hotbar') targetItem = game.hotbar[targetIdx];
    else if (targetType === 'anvil') targetItem = game.anvil[targetIdx];

    // Perform Swap
    // 1. Remove from Source
    if (srcType === 'equipment') game.equipment[srcIdx] = null;
    else if (srcType === 'backpack') game.backpack[srcIdx] = null;
    else if (srcType === 'hotbar') game.hotbar[srcIdx] = null;
    else if (srcType === 'anvil') game.anvil[srcIdx] = null;

    // 2. Place Source Item in Target
    if (targetType === 'equipment') game.equipment[targetIdx] = item;
    else if (targetType === 'backpack') game.backpack[targetIdx] = item;
    else if (targetType === 'hotbar') game.hotbar[targetIdx] = item;
    else if (targetType === 'anvil') game.anvil[targetIdx] = item;

    // 3. Place Target Item (if any) in Source
    if (targetItem) {
        // Validate reverse swap for equipment
        if (srcType === 'equipment') {
             if (srcIdx === 'weapon' && targetItem.type !== 'weapon') {
                 // Can't swap non-weapon into weapon slot, undo
                 // (Simplified: just put item back and fail)
                 // For now, assume valid swap or overwrite
             }
             game.equipment[srcIdx] = targetItem;
        }
        else if (srcType === 'backpack') game.backpack[srcIdx] = targetItem;
        else if (srcType === 'hotbar') game.hotbar[srcIdx] = targetItem;
        else if (srcType === 'anvil') game.anvil[srcIdx] = targetItem;
    }

    // If active weapon changed, update global durability state
    if (game.equipment.weapon) {
        game.weaponDurability = (game.equipment.weapon.durability !== undefined) ? game.equipment.weapon.durability : Infinity;
    } else {
        game.weaponDurability = Infinity;
    }
    // Note: We don't reset slainStack here to avoid punishing swaps, but visually the trophies might mismatch.

    recalcAP();
    updateUI();
}

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
    const logo = document.getElementById('gameLogo');
    if (logo) logo.style.opacity = '0';
    const combatArea = document.querySelector('.player-combat-area');
    if (combatArea) combatArea.style.display = 'flex';

    // Update Control Box Buttons
    const viewBtn = document.getElementById('viewToggleBtn');
    if (viewBtn) viewBtn.style.display = 'inline-block';
    const contBtn = document.getElementById('continueGameBtn');
    if (contBtn) contBtn.style.display = 'none';

    // Re-Initialize 3D
    clear3DScene();
    init3D();
    preloadFXTextures();
    preloadSounds();
    
    // Re-Generate Floor Visuals (using loaded room data)
    // Note: generateFloorCA uses game.rooms, which we just loaded
    generateFloorCA();
    updateAtmosphere(game.floor);

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
    audio.startLoop('bgm', 'bgm_dungeon', { volume: 0.4, isMusic: true });

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

window.nextStoryStep = function() {
    // If we just showed the true ending, finish
    if (isEnding && isTrueEnding && currentStoryStep >= storyData.ending_panels.length) {
        endStory();
        return;
    }
    currentStoryStep++;
    updateStoryPanel();
};

window.endStory = function() {
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
    for(let y=0; y<size; y++) {
        const row = [];
        for(let x=0; x<size; x++) row.push(0); 
        grid.push(row);
    }

    // --- LOGIC PUZZLE GENERATOR (Guaranteed Solvable) ---
    const edges = [];
    for(let i=0; i<size; i++) {
        edges.push({x: i, y: -1, dir: {x:0, y:1}}); // Top
        edges.push({x: i, y: size, dir: {x:0, y:-1}}); // Bottom
        edges.push({x: -1, y: i, dir: {x:1, y:0}}); // Left
        edges.push({x: size, y: i, dir: {x:-1, y:0}}); // Right
    }
    
    const start = edges[Math.floor(Math.random() * edges.length)];
    let curr = { x: start.x + start.dir.x, y: start.y + start.dir.y };
    let dir = { ...start.dir };
    
    const pathCells = new Set();
    let end = null;
    let steps = 0;

    // Walk a path
    while(steps < 30) {
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
            x: start.x + start.dir.x * (size+1), 
            y: start.y + start.dir.y * (size+1),
            dir: { x: -start.dir.x, y: -start.dir.y }
        };
    }

    // Place Walls
    for(let y=0; y<size; y++) {
        for(let x=0; x<size; x++) {
            if (!pathCells.has(`${x},${y}`) && Math.random() < 0.25) grid[y][x] = 1;
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
    
    for(let y=0; y<size; y++) {
        for(let x=0; x<size; x++) {
            // Draw Background
            if (blockTex && blockTex.complete) {
                ctx.drawImage(blockTex, bgTileX, 0, 128, 128, x*cellSize, y*cellSize, cellSize, cellSize);
            } else {
                ctx.fillStyle = '#222';
                ctx.fillRect(x*cellSize, y*cellSize, cellSize, cellSize);
                ctx.strokeStyle = '#444';
                ctx.strokeRect(x*cellSize, y*cellSize, cellSize, cellSize);
            }

            const cell = grid[y][x];
            const cx = x*cellSize + cellSize/2;
            const cy = y*cellSize + cellSize/2;

            if (cell === 1) { // Wall
                if (blockTex && blockTex.complete) ctx.drawImage(blockTex, wallTileX, 0, 128, 128, x*cellSize, y*cellSize, cellSize, cellSize);
                else { ctx.fillStyle = '#555'; ctx.fillRect(x*cellSize+4, y*cellSize+4, cellSize-8, cellSize-8); }
            } else if (cell === 2) { // Mirror /
                ctx.strokeStyle = '#00ffff';
                ctx.lineWidth = 4;
                ctx.beginPath(); ctx.moveTo(x*cellSize+10, y*cellSize+cellSize-10); ctx.lineTo(x*cellSize+cellSize-10, y*cellSize+10); ctx.stroke();
            } else if (cell === 3) { // Mirror \
                ctx.strokeStyle = '#00ffff';
                ctx.lineWidth = 4;
                ctx.beginPath(); ctx.moveTo(x*cellSize+10, y*cellSize+10); ctx.lineTo(x*cellSize+cellSize-10, y*cellSize+cellSize-10); ctx.stroke();
            }
        }
    }

    // Draw Emitter/Receiver
    // Draw Emitter/Receiver (On top of beam)
    const drawPort = (pt, spriteIdx, color) => {
        const gx = pt.x + pt.dir.x; const gy = pt.y + pt.dir.y; // Draw in adjacent valid cell
        const px = gx * cellSize; const py = gy * cellSize;
        if (itemsTex && itemsTex.complete) ctx.drawImage(itemsTex, spriteIdx * 128, 0, 128, 128, px, py, cellSize, cellSize);
        else { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px + cellSize/2, py + cellSize/2, cellSize/3, 0, Math.PI*2); ctx.fill(); }
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
    let path = [{x: (start.x+0.5)*cellSize, y: (start.y+0.5)*cellSize}];
    
    const beamTex = loadFXImage('trace_01.png');

    // Calculate Receiver Tile (Inside Grid)
    const rx = end.x + end.dir.x;
    const ry = end.y + end.dir.y;

    let steps = 0;
    let won = false;

    while(steps < 100) {
        // Check Win (Hit Receiver Tile)
        if (curr.x === rx && curr.y === ry) {
            won = true;
            path.push({x: (curr.x+0.5)*cellSize, y: (curr.y+0.5)*cellSize});
            break;
        }
        if (curr.x < 0 || curr.x >= size || curr.y < 0 || curr.y >= size) {
            path.push({x: (curr.x+0.5)*cellSize, y: (curr.y+0.5)*cellSize}); // Off screen
            break;
        }

        path.push({x: (curr.x+0.5)*cellSize, y: (curr.y+0.5)*cellSize});

        const cell = grid[curr.y][curr.x];
        if (cell === 1) break; // Hit wall
        if (cell === 2) { // / Mirror
            // (1,0) -> (0,-1) | (-1,0) -> (0,1) | (0,1) -> (-1,0) | (0,-1) -> (1,0)
            const oldDir = {...dir};
            dir.x = -oldDir.y;
            dir.y = -oldDir.x;
        } else if (cell === 3) { // \ Mirror
            const oldDir = {...dir};
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
    for(let i=1; i<path.length; i++) ctx.lineTo(path[i].x, path[i].y);
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

window.cancelLockpick = function() {
    document.getElementById('lockpickUI').style.display = 'none';
    closeCombat(); // Reset state
};

window.blastLock = function() {
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

// --- DEBUG CONSOLE COMMANDS ---
window.setgame = function(mode, arg) {
    console.log(`Debug Command: ${mode}`, arg || '');
    switch(mode.toLowerCase()) {
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
        default:
            console.log("Commands: finalboss, boss, merchant, bonfire, showhidden, godmode, floor [n], lockpick, trap");
    }
};

window.use3dmodels = function(bool) {
    use3dModel = bool;
    console.log(`3D Models: ${use3dModel}`);
    // Reload scene to apply
    const currentRoom = game.rooms.find(r => r.id === game.currentRoomIdx);
    clear3DScene();
    init3D();
    generateFloorCA();
    updateAtmosphere(game.floor);
    
    // Restore position
    if (currentRoom) {
        if (use3dModel && playerMesh) playerMesh.position.set(currentRoom.gx, 0.1, currentRoom.gy);
        else if (playerSprite) playerSprite.position.set(currentRoom.gx, 0.75, currentRoom.gy);
    }
}
window.show3dmodels = window.use3dmodels; // Alias

window.setAnimSpeed = function(speed) {
    globalAnimSpeed = speed;
    console.log(`Animation Speed: ${globalAnimSpeed}`);
};

// --- MAP EDITOR ---
window.editmap = function(bool) {
    isEditMode = bool;
    console.log(`Edit Mode: ${isEditMode}`);
    
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
                
                ${row('Pos X', 'edPosX', -5, 5, 0.05, 0)}
                ${row('Pos Y', 'edPosY', -5, 5, 0.05, 0)}
                ${row('Pos Z', 'edPosZ', -5, 5, 0.05, 0)}
                
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
            selectedMesh.traverse(c => { if(c.isMesh && c.material.emissive) c.material.emissive.setHex(0x000000); });
            selectedMesh = null;
        }
        controls.minZoom = 0.5; // Reset zoom
    }
};

window.resetField = function(id, def) {
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
        while(obj.parent && obj.parent !== scene && !obj.userData.roomId) {
            // Check if this is a loaded GLB root (usually a Group)
            if (obj.type === 'Group' || obj.type === 'Scene') break; 
            obj = obj.parent;
        }
        
        // If we found a GLB inside a room mesh
        if (obj && obj.parent && obj.parent.userData && obj.parent.userData.roomId !== undefined) {
            selectEditorMesh(obj);
            break;
        }
    }
}

function selectEditorMesh(mesh) {
    if (selectedMesh) {
        // Reset old highlight
        selectedMesh.traverse(c => { if(c.isMesh && c.material.emissive) c.material.emissive.setHex(0x000000); });
    }
    selectedMesh = mesh;
    // Highlight new
    selectedMesh.traverse(c => { if(c.isMesh && c.material.emissive) c.material.emissive.setHex(0x00ffff); });
    
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

window.saveRoomConfig = function() {
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
    const blob = new Blob([JSON.stringify(roomConfig, null, 2)], {type : 'application/json'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'room_config.json';
    link.click();
};

async function loadRoomConfig() {
    try {
        const res = await fetch('assets/data/room_config.json');
        if (res.ok) {
            roomConfig = await res.json();
            console.log("Loaded Room Config", roomConfig);
        }
    } catch (e) {
        console.log("No room config found, using defaults.");
    }
}

// --- GLOBAL TOUCH HANDLERS (For Inventory Drag) ---
window.addEventListener('touchmove', (e) => {
    if (touchDragGhost) {
        e.preventDefault();
        touchDragMoved = true;
        const touch = e.touches[0];
        touchDragGhost.style.left = (touch.clientX - touchDragGhost.offsetWidth / 2) + 'px';
        touchDragGhost.style.top = (touch.clientY - touchDragGhost.offsetHeight / 2) + 'px';
    }
}, { passive: false });

window.addEventListener('touchend', (e) => {
    if (!touchDragGhost) return;
    const touch = e.changedTouches[0];
    
    // Hide ghost momentarily to find element below it
    touchDragGhost.style.display = 'none';
    const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);
    
    document.body.removeChild(touchDragGhost);
    touchDragGhost = null;
    
    if (elemBelow && touchDragMoved) {
        const slot = elemBelow.closest('[data-slot-type]');
        if (slot) {
            const targetType = slot.dataset.slotType;
            let targetIdx = slot.dataset.slotIdx;
            
            // Convert index to number for arrays
            if (targetType === 'backpack' || targetType === 'hotbar' || targetType === 'anvil') targetIdx = parseInt(targetIdx);
            
            // Mock event for handleDrop
            const mockEvent = {
                preventDefault: () => {},
                clientX: touch.clientX, clientY: touch.clientY,
                dataTransfer: { getData: () => JSON.stringify(touchDragData) }
            };
            handleDrop(mockEvent, targetType, targetIdx);
        }
    }
    touchDragData = null;
    touchDragMoved = false;
});

// Initialize Layout
loadRoomConfig(); // Load transforms before layout
setupLayout();
initAttractMode();
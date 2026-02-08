// <script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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

    // Encounter State
    activeRoom: null,
    chosenCount: 0,
    combatCards: [],
    slainStack: [],
    carryCard: null // THE global carry-over card
};

const SUITS = { HEARTS: '♥', DIAMONDS: '♦', CLUBS: '♣', SPADES: '♠' };

// --- PROC-GEN DUNGEON (Grid Based) ---
function generateDungeon() {
    const numRooms = 12;
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
    const merchantCount = 1 + Math.floor(Math.random() * 3); // 1, 2, or 3
    for (let i = 0; i < merchantCount; i++) {
        if (potentialSpecials.length > 0) {
            const m = potentialSpecials.pop();
            m.isSpecial = true;
            m.generatedContent = null; // Will store the fixed items
        }
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
let roomMeshes = new Map();
let terrainMeshes = new Map();
let waypointMeshes = new Map();
let corridorMeshes = new Map();
let doorMeshes = new Map();
let is3DView = true;
let playerSprite;
let walkAnims = {
    m: { up: null, down: null },
    f: { up: null, down: null }
};
const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();

function loadTexture(path) {
    if (!textureCache.has(path)) {
        textureCache.set(path, textureLoader.load(path));
    }
    return textureCache.get(path);
}

// FX State
const fxCanvas = document.getElementById('fxCanvas');
const fxCtx = fxCanvas.getContext('2d');
let particles = [];
let screenShake = { intensity: 0, duration: 0 };

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

    particles = particles.filter(p => p.life > 0);
    particles.forEach(p => {
        p.update();
        p.draw(fxCtx);
    });

    // Ambient Wisps
    updateWisps(fxCtx);
}

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

function resizeFXCanvas() {
    fxCanvas.width = window.innerWidth;
    fxCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeFXCanvas);
resizeFXCanvas();

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
    scene.add(new THREE.AmbientLight(0xffffff, 0.15));
    // Initial Torch
    torchLight = new THREE.PointLight(0xffaa44, 300, 40);
    torchLight.castShadow = true;
    scene.add(torchLight);

    // Fog of War
    scene.fog = new THREE.FogExp2(0x000000, 0.05);
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

    // Player Marker (Floating Diamond)
    const markerGeo = new THREE.OctahedronGeometry(0.3, 0);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.8 });
    playerMarker = new THREE.Mesh(markerGeo, markerMat);
    scene.add(playerMarker);

    animate3D();
    window.addEventListener('click', on3DClick);
}

function on3DClick(event) {
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
        }
    }
}

function update3DScene() {
    if (!scene) return;
    const currentRoom = game.rooms.find(room => room.id === game.currentRoomIdx);

    if (playerSprite && torchLight) {
        let vRad = 2.5;
        if (game.weapon) {
            if (game.weapon.val >= 8) {
                torchLight.color.setHex(0x00ccff); torchLight.intensity = (is3DView ? 800 : 2000);
                torchLight.distance = 60; vRad = 8.0;
            } else if (game.weapon.val >= 6) {
                torchLight.color.setHex(0xd4af37); torchLight.intensity = (is3DView ? 600 : 1500);
                torchLight.distance = 45; vRad = 5.0;
            } else {
                torchLight.color.setHex(0xffaa44); torchLight.intensity = (is3DView ? 400 : 1200);
                torchLight.distance = 35; vRad = 3.5;
            }
        } else {
            torchLight.color.setHex(0xffaa44); torchLight.intensity = (is3DView ? 300 : 1000);
            torchLight.distance = 25; vRad = 2.5;
        }
        torchLight.position.set(playerSprite.position.x, 2.5, playerSprite.position.z);

        game.rooms.forEach(r => {
            const dist = Math.sqrt(Math.pow(r.gx - playerSprite.position.x, 2) + Math.pow(r.gy - playerSprite.position.z, 2));
            const isVisible = dist < vRad;
            if (isVisible) r.isRevealed = true;

            if (r.isRevealed) {
                if (r.isWaypoint) {
                    if (!waypointMeshes.has(r.id)) {
                        const geo = new THREE.SphereGeometry(0.2, 16, 16);
                        const mat = new THREE.MeshStandardMaterial({ color: 0x555555, emissive: 0x222222 });
                        const mesh = new THREE.Mesh(geo, mat);
                        mesh.position.set(r.gx, 0.1, r.gy);
                        mesh.userData = { roomId: r.id };
                        scene.add(mesh);
                        waypointMeshes.set(r.id, mesh);
                    }
                    const mesh = waypointMeshes.get(r.id);
                    mesh.visible = true;
                    const isAdj = currentRoom && (currentRoom.id === r.id || currentRoom.connections.includes(r.id));
                    mesh.material.emissive.setHex(isAdj ? 0xd4af37 : 0x222222);
                } else {
                    if (!roomMeshes.has(r.id)) {
                        const rw = r.w; const rh = r.h;
                        const rDepth = 3.0 + Math.random() * 3.0;
                        r.rDepth = rDepth;

                        let geo;
                        if (r.isFinal) {
                            // Tower/Deep Pit
                            geo = new THREE.BoxGeometry(rw, 20, rh);
                        } else if (r.isBonfire) {
                            // Circular Campfire Ring 
                            // Use a Cylinder. radius ~ min(w,h)/2.
                            const rad = Math.min(rw, rh) * 0.4;
                            geo = new THREE.CylinderGeometry(rad, rad, rDepth, 16);
                        } else if (r.isSpecial && !r.isFinal) { // Merchant/Special
                            // Octagonal Room
                            const rad = Math.min(rw, rh) * 0.45;
                            geo = new THREE.CylinderGeometry(rad, rad, rDepth, 8);
                        } else {
                            // Standard Box
                            geo = new THREE.BoxGeometry(rw, rDepth, rh);
                        }

                        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
                        const mesh = new THREE.Mesh(geo, mat);

                        if (r.isFinal) {
                            // Extend downwards
                            mesh.position.set(r.gx, -5, r.gy);
                        } else {
                            mesh.position.set(r.gx, rDepth / 2, r.gy);
                        }

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
                        }

                        mesh.receiveShadow = true;
                        mesh.userData = { roomId: r.id };
                        if (r.isFinal) applyTextureToMesh(mesh, 'block', 7);
                        else if (r.isSpecial) applyTextureToMesh(mesh, 'block', 1);
                        else applyTextureToMesh(mesh, 'block', 0);
                        scene.add(mesh);
                        roomMeshes.set(r.id, mesh);
                        addDoorsToRoom(r, mesh);
                        addLocalFog(mesh.position.x, mesh.position.z);
                    }
                    const mesh = roomMeshes.get(r.id);
                    mesh.visible = true;
                    // Visual Priority: Cleared (Holy Glow) > Special > Base
                    let eCol = 0x000000;
                    let eInt = (isVisible ? 1.0 : 0.2);

                    if (r.state === 'cleared' && !r.isWaypoint) {
                        eCol = 0xaaaaaa; // Holy Glow
                        mesh.material.color.setHex(0xffffff); // White Tint
                        eInt = (isVisible ? 0.8 : 0.4);
                        if (r.isFinal) {
                            eCol = 0x440000; // Bright Red Glow
                            mesh.material.color.setHex(0xffaaaa);
                            eInt = 1.0;
                        }
                    } else {
                        mesh.material.color.setHex(0x444444); // Reset to dark
                        if (r.isFinal) { eCol = 0xff0000; eInt = (isVisible ? 2.5 : 0.5); }
                        else if (r.isBonfire) { eCol = 0xff8800; eInt = (isVisible ? 2.5 : 0.5); }
                        else if (r.isSpecial) { eCol = 0x8800ff; eInt = (isVisible ? 1.5 : 0.3); }
                    }

                    mesh.material.emissive.setHex(eCol);
                    mesh.material.emissiveIntensity = eInt;
                }
            }

            r.connections.forEach(cid => {
                const target = game.rooms.find(rm => rm.id === cid);
                if (!target) return;
                const corridorId = `cor_${r.id}_${cid}`;
                const mesh = corridorMeshes.get(corridorId) || corridorMeshes.get(`cor_${cid}_${r.id}`);
                if (!mesh) {
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
                    const distToMid = Math.sqrt(Math.pow(midX - playerSprite.position.x, 2) + Math.pow(midZ - playerSprite.position.z, 2));
                    const isDir = distToMid < vRad;
                    if (isDir) { r.correveals = r.correveals || {}; r.correveals[corridorId] = true; }
                    mesh.visible = (r.correveals && r.correveals[corridorId]);
                    if (mesh.visible) mesh.material.emissiveIntensity = (isDir ? 0.3 : 0.05);
                }
            });
        });

        if (currentRoom) {
            const targetPos = new THREE.Vector3(currentRoom.gx, 0, currentRoom.gy);
            controls.target.lerp(targetPos, 0.05);
        }
    }
}

function animate3D() {
    requestAnimationFrame(animate3D);
    update3DScene();
    updateFX();

    // Animate Player Marker
    if (playerMarker && playerSprite) {
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

            playerMarker.position.set(playerSprite.position.x, markerHeight, playerSprite.position.z);
            playerMarker.rotation.y += 0.02;
        }
    }

    controls.update();
    renderer.render(scene, camera);
    if (window.TWEEN) TWEEN.update();
    animatePlayerSprite();
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
    playerSprite.material.map = (r2.gy > r1.gy) ? walkAnims[game.sex].up : walkAnims[game.sex].down;
    new TWEEN.Tween(playerSprite.position).to({ x: r2.gx, z: r2.gy }, 600).easing(TWEEN.Easing.Quadratic.Out).start();
}

function addDoorsToRoom(room, mesh) {
    const tex = loadTexture('assets/images/door.png');
    room.connections.forEach(cid => {
        const target = game.rooms.find(rm => rm.id === cid);
        if (!target) return;
        const dx = target.gx - room.gx; const dy = target.gy - room.gy;
        const door = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), new THREE.MeshStandardMaterial({ map: tex, transparent: true, side: THREE.FrontSide }));
        const rw = room.w / 2; const rh = room.h / 2; const margin = 0.05;
        if (Math.abs(dx) > Math.abs(dy)) {
            door.position.set(dx > 0 ? rw + margin : -rw - margin, -(room.rDepth / 2) + 1, 0);
            door.rotation.y = dx > 0 ? Math.PI / 2 : -Math.PI / 2;
        } else {
            door.position.set(0, -(room.rDepth / 2) + 1, dy > 0 ? rh + margin : -rh - margin);
            door.rotation.y = dy > 0 ? 0 : Math.PI;
        }
        mesh.add(door);
    });
    updateRoomVisuals();
}

function updateRoomVisuals() {
    // Update Room Visuals (Tinting)
    game.rooms.forEach(r => {
        if (!r.mesh) return;

        // Reset to default (dark)
        r.mesh.material.emissive.setHex(0x000000);
        r.mesh.material.color.setHex(0x444444); // Default Dark Grey

        if (r.state === 'cleared' && !r.isWaypoint) {
            // Holy Glow for cleared rooms
            r.mesh.material.emissive.setHex(0x222222); // Light emission
            r.mesh.material.color.setHex(0xaaaaaa); // Lighten base color

            if (r.isFinal) {
                r.mesh.material.color.setHex(0xffaaaa); // Pale Red
                r.mesh.material.emissive.setHex(0x440000);
            }
        } else if (r.isFinal) {
            // Uncleared Final Room (Dark Red)
            r.mesh.material.color.setHex(0x880000);
        }
    });
}

function addLocalFog(x, z) {
    const smoke = loadTexture('assets/images/textures/smoke_01.png');
    for (let i = 0; i < 3; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smoke, transparent: true, opacity: 0.2, color: 0x444444 }));
        s.raycast = () => { };
        const sz = 4 + Math.random() * 4;
        s.scale.set(sz, sz, 1);
        s.position.set(x + (Math.random() - 0.5) * 4, 1 + Math.random() * 2, z + (Math.random() - 0.5) * 4);
        scene.add(s);
    }
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
const THEMES = [
    { id: 1, name: 'Dirt', tile: 1, color: 0x3d2817 },    // Brown
    { id: 2, name: 'Stone', tile: 2, color: 0x222222 },   // Grey
    { id: 3, name: 'Moss', tile: 3, color: 0x173d1a },    // Green
    { id: 4, name: 'Ancient', tile: 4, color: 0x3d173d }, // Purple
    { id: 5, name: 'Magma', tile: 5, color: 0x3d1717 },   // Red
    { id: 6, name: 'Ice', tile: 6, color: 0x173d3d },     // Cyan/Teal
    { id: 7, name: 'Abyss', tile: 7, color: 0x050505 },   // Near Black
    { id: 8, name: 'Bone', tile: 8, color: 0x3d3517 },    // Yellow/Bone
    { id: 9, name: 'Ruins', tile: 9, color: 0x282222 },   // Dusty
];

function getThemeForFloor(floor) {
    // map floor 1 -> index 0 (theme 1)
    // wrap around 1-9
    const idx = (floor - 1) % 9;
    return THEMES[idx];
}

function updateAtmosphere(floor) {
    const theme = getThemeForFloor(floor);
    const dimColor = new THREE.Color(theme.color).multiplyScalar(0.5);
    scene.background = dimColor;
    scene.fog = new THREE.FogExp2(dimColor, 0.05);

    // Update lights to match mood?
    // Maybe tint the ambient light slightly
    const amb = scene.children.find(c => c.isAmbientLight);
    if (amb) amb.color.setHex(theme.color).lerp(new THREE.Color(0xffffff), 0.1).multiplyScalar(0.6);
}

function generateFloorCA() {
    const theme = getThemeForFloor(game.floor);
    const bounds = 12; // Expanded from 8 to 12 to catch edge rooms
    const size = bounds * 2 + 1;
    let grid = {}; // Use Object map for negative keys supportise, but ensure room positions are alive
    for (let x = -bounds; x <= bounds; x++) {
        grid[x] = {};
        for (let z = -bounds; z <= bounds; z++) {
            let alive = Math.random() < 0.45;

            // Check rooms: if (x,z) is inside/near a room, force alive
            const nearRoom = game.rooms.some(r => {
                return x >= r.gx - r.w / 2 - 1 && x <= r.gx + r.w / 2 + 1 &&
                    z >= r.gy - r.h / 2 - 1 && z <= r.gy + r.h / 2 + 1;
            });

            // Check corridors roughly
            const nearCorr = Array.from(corridorMeshes.values()).some(m => {
                const p = m.position;
                // Simple distance check since corridors are rotated lines
                return Math.abs(x - p.x) < 2 && Math.abs(z - p.z) < 2;
            });

            if (nearRoom || nearCorr) alive = true;
            grid[x][z] = alive;
        }
    }

    // CA Steps
    for (let step = 0; step < 3; step++) {
        let nextGrid = JSON.parse(JSON.stringify(grid));
        for (let x = -bounds; x <= bounds; x++) {
            for (let z = -bounds; z <= bounds; z++) {
                let n = countNeighbors(grid, x, z, bounds);
                if (grid[x] && grid[x][z]) {
                    if (n < 3) nextGrid[x][z] = false; // Starve
                    else nextGrid[x][z] = true;
                } else {
                    if (n > 4) {
                        if (!nextGrid[x]) nextGrid[x] = {};
                        nextGrid[x][z] = true; // Born
                    }
                }

                // Keep rooms protected
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

    // Mesh Generation
    const floorGeo = new THREE.BoxGeometry(1, 1, 1);
    // We'll create individual meshes for simplicity as we need texture mapping
    // Ideally we'd use InstancedMesh but we want to use the existing block texture func

    // To optimize, let's create a single geometry merging? 
    // Actually, for just ~100-200 tiles, individual meshes are ok for now.

    for (let x = -bounds; x <= bounds; x++) {
        for (let z = -bounds; z <= bounds; z++) {
            if (grid[x][z]) {
                const m = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ color: 0xffffff }));
                m.position.set(x, -0.6, z); // Slightly below rooms (rooms are at y=0, floor needs to be ground level)
                // Wait, rooms are generated at y = rDepth/2.
                // Corridors are at h=0.05.
                // Rooms floor is effectively ~0.
                // Let's put this floor at y = -0.5

                applyTextureToMesh(m, 'block', theme.tile - 1); // 0-indexed
                scene.add(m);
            }
        }
    }
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
    const amb = new THREE.AmbientLight(0xffffff, 0.15);
    scene.add(amb);

    roomMeshes.clear(); waypointMeshes.clear(); corridorMeshes.clear(); doorMeshes.clear();
    playerSprite = null; torchLight = null;
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
    const deck = [];
    // Monsters: 2-14 Clubs/Spades (2 * 13 = 26)
    [SUITS.CLUBS, SUITS.SPADES].forEach(suit => {
        for (let v = 2; v <= 14; v++) {
            deck.push({ suit, val: v, type: 'monster', name: getMonsterName(v) });
        }
    });
    // Weapons: 2-10 Diamonds (9)
    for (let v = 2; v <= 10; v++) {
        deck.push({ suit: SUITS.DIAMONDS, val: v, type: 'weapon', name: `Weapon lv.${v}` });
    }
    // Potions: 2-10 Hearts (9)
    for (let v = 2; v <= 10; v++) {
        deck.push({ suit: SUITS.HEARTS, val: v, type: 'potion', name: `HP Incense ${v}` });
    }
    // Total: 44 cards
    return shuffle(deck);
}

function getMonsterName(v) {
    if (v <= 3) return 'Shadow Creeper';
    if (v <= 5) return 'Graveling';
    if (v <= 7) return 'Rat-Bat';
    if (v <= 9) return 'Spined Horror';
    if (v === 10) return 'Grue';
    if (v === 11) return 'Jack of Spite';
    if (v === 12) return 'Queen of Sorrow';
    if (v === 13) return 'King of Ruin';
    if (v === 14) return 'Primeval Ace';
    return `Monster (${v})`;
}

function startDive() {
    document.getElementById('avatarModal').style.display = 'flex';
}
window.selectAvatar = (sex) => {
    game.sex = sex;
    document.getElementById('avatarModal').style.display = 'none';
    finalizeStartDive();
};

function finalizeStartDive() {
    game.hp = 20; game.floor = 1; game.deck = createDeck();
    game.weapon = null; game.weaponDurability = Infinity; game.slainStack = [];
    game.rooms = generateDungeon(); game.currentRoomIdx = 0; game.lastAvoided = false;
    clear3DScene(); init3D();
    generateFloorCA(); // Generate Atmosphere and Floor
    updateAtmosphere(game.floor);

    if (playerSprite) playerSprite.position.set(0, 0.75, 0);
    updateUI();
    logMsg("The descent begins. Room 0 explored.");
    playerSprite.material.map = walkAnims[game.sex].up;
    enterRoom(0);
}

function descendToNextFloor() {
    game.floor++; closeCombat();
    game.deck = createDeck(); game.rooms = generateDungeon();
    game.currentRoomIdx = 0; game.lastAvoided = false;
    clear3DScene(); init3D();
    generateFloorCA();
    updateAtmosphere(game.floor);

    if (playerSprite) playerSprite.position.set(0, 0.75, 0);
    updateUI();
    logMsg(`Descending deeper... Floor ${game.floor}`);
    playerSprite.material.map = walkAnims[game.sex].up;
    enterRoom(0);
}

function enterRoom(id) {
    const oldId = game.currentRoomIdx; game.currentRoomIdx = id;
    const room = game.rooms.find(r => r.id === id);
    movePlayerSprite(oldId, id);
    if (room.isWaypoint) { logMsg("Traversing corridors..."); return; }

    if (room.state === 'cleared' && !room.isFinal) { logMsg("Safe passage."); return; }
    if (room.state === 'cleared' && room.isFinal) { game.activeRoom = room; showCombat(); return; }

    if (room.isSpecial && room.state !== 'cleared') {
        game.activeRoom = room;

        // Persistence Check
        if (!room.generatedContent) {
            const gifts = [];
            // Add 2 random card gifts
            const redFaces = [];
            [SUITS.HEARTS, SUITS.DIAMONDS].forEach(s => { for (let v = 11; v <= 14; v++) redFaces.push({ suit: s, val: v }); });

            for (let i = 0; i < 2; i++) {
                const base = redFaces[Math.floor(Math.random() * redFaces.length)];
                const giftType = Math.random() > 0.5 ? 'weapon' : 'potion';
                gifts.push({
                    suit: base.suit, val: base.val, type: 'gift',
                    name: giftType === 'weapon' ? `Divine Weapon` : `Elixir of Life`,
                    actualGift: { suit: base.suit, val: base.val, type: giftType, name: giftType === 'weapon' ? `Divine Weapon` : `Elixir of Life` }
                });
            }

            // Add Repair option if we have a weapon
            if (game.weapon) {
                const boost = Math.floor(Math.random() * 6) + 1;
                gifts.push({
                    suit: '🛠️', val: boost, type: 'gift',
                    name: `Repair Artifact (+${boost})`,
                    actualGift: { type: 'repair', val: boost, name: `Repaired ${game.weapon.name}` }
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

function showCombat() {
    const overlay = document.getElementById('combatModal');
    const enemyArea = document.getElementById('enemyArea');
    overlay.style.display = 'flex';
    enemyArea.innerHTML = '';

    game.combatCards.forEach((c, idx) => {
        const card = document.createElement('div');
        card.className = `card ${c.type} dealing`;
        card.style.animationDelay = `${idx * 0.1}s`;

        let asset = getAssetData(c.type, c.val, c.suit, c.type === 'gift' ? c.actualGift : null);
        let bgUrl = `assets/images/${asset.file}`;
        let bgSize = asset.isStrip ? '900% 100%' : 'cover';
        let bgPos = `${asset.uv.u * 112.5}% 0%`;
        let animClass = "";

        // Boss Animations: 11-14 Clubs/Spades
        if (c.type === 'monster' && c.val >= 11) {
            const suitName = c.suit === '♣' ? 'club' : 'spade';
            const rankName = { 11: 'jack', 12: 'queen', 13: 'king', 14: 'ace' }[c.val];
            bgUrl = `assets/images/animations/${suitName}_${rankName}.png`;
            bgSize = "2500% 100%"; // 25 framing spritesheet
            bgPos = "0% 0%";
            animClass = "animated-card-art";
        }

        card.innerHTML = `
                    <div class="card-art-container ${animClass}" style="background-image: url('${bgUrl}'); background-size: ${bgSize}; background-position: ${bgPos}"></div>
                    <div class="suit" style="background: rgba(0,0,0,0.5); border-radius: 50%; width: 40px; text-align: center;">${c.suit}</div>
                    <div class="val" style="color: #fff; text-shadow: 2px 2px 0 #000;">${getDisplayVal(c.val)}</div>
                    <div class="name">${c.name}</div>
                `;
        card.onclick = (e) => pickCard(idx, e);
        enemyArea.appendChild(card);
    });

    // If room is cleared, we show the Exit button, otherwise the Avoid button
    const msgEl = document.getElementById('combatMessage');
    if (game.activeRoom && game.activeRoom.state === 'cleared') {
        if (game.activeRoom.isFinal) {
            const allCleared = game.rooms.every(r => r.isWaypoint || r.state === 'cleared');
            if (allCleared) {
                msgEl.innerText = "Stairs revealed.";
                document.getElementById('descendBtn').style.display = 'block';
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
    const mp = document.getElementById('merchantPortrait');
    if (mp) {
        if (isMerchant) {
            // Calculate left based on sidebar width so the portrait doesn't get hidden under the panel
            const sidebar = document.querySelector('.sidebar');
            const leftOffset = (sidebar && sidebar.getBoundingClientRect) ? (Math.round(sidebar.getBoundingClientRect().width) + 32) : 32;
            mp.style.left = `${leftOffset}px`;
            mp.style.display = 'block';
            mp.style.pointerEvents = 'none';
        } else {
            mp.style.display = 'none';
        }
    }
    document.getElementById('bonfireNotNowBtn').style.display = (game.activeRoom && (game.activeRoom.isBonfire || (game.activeRoom.isSpecial && isMerchant)) && game.activeRoom.state !== 'cleared') ? 'inline-block' : 'none';

    updateUI();
}

function getDisplayVal(v) {
    const map = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
    return map[v] || v;
}

function pickCard(idx, event) {
    if (game.chosenCount >= 3) return;

    const card = game.combatCards[idx];

    // Animation for removal
    const cardEl = event.target.closest('.card');
    cardEl.style.pointerEvents = 'none';
    cardEl.style.transform = 'scale(0) rotate(15deg)';
    cardEl.style.opacity = '0';
    cardEl.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 1, 1)';

    switch (card.type) {
        case 'weapon':
            game.weapon = card;
            // Scoundrel Rules: First monster killed can be any level.
            // Subsequent monsters must be strictly lower level than the previous one.
            game.weaponDurability = Infinity;
            game.slainStack = [];
            logMsg(`Equipped ${card.name}. First kill has no level limit.`);
            break;
        case 'monster':
            let dmg = card.val;
            const cardRect = event.target.getBoundingClientRect();
            const centerX = cardRect.left + cardRect.width / 2;
            const centerY = cardRect.top + cardRect.height / 2;

            // SLAYING: Monster MUST be lower than or equal to weapon durability
            if (game.weapon && card.val <= game.weaponDurability) {
                dmg = Math.max(0, card.val - game.weapon.val);
                game.weaponDurability = card.val;
                logMsg(`Slit ${card.name}'s throat. Next enemy must be <=${card.val}.`);
                spawnParticles(centerX, centerY, '#aaa', 10);
                game.slainStack.push(card);
            } else if (game.weapon) {
                // Combat hit: Weapon breaks but reduces damage
                dmg = Math.max(0, card.val - game.weapon.val);
                const brokeName = game.weapon.name;
                game.weapon = null; game.weaponDurability = Infinity; game.slainStack = [];
                logMsg(`CRACK! The ${brokeName} has broken!`);
                spawnParticles(centerX, centerY, '#555', 25); // Gray shards
                triggerShake(15, 30);
            } else {
                logMsg(`Grappled ${card.name} barehanded. Took ${dmg} DMG.`);
            }
            if (dmg > 0) {
                spawnParticles(window.innerWidth / 2, window.innerHeight / 2, '#800', 30); // Blood
                triggerShake(10, 20);
            }
            game.hp -= dmg;
            updateUI(); // Ensure immediate feedback
            break;
        case 'potion':
            const heal = Math.min(card.val, game.maxHp - game.hp);
            spawnParticles(window.innerWidth / 2, window.innerHeight / 2, '#00cc00', 25);
            if (game.potionsUsedThisTurn) {
                logMsg("Second potion discarded. (Limit: 1/turn)");
            } else {
                game.hp += heal;
                game.potionsUsedThisTurn = true;
                logMsg(`Vitality Potion: +${heal} HP.`);
            }
            updateUI(); // Immediate UI refresh
            break;
        case 'gift':
            const gift = card.actualGift;
            spawnParticles(window.innerWidth / 2, window.innerHeight / 2, '#d4af37', 40);

            if (gift.type === 'weapon') {
                game.weapon = gift;
                game.weaponDurability = Infinity;
                game.slainStack = [];
                logMsg(`Merchant's Blessing: Equipped ${gift.name}.`);
            } else if (gift.type === 'potion') {
                const heal = Math.min(gift.val, game.maxHp - game.hp);
                game.hp += heal;
                logMsg(`Merchant's Blessing: Vitality Elixir drank.`);
            } else if (gift.type === 'repair' && game.weapon) {
                game.weapon.val = Math.min(14, game.weapon.val + gift.val);
                // Resetting durability effectively "cleans" it for a first hit again
                game.weaponDurability = Infinity;
                game.slainStack = []; // Clear trophies when cleansed
                logMsg(`Merchant's Repair: ${game.weapon.name} boosted by +${gift.val}!`);
            }

            game.activeRoom.state = 'cleared';
            game.combatCards = []; // Clear other gift options
            updateUI();
            finishRoom(); // Closes modal with victory message
            return;
        case 'bonfire':
            spawnParticles(window.innerWidth / 2, window.innerHeight / 2, '#ff6600', 40);
            const bonfireHeal = Math.min(card.val, game.maxHp - game.hp);
            game.hp += bonfireHeal;
            logMsg(`Rested at bonfire. Vitality +${bonfireHeal}.`);

            game.activeRoom.restRemaining--;
            updateUI();

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
    game.activeRoom.state = 'cleared';
    // Only carry over if it's a regular room (not special or bonfire)
    // Regular rooms start with 4 cards, so if 3 are picked, 1 remains.
    if (!game.activeRoom.isSpecial && !game.activeRoom.isBonfire) {
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
            // Update message and show descend button immediately
            document.getElementById('combatMessage').innerText = "Floor Purged! Stairs revealed.";
            document.getElementById('descendBtn').style.display = 'block';
            document.getElementById('exitCombatBtn').style.display = 'none';
            logMsg("Floor Purged! Stairs revealed.");
        } else {
            logMsg("Floor Purged! Return to the Guardian's lair to descend.");
        }
    }
    updateRoomVisuals();
    updateUI();
}

function avoidRoom() {
    if (game.lastAvoided || game.chosenCount > 0) return;

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
    // Hide merchant portrait when modal is closed
    const mp = document.getElementById('merchantPortrait');
    if (mp) mp.style.display = 'none';
}
window.closeCombat = closeCombat; // Expose for onClick events

function showBonfireUI() {
    const overlay = document.getElementById('combatModal');
    overlay.style.display = 'flex';
    document.getElementById('combatContainer').style.display = 'none';
    document.getElementById('bonfireUI').style.display = 'flex';
    // Ensure merchant portrait is hidden when showing bonfire UI
    const mp = document.getElementById('merchantPortrait');
    if (mp) mp.style.display = 'none';
    updateBonfireUI();
}

window.handleBonfire = function (cost) {
    const room = game.activeRoom;
    if (room.restRemaining < cost) return;

    room.restRemaining -= cost;
    const heal = Math.min(5 * cost, game.maxHp - game.hp);
    game.hp += heal;

    spawnParticles(window.innerWidth / 2, window.innerHeight / 2, '#ff6600', 40);
    logMsg(`Bonfire Rest: +${heal} Vitality.`);

    if (room.restRemaining <= 0) {
        room.state = 'cleared';
        logMsg("The fire fades.");
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
    const bgUrl = `assets/images/rest_${game.sex}.png`;
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

    alert(`Game Over! Your vitality reached 0.\n\nFinal Score: ${score}\n(Life: ${game.hp}, Monsters remaining: ${monsterSum})`);
    location.reload();
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

    const floorEl = document.getElementById('floorValue');
    if (floorEl) floorEl.innerText = game.floor;

    const progressEl = document.getElementById('progressValue');
    if (progressEl && game.rooms) {
        const total = game.rooms.filter(r => !r.isWaypoint).length;
        const cleared = game.rooms.filter(r => !r.isWaypoint && r.state === 'cleared').length;
        progressEl.innerText = `${cleared} / ${total}`;
    }

    const deckEl = document.getElementById('deckValue');
    if (deckEl) deckEl.innerText = game.deck.length;

    const weaponLabel = document.getElementById('weaponNameModal');
    const weaponDetail = document.getElementById('weaponLastDealModal');

    if (game.weapon) {
        // Ensure name doesn't already have (X) before adding it
        const cleanName = game.weapon.name.split(' (')[0];
        weaponLabel.innerText = `${cleanName} (${game.weapon.val})`;
        weaponDetail.innerText = game.weaponDurability === Infinity ? "Clean Weapon: No limit" : `Bloody: Next <${game.weaponDurability}`;
        weaponLabel.style.color = 'var(--gold)';

        // Update Sidebar Slot
        const asset = getAssetData('weapon', game.weapon.val, game.weapon.suit);
        const weaponArt = document.getElementById('weaponArtSidebar');
        weaponArt.style.backgroundImage = `url('assets/images/${asset.file}')`;
        weaponArt.style.backgroundPosition = `${asset.uv.u * 112.5}% 0%`;
        document.getElementById('weaponNameSidebar').innerText = `${cleanName} (${game.weapon.val})`;
        document.getElementById('weaponDurSidebar').innerText = game.weaponDurability === Infinity ? "Next: Any" : `Next: <${game.weaponDurability}`;
    } else {
        weaponLabel.innerText = "BARE HANDS";
        weaponDetail.innerText = "No protection";
        weaponLabel.style.color = '#fff';

        // Update Sidebar Slot
        const weaponArt = document.getElementById('weaponArtSidebar');
        weaponArt.style.backgroundImage = "none";
        document.getElementById('weaponNameSidebar').innerText = "UNARMED";
        document.getElementById('weaponDurSidebar').innerText = "No limit";
    }

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
}

// --- ASSET HELPERS ---
function getUVForCell(cellIdx) {
    // cellIdx is 0-8 for 1x9 horizontal strip
    return { u: cellIdx / 9, v: 0 };
}

function getAssetData(type, value, suit, extra) {
    let file = 'block.png';
    let v = value;
    let s = suit;

    if (type === 'monster') file = (suit === '♣' ? 'club.png' : 'spade.png');
    else if (type === 'weapon') file = 'diamond.png';
    else if (type === 'potion') file = 'heart.png';
    else if (type === 'block') file = 'block.png';
    else if (type === 'bonfire') file = 'rest_m.png';
    else if (type === 'gift' && extra) {
        file = extra.type === 'weapon' ? 'diamond.png' : 'heart.png';
        v = extra.val; s = extra.suit;
    }

    let cellIdx = 0;
    if (type === 'block') {
        cellIdx = value % 9;
    } else if (type === 'bonfire') {
        cellIdx = 0; // rest_m.png
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
    return { file, uv: getUVForCell(cellIdx), isStrip };
}

function applyTextureToMesh(mesh, type, value, suit) {
    const asset = getAssetData(type, value, suit);
    const tex = loadTexture(`assets/images/${asset.file}`);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;

    const isStrip = !asset.file.includes('rest');
    tex.repeat.set(isStrip ? 1 / 9 : 1, 1);
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
document.getElementById('descendBtn').onclick = descendToNextFloor;
document.getElementById('bonfireNotNowBtn').onclick = closeCombat;
{/* </script> */ }
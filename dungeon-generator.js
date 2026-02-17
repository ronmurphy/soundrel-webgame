import * as THREE from 'three';

export const THEMES = [
    { id: 1, name: 'Dirt', tile: 1, color: 0x3d2817, fogDensity: 0.05, hemiIntensity: 0.35, weather: 'dust' },
    { id: 2, name: 'Stone', tile: 2, color: 0x222222, fogDensity: 0.05, hemiIntensity: 0.34, weather: 'none' },
    { id: 3, name: 'Moss', tile: 3, color: 0x173d1a, fogDensity: 0.04, hemiIntensity: 0.36, weather: 'spore' },
    { id: 4, name: 'Ancient', tile: 4, color: 0x3d173d, fogDensity: 0.05, hemiIntensity: 0.34, weather: 'rain' },
    { id: 5, name: 'Magma', tile: 5, color: 0x3d1717, fogDensity: 0.06, hemiIntensity: 0.30, weather: 'ember' },
    { id: 6, name: 'Ice', tile: 6, color: 0x173d3d, fogDensity: 0.03, hemiIntensity: 0.42, weather: 'snow' },
    { id: 7, name: 'Abyss', tile: 7, color: 0x050505, fogDensity: 0.07, hemiIntensity: 0.22, weather: 'void' },
    { id: 8, name: 'Bone', tile: 8, color: 0x3d3517, fogDensity: 0.04, hemiIntensity: 0.36, weather: 'dust' },
    { id: 9, name: 'Ruins', tile: 9, color: 0x282222, fogDensity: 0.035, hemiIntensity: 0.38, weather: 'rain' },
];

export function getThemeForFloor(floor) {
    // map floor 1 -> index 0 (theme 1)
    // wrap around 1-9
    const idx = (floor - 1) % 9;
    return THEMES[idx];
}

export function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

export function generateDungeon(floor) {
    // Escalation Logic
    let numRooms = 12;
    let merchantCount = 0;

    if (floor <= 3) {
        numRooms = 12;
        merchantCount = 4 - floor; // 1->3, 2->2, 3->1
    } else if (floor <= 6) {
        numRooms = 24;
        // Levels 4(2), 5(1), 6(0)
        if (floor === 4) merchantCount = 2;
        else if (floor === 5) merchantCount = 1;
        else merchantCount = 0;
    } else {
        numRooms = 36;
        // Levels 7(1), 8(0), 9(0)
        if (floor === 7) merchantCount = 1;
        else merchantCount = 0;
    }

    const rooms = [];
    const occupied = new Set(["0,0"]);

    // 1. Create start room
    rooms.push({
        id: 0, gx: 0, gy: 0, w: 1, h: 1,
        state: 'cleared', cards: [], connections: [],
        isWaypoint: false, isRevealed: true, isShrine: true
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
    for (let i = 0; i < trapCount; i++) {
        if (potentialTraps.length > 0) {
            const t = potentialTraps.pop();
            t.isTrap = true;
        }
    }

    // 4.5 Assign Alchemy Room (1 per floor)
    const potentialAlchemy = rooms.filter(r => r.id !== 0 && !r.isFinal && !r.isWaypoint && !r.isSpecial && !r.isBonfire && !r.isTrap);
    shuffle(potentialAlchemy);
    if (potentialAlchemy.length > 0) {
        const a = potentialAlchemy.pop();
        a.isAlchemy = true;
        a.depth = 2.0; // Make it look slightly different (standard height)
    }

    // 5. Create Secret Room (1 per floor)
    // Find a room with an empty neighbor
    const potentialParents = rooms.filter(r => !r.isWaypoint && !r.isFinal);
    shuffle(potentialParents);
    let secretCreated = false;

    for (const p of potentialParents) {
        if (secretCreated) break;
        const dirs = shuffle([{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]);
        for (const d of dirs) {
            const nx = p.gx + d.x * 4;
            const ny = p.gy + d.y * 4;
            // Check collision with existing rooms/waypoints
            const collide = rooms.some(r => Math.abs(r.gx - nx) < 2 && Math.abs(r.gy - ny) < 2);
            if (!collide) {
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

export function generateFloorCA(scene, floor, rooms, corridorMeshes, decorationMeshes, treePositions, loadTexture, getClonedTexture) {
    const theme = getThemeForFloor(floor);
    const bounds = 12 + (floor * 2);

    const size = bounds * 2 + 1;
    let grid = {};

    // ========================================
    // STEP 1: Initialize grid
    // ========================================
    for (let x = -bounds; x <= bounds; x++) {
        grid[x] = {};
        for (let z = -bounds; z <= bounds; z++) {
            let alive = Math.random() < 0.45;

            const nearRoom = rooms.some(r => {
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

                const protectedCell = rooms.some(r =>
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
    rooms.forEach(r => {
        r.connections.forEach(cid => {
            const target = rooms.find(rm => rm.id === cid);
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
        for (const r of rooms) {
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
        if (rooms.some(r =>
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
    
    return floorMesh;
}
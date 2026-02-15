import * as THREE from 'three';

/**
 * Handles terrain manipulation for the 3D Combat View.
 * Flattens the ground in a 5x5 area so cards don't clip into hills.
 */
export const CombatTerrain = {
    flattenedVertices: new Map(),

    // Flattens terrain in a radius around x,z (default 3.5 covers a 5x5 grid)
    flattenAround(floorMesh, x, z, radius = 4.5) {
        if (!floorMesh) return;
        const pos = floorMesh.geometry.attributes.position;
        const count = pos.count;
        
        this.flattenedVertices.clear();
        let changed = false;

        for (let i = 0; i < count; i++) {
            const vx = pos.getX(i);
            const vz = pos.getZ(i);
            
            // Check if vertex is within the combat zone
            if (Math.abs(vx - x) < radius && Math.abs(vz - z) < radius) {
                const vy = pos.getY(i);
                // If it's elevated (slope/hill), flatten it to base level (-0.5)
                if (vy > -0.5) { 
                    this.flattenedVertices.set(i, vy);
                    pos.setY(i, -0.5); 
                    changed = true;
                }
            }
        }
        
        if (changed) {
            pos.needsUpdate = true;
            floorMesh.geometry.computeVertexNormals(); // Recompute lighting for flat surface
        }
    },

    // Restores terrain to original state
    restore(floorMesh) {
        if (!floorMesh || this.flattenedVertices.size === 0) return;
        const pos = floorMesh.geometry.attributes.position;
        
        for (const [i, y] of this.flattenedVertices.entries()) {
            pos.setY(i, y);
        }
        
        pos.needsUpdate = true;
        floorMesh.geometry.computeVertexNormals();
        this.flattenedVertices.clear();
    }
};

/**
 * Hides world objects (Rooms, Doors, Waypoints) that are too close to the camera
 * during 3D combat, preventing them from blocking the view.
 */
export function updateCombatVisibility(isCombatView, playerPos, rooms, doorMeshes, waypointMeshes, corridorMeshes, radius = 4.5) {
    if (!isCombatView) return; 

    const isNear = (x, z) => Math.sqrt(Math.pow(x - playerPos.x, 2) + Math.pow(z - playerPos.z, 2)) < radius;

    // Hide Rooms
    rooms.forEach(r => {
        if (r.mesh && isNear(r.gx, r.gy)) r.mesh.visible = false;
    });

    // Hide Doors
    doorMeshes.forEach(mesh => {
        const worldPos = new THREE.Vector3();
        mesh.getWorldPosition(worldPos);
        if (isNear(worldPos.x, worldPos.z)) mesh.visible = false;
    });

    // Hide Waypoints
    waypointMeshes.forEach(mesh => {
        if (isNear(mesh.position.x, mesh.position.z)) mesh.visible = false;
    });
    
    // Hide Corridors
    corridorMeshes.forEach(mesh => {
        if (isNear(mesh.position.x, mesh.position.z)) mesh.visible = false;
    });
}
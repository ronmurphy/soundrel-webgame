import * as THREE from 'three';

const BattleIsland = {
    // Remote location far from the main dungeon map
    anchor: new THREE.Vector3(5000, 0, 5000),
    scene: null,
    group: new THREE.Group(),
    currentThemeId: -1,

    init(scene) {
        this.scene = scene;
        this.scene.add(this.group);
    },

    getAnchor() {
        return this.anchor;
    },

    generate(theme) {
        // Don't regenerate if the theme hasn't changed
        if (this.currentThemeId === theme.id) return;
        this.currentThemeId = theme.id;

        // Clear previous arena
        while(this.group.children.length > 0) {
            const child = this.group.children[0];
            if(child.geometry) child.geometry.dispose();
            if(child.material) child.material.dispose();
            this.group.remove(child);
        }

        console.log(`[BattleIsland] Generating arena for theme: ${theme.name}`);

        // 1. The Arena Floor (Large flat area)
        const floorGeo = new THREE.PlaneGeometry(30, 30);
        const floorMat = new THREE.MeshStandardMaterial({ 
            color: theme.color, 
            roughness: 0.9,
            side: THREE.FrontSide
        });
        
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.copy(this.anchor);
        floor.position.y = -0.05; // Slightly below 0 to avoid Z-fighting with shadows
        floor.receiveShadow = true;
        this.group.add(floor);

        // 2. Perimeter Decorations
        // We scatter objects in a ring, leaving the center (radius ~6) clear for combat
        const decorCount = 40;
        const dummy = new THREE.Object3D();
        
        let geo, mat;
        
        // Choose props based on theme
        if (theme.name === 'Ice') {
            // Ice Spikes / Cones
            geo = new THREE.ConeGeometry(0.4, 2.5, 5);
            mat = new THREE.MeshStandardMaterial({ color: 0xaaddff, roughness: 0.1, metalness: 0.1, emissive: 0x002244 });
        } else if (theme.name === 'Magma') {
            // Volcanic Rocks
            geo = new THREE.DodecahedronGeometry(0.6);
            mat = new THREE.MeshStandardMaterial({ color: 0x330000, roughness: 0.9, emissive: 0xff2200, emissiveIntensity: 0.2 });
        } else if (theme.name === 'Moss') {
            // Trees / Bushes
            geo = new THREE.CylinderGeometry(0.1, 0.4, 1.5, 6);
            mat = new THREE.MeshStandardMaterial({ color: 0x224422, roughness: 1.0 });
        } else if (theme.name === 'Bone') {
            // Bone-like pillars
            geo = new THREE.CylinderGeometry(0.2, 0.2, 2, 4);
            mat = new THREE.MeshStandardMaterial({ color: 0xddddcc, roughness: 0.6 });
        } else if (theme.name === 'Abyss') {
            // Dark Monoliths
            geo = new THREE.BoxGeometry(0.5, 3, 0.5);
            mat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2 });
        } else {
            // Default Rocks (Dirt, Stone, Ruins)
            geo = new THREE.DodecahedronGeometry(0.7);
            mat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9 });
        }

        const mesh = new THREE.InstancedMesh(geo, mat, decorCount);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        let i = 0;
        while (i < decorCount) {
            const angle = Math.random() * Math.PI * 2;
            // Scatter between radius 7 and 14
            const dist = 7 + Math.random() * 7; 
            
            const x = this.anchor.x + Math.cos(angle) * dist;
            const z = this.anchor.z + Math.sin(angle) * dist;
            
            // Randomize Y slightly based on prop type
            const y = (theme.name === 'Ice' || theme.name === 'Moss' || theme.name === 'Bone' || theme.name === 'Abyss') ? 1.0 : 0.3;

            dummy.position.set(x, y, z);
            dummy.rotation.set(
                (Math.random() - 0.5) * 0.5, 
                Math.random() * Math.PI * 2, 
                (Math.random() - 0.5) * 0.5
            );
            const scale = 0.8 + Math.random() * 1.2;
            dummy.scale.set(scale, scale, scale);
            dummy.updateMatrix();
            
            mesh.setMatrixAt(i, dummy.matrix);
            i++;
        }
        this.group.add(mesh);
    }
};

export default BattleIsland;

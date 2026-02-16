import { game, getAssetData, getSpellName, SUITS, ARMOR_DATA, ITEM_DATA, CURSED_ITEMS, getDisplayVal } from './game-state.js';

// Helper for floating text
export function spawnFloatingText(text, x, y, color) {
    const el = document.createElement('div');
    el.innerText = text;
    el.style.cssText = `position:fixed; left:${x}px; top:${y}px; transform:translate(-50%, -50%); color:${color || '#fff'}; fontSize:32px; fontWeight:bold; textShadow:0 2px 4px #000; pointerEvents:none; zIndex:10000; transition:all 1s ease-out; opacity:1;`;
    document.body.appendChild(el);

    requestAnimationFrame(() => {
        el.style.top = (y - 80) + 'px';
        el.style.opacity = '0';
        el.style.transform = 'translate(-50%, -50%) scale(1.5)';
    });
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1000);
}

export function logMsg(m) {
    const log = document.getElementById('gameLog');
    if (log) {
        const entry = document.createElement('div');
        entry.innerText = `> `;
        log.prepend(entry);
    }
}

export function updateUI() {
    // Update Sidebar
    const hpSide = document.getElementById('hpValueSidebar');
    if(hpSide) hpSide.innerText = game.hp;
    const hpBarSide = document.getElementById('hpBarSidebar');
    if(hpBarSide) hpBarSide.style.width = `${(game.hp / game.maxHp) * 100}%`;

    // Visual Progression
    const blockNum = Math.min(9, game.floor).toString().padStart(3, '0');
    const sidebar = document.querySelector('.sidebar');
    if(sidebar) sidebar.style.backgroundImage = `url('assets/images/individuals/block_${blockNum}.png')`;

    // Update Modal
    const hpModal = document.getElementById('hpValueModal');
    if(hpModal) hpModal.innerText = game.hp;
    const hpBarModal = document.getElementById('hpBarModal');
    if(hpBarModal) hpBarModal.style.width = `${(game.hp / game.maxHp) * 100}%`;

    // Update AP Bar
    let apBar = document.getElementById('apBarModal');
    if (!apBar && hpBarModal) {
        const hpContainer = hpBarModal.parentNode;
        if (getComputedStyle(hpContainer).position === 'static') hpContainer.style.position = 'relative';
        apBar = document.createElement('div');
        apBar.id = 'apBarModal';
        apBar.style.cssText = "position:absolute; top:0; left:0; height:100%; background:#88aaff; opacity:0.6; transition: width 0.3s;";
        hpContainer.appendChild(apBar);
    }
    if(apBar) apBar.style.width = `${(game.ap / Math.max(1, game.maxAp)) * 100}%`;

    // Update Coins
    const coinEl = document.getElementById('soulCoinsValueSidebar');
    if (coinEl) coinEl.innerText = game.soulCoins;
    const coinModalEl = document.getElementById('soulCoinsValueModal');
    if (coinModalEl) coinModalEl.innerText = game.soulCoins;

    // Update Floor
    const floorEl = document.getElementById('floorValue');
    if (floorEl) floorEl.innerText = game.floor;

    // Update Fuel
    const torchBar = document.getElementById('torchFuelBar');
    const mapFuelBar = document.getElementById('mapFuelBar');
    const maxFuel = 30; 
    const currentFuel = game.torchCharge || 0;
    const fuelPct = Math.min(100, (currentFuel / maxFuel) * 100);

    if (torchBar) {
        torchBar.style.height = `${fuelPct}%`;
        if (currentFuel <= 5) torchBar.style.background = '#ff4444';
        else torchBar.style.background = '#ffaa44';
    }
    if (mapFuelBar) {
        mapFuelBar.style.height = `${fuelPct}%`;
        if (currentFuel <= 5) mapFuelBar.style.background = '#ff4444';
        else mapFuelBar.style.background = 'linear-gradient(to top, #ff4400, #ffaa44)';
    }

    // Update Progress
    const mandatoryRooms = game.rooms ? game.rooms.filter(r => !r.isWaypoint && !r.isSpecial && !r.isBonfire) : [];
    const totalRooms = mandatoryRooms.length;
    const clearedRooms = mandatoryRooms.filter(r => r.state === 'cleared').length;
    const progressEl = document.getElementById('progressValue');
    if (progressEl) progressEl.innerText = `${clearedRooms} / ${totalRooms}`;

    // Update Deck
    const deckEl = document.getElementById('deckValue');
    if (deckEl) deckEl.innerText = game.deck ? game.deck.length : 0;

    // Update Weapon UI
    const weaponLabel = document.getElementById('weaponNameModal');
    const weaponDetail = document.getElementById('weaponLastDealModal');
    const weaponArtModal = document.getElementById('weaponArtModal');
    const weaponArtSidebar = document.getElementById('weaponArtSidebar');
    const nameSidebar = document.getElementById('weaponNameSidebar');
    const durSidebar = document.getElementById('weaponDurSidebar');

    if (game.equipment.weapon) {
        const cleanName = game.equipment.weapon.name.split(' (')[0];
        if (weaponLabel) {
            weaponLabel.innerText = `${cleanName} (${game.equipment.weapon.val})`;
            weaponLabel.style.color = 'var(--gold)';
        }
        if(weaponDetail) weaponDetail.innerText = game.weaponDurability === Infinity ? "Clean Weapon: No limit" : `Bloody: Next <${game.weaponDurability}`;

        const asset = getAssetData('weapon', game.equipment.weapon.val, game.equipment.weapon.suit);
        const bgSize = `${asset.sheetCount * 100}% 100%`;
        const bgPos = `${(asset.uv.u * asset.sheetCount) / (asset.sheetCount - 1) * 100}% 0%`;

        if (weaponArtModal) {
            weaponArtModal.style.backgroundImage = `url('assets/images/${asset.file}')`;
            weaponArtModal.style.backgroundSize = bgSize;
            weaponArtModal.style.backgroundPosition = bgPos;
        }
        if (weaponArtSidebar) {
            weaponArtSidebar.style.backgroundImage = `url('assets/images/${asset.file}')`;
            weaponArtSidebar.style.backgroundSize = bgSize;
            weaponArtSidebar.style.backgroundPosition = bgPos;
        }
        if (nameSidebar) nameSidebar.innerText = `${cleanName} (${game.equipment.weapon.val})`;
        if (durSidebar) durSidebar.innerText = game.weaponDurability === Infinity ? "Next: Any" : `Next: <${game.weaponDurability}`;
    } else {
        if (weaponLabel) {
            weaponLabel.innerText = "BARE HANDS";
            weaponLabel.style.color = '#fff';
        }
        if(weaponDetail) weaponDetail.innerText = "No protection";
        if (weaponArtModal) weaponArtModal.style.backgroundImage = "none";
        if (weaponArtSidebar) weaponArtSidebar.style.backgroundImage = "none";
        if (nameSidebar) nameSidebar.innerText = "UNARMED";
        if (durSidebar) durSidebar.innerText = "No limit";
    }

    // Update Hotbar UI
    const invContainer = document.getElementById('inventorySidebar');
    if (invContainer) {
        invContainer.innerHTML = '';
        const protectionFloor = Object.values(game.equipment).filter(i => i && i.type === 'armor').length;
        const isArmorBroken = game.ap <= protectionFloor;

        for (let i = 0; i < 6; i++) {
            const slot = document.createElement('div');
            slot.style.cssText = "width:100%; aspect-ratio:1; background:rgba(0,0,0,0.5); border:1px solid #444; position:relative; cursor: pointer;";
            if (game.hotbar[i]) {
                const item = game.hotbar[i];
                const val = item.type === 'potion' ? item.val : item.id;
                const asset = getAssetData(item.type, val, item.suit);
                let tint = (item.type === 'armor' && isArmorBroken) ? 'filter: sepia(1) hue-rotate(-50deg) saturate(5) contrast(0.8);' : '';
                if (item.isCursed) tint = 'filter: sepia(1) hue-rotate(60deg) saturate(3) contrast(1.2);';

                const bgSize = `${asset.sheetCount * 100}% 100%`;
                const bgPos = `${(asset.uv.u * asset.sheetCount) / (asset.sheetCount - 1) * 100}% 0%`;

                slot.innerHTML = `<div style="width:100%; height:100%; background-image:url('assets/images/${asset.file}'); background-size:${bgSize}; background-position:${bgPos}; ${tint}" onclick="window.useHotbarItem(${i})"></div>`;
                
                // Tooltip
                slot.onmouseenter = () => showTooltip(slot, item);
                slot.onmouseleave = () => hideTooltip();
            }
            invContainer.appendChild(slot);
        }
    }

    // Update Combat Inventory (Hotbar in Modal)
    const combatInv = document.getElementById('combatInventory');
    if (combatInv) {
        combatInv.innerHTML = '';
        const protectionFloor = Object.values(game.equipment).filter(i => i && i.type === 'armor').length;
        const isArmorBroken = game.ap <= protectionFloor;

        for (let i = 0; i < 6; i++) {
            const slot = document.createElement('div');
            // .combat-inventory-grid > div CSS handles dimensions
            if (game.hotbar[i]) {
                const item = game.hotbar[i];
                const val = item.type === 'potion' ? item.val : item.id;
                const asset = getAssetData(item.type, val, item.suit);
                let tint = (item.type === 'armor' && isArmorBroken) ? 'filter: sepia(1) hue-rotate(-50deg) saturate(5) contrast(0.8);' : '';
                if (item.isCursed) tint = 'filter: sepia(1) hue-rotate(60deg) saturate(3) contrast(1.2);';

                const bgSize = `${asset.sheetCount * 100}% 100%`;
                const bgPos = `${(asset.uv.u * asset.sheetCount) / (asset.sheetCount - 1) * 100}% 0%`;

                slot.innerHTML = `<div style="width:100%; height:100%; background-image:url('assets/images/${asset.file}'); background-size:${bgSize}; background-position:${bgPos}; ${tint}" onclick="window.useHotbarItem(${i})"></div>`;
                
                slot.onmouseenter = () => showTooltip(slot, item);
                slot.onmouseleave = () => hideTooltip();
            }
            combatInv.appendChild(slot);
        }
    }

    // Update Combat Trophies
    const combatTrophies = document.getElementById('trophyShelf');
    if (combatTrophies) {
        combatTrophies.innerHTML = '';
        if (game.slainStack.length > 0) {
            game.slainStack.forEach((c, idx) => {
                // Reuse the trophy rendering logic
                const container = createTrophyElement(c, idx);
                // Adjust style for combat view if needed, but default class .mini-trophy should work
                container.style.width = "32px"; container.style.height = "44px";
                combatTrophies.appendChild(container);
            });
        }
    }

    // Update Map HUD
    updateMapHUD();

    // Render Full Inventory if open
    renderInventoryUI();
}

function updateMapHUD() {
    const mapHud = document.getElementById('gameplayInventoryBar');
    if (!mapHud) return;

    // Visibility Logic
    const combatModal = document.getElementById('combatModal');
    const invModal = document.getElementById('inventoryModal');
    const startModal = document.getElementById('startMenuModal');
    const attractOv = document.getElementById('attractionOverlay');
    
    const isCombat = combatModal && (getComputedStyle(combatModal).display !== 'none');
    const isInv = invModal && (getComputedStyle(invModal).display !== 'none');
    const isStart = startModal && (getComputedStyle(startModal).display !== 'none');
    const isAttract = attractOv && (getComputedStyle(attractOv).display !== 'none');

    if (isCombat || isInv || isStart || isAttract) {
        mapHud.style.display = 'none';
    } else {
        mapHud.style.display = 'flex';
        
        // Ensure HUD has overflow hidden for bars
        if (mapHud.style.overflow !== 'hidden') mapHud.style.overflow = 'hidden';

        // HP/AP Bars
        let hpBar = document.getElementById('hudHpBar');
        if (!hpBar) {
            hpBar = document.createElement('div');
            hpBar.id = 'hudHpBar';
            hpBar.style.cssText = "position:absolute; top:0; left:0; height:100%; background:linear-gradient(to right, #8b0000, #e60000); z-index:0; transition: width 0.3s ease-out; opacity:0.6;";
            mapHud.insertBefore(hpBar, mapHud.firstChild);
        }
        hpBar.style.width = `${Math.max(0, Math.min(100, (game.hp / game.maxHp) * 100))}%`;
        
        let apBar = document.getElementById('hudApBar');
        if (!apBar) {
            apBar = document.createElement('div');
            apBar.id = 'hudApBar';
            apBar.style.cssText = "position:absolute; top:0; left:0; height:100%; background:linear-gradient(to right, rgba(212, 175, 55, 0.5), rgba(255, 223, 0, 0.6)); z-index:0; transition: width 0.3s ease-out; pointer-events:none; border-right: 1px solid rgba(255,255,255,0.5);";
            mapHud.insertBefore(apBar, hpBar.nextSibling);
        }
        apBar.style.width = `${game.maxAp > 0 ? Math.max(0, Math.min(100, (game.ap / game.maxAp) * 100)) : 0}%`;

        // Ensure content is above bars
        Array.from(mapHud.children).forEach(c => {
            if (c.id !== 'hudHpBar' && c.id !== 'hudApBar') {
                c.style.zIndex = '1';
                if (getComputedStyle(c).position === 'static') c.style.position = 'relative';
            }
        });

        // Weapon Button
        const mapWepBtn = document.getElementById('mapWeaponBtn');
        if (mapWepBtn) {
            mapWepBtn.onclick = window.openInventory;
            mapWepBtn.innerHTML = '';
            if (game.equipment.weapon) {
                const w = game.equipment.weapon;
                const asset = getAssetData('weapon', w.val, w.suit);
                const bgSize = `${asset.sheetCount * 100}% 100%`;
                const bgPos = `${(asset.uv.u * asset.sheetCount) / (asset.sheetCount - 1) * 100}% 0%`;
                mapWepBtn.style.backgroundImage = `url('assets/images/${asset.file}')`;
                mapWepBtn.style.backgroundSize = bgSize;
                mapWepBtn.style.backgroundPosition = bgPos;
            } else {
                mapWepBtn.style.backgroundImage = 'none';
            }
        }

        // Hotbar
        const mapHotbar = document.getElementById('mapHotbar');
        if (mapHotbar) {
            mapHotbar.innerHTML = '';
            for (let i = 0; i < 6; i++) {
                const item = game.hotbar[i];
                const slot = document.createElement('div');
                slot.style.cssText = "width:40px; height:40px; border:1px solid #555; background:rgba(0,0,0,0.5); position:relative; cursor:pointer;";
                if (item) {
                    const img = document.createElement('div');
                    const asset = getAssetData(item.type, item.val || 0, item.suit);
                    img.style.width = '100%'; img.style.height = '100%';
                    img.style.backgroundImage = `url('assets/images/${asset.file}')`;
                    img.style.backgroundSize = `${asset.sheetCount * 100}% 100%`;
                    img.style.backgroundPosition = `${(asset.uv.u * asset.sheetCount) / (asset.sheetCount - 1) * 100}% 0%`;
                    if (item.type === 'potion') img.style.filter = 'hue-rotate(-50deg) saturate(1.5)';
                    slot.appendChild(img);
                    slot.onclick = () => { window.useHotbarItem(i); };
                }
                mapHotbar.appendChild(slot);
            }
        }
    }
}

function showTooltip(el, item) {
    let tooltip = document.getElementById('gameTooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'gameTooltip';
        tooltip.style.cssText = "position:fixed; pointer-events:none; background:rgba(0,0,0,0.95); border:1px solid #666; color:#fff; padding:8px; font-size:12px; z-index:10000; display:none; max-width:200px; border-radius:4px; box-shadow: 0 4px 8px rgba(0,0,0,0.5);";
        document.body.appendChild(tooltip);
    }
    tooltip.style.display = 'block';
    tooltip.innerHTML = `<strong style="color:#ffd700; font-size:13px;">${item.name}</strong><br/><span style="color:#aaa; font-size:11px;">${item.type === 'armor' ? `+${item.ap} AP (${item.slot})` : 'Item'}</span><br/><div style="margin-top:4px; color:#ddd;">${item.desc || ''}</div>`;
    const rect = el.getBoundingClientRect();
    tooltip.style.left = (rect.right + 10) + 'px';
    tooltip.style.top = rect.top + 'px';
}

function hideTooltip() {
    const t = document.getElementById('gameTooltip');
    if (t) t.style.display = 'none';
}

export function renderInventoryUI() {
    const modal = document.getElementById('inventoryModal');
    if (!modal || modal.style.display === 'none') return;

    // Update Doll
    const doll = document.getElementById('paperDoll');
    if (doll) doll.style.backgroundImage = `url('assets/images/visualnovel/${game.sex}_doll.png')`;

    // Helper to create draggable item
    const createItemEl = (item, source, idx) => {
        if (!item) return null;
        const div = document.createElement('div');
        div.className = 'inv-item-drag';
        div.style.width = '100%'; div.style.height = '100%';
        div.title = item.name;
        
        const asset = getAssetData(item.type, item.val || item.id, item.suit);
        div.style.backgroundImage = `url('assets/images/${asset.file}')`;
        div.style.backgroundSize = `${asset.sheetCount * 100}% 100%`;
        div.style.backgroundPosition = `${(asset.uv.u * asset.sheetCount) / (asset.sheetCount - 1) * 100}% 0%`;

        div.draggable = true;
        div.ondragstart = (e) => {
            e.dataTransfer.setData('text/plain', JSON.stringify({ source, idx }));
        };
        
        div.onclick = (e) => {
            e.stopPropagation();
            const desc = document.getElementById('invDescription');
            if(desc) desc.innerHTML = `<span style="color:#fff; font-weight:bold;">${item.name}</span> <span style="margin-left:10px; color:#666;">| ${item.desc || "No description."}</span>`;
        };

        // Touch Start Logic
        div.ontouchstart = (e) => {
            const touch = e.touches[0];
            window.touchDragData = { source, idx };
            window.touchDragMoved = false;
            
            if (window.touchDragGhost && window.touchDragGhost.parentNode) window.touchDragGhost.parentNode.removeChild(window.touchDragGhost);
            window.touchDragGhost = div.cloneNode(true);
            window.touchDragGhost.style.cssText = `position:fixed; width:64px; height:64px; opacity:0.8; z-index:10000; pointer-events:none; left:${touch.clientX - 32}px; top:${touch.clientY - 32}px;`;
            document.body.appendChild(window.touchDragGhost);
        };

        return div;
    };

    // Render Equipment
    ['head', 'chest', 'hands', 'legs', 'weapon'].forEach(slot => {
        const el = document.getElementById(`equipSlot_${slot}`);
        if (el) {
            el.innerHTML = '';
            const item = game.equipment[slot];
            if (item) el.appendChild(createItemEl(item, 'equipment', slot));
        }
    });

    // Render Backpack
    const invGrid = document.getElementById('invGrid');
    if (invGrid) {
        invGrid.innerHTML = '';
        while(game.backpack.length < 24) game.backpack.push(null);
        game.backpack.forEach((item, idx) => {
            const div = document.createElement('div');
            div.style.cssText = "border:1px solid #333; background:#0a0a0a; position:relative;";
            div.ondragover = (e) => e.preventDefault();
            div.ondrop = (e) => window.handleDrop(e, 'backpack', idx);
            div.setAttribute('data-slot-type', 'backpack');
            div.setAttribute('data-slot-idx', idx);
            if (item) div.appendChild(createItemEl(item, 'backpack', idx));
            invGrid.appendChild(div);
        });
    }

    // Render Hotbar
    const hotbarGrid = document.getElementById('hotbarGrid');
    if (hotbarGrid) {
        hotbarGrid.innerHTML = '';
        game.hotbar.forEach((item, idx) => {
            const div = document.createElement('div');
            div.style.cssText = "border:1px solid #333; background:#0a0a0a; position:relative;";
            div.ondragover = (e) => e.preventDefault();
            div.ondrop = (e) => window.handleDrop(e, 'hotbar', idx);
            div.setAttribute('data-slot-type', 'hotbar');
            div.setAttribute('data-slot-idx', idx);
            if (item) div.appendChild(createItemEl(item, 'hotbar', idx));
            hotbarGrid.appendChild(div);
        });
    }

    // Render Anvil
    [0, 1].forEach(idx => {
        const el = document.getElementById(`anvilSlot${idx}`);
        if (el) {
            el.innerHTML = '';
            const item = game.anvil[idx];
            if (item) el.appendChild(createItemEl(item, 'anvil', idx));
        }
    });

    // Render Trophies
    const trophyShelf = document.getElementById('invTrophyShelf');
    if (trophyShelf) {
        trophyShelf.innerHTML = '';
        if (game.slainStack.length === 0) {
            trophyShelf.innerHTML = '<div style="color:#666; font-size:0.8rem; font-style:italic; padding:10px; grid-column: 1 / -1;">No trophies collected.</div>';
        } else {
            game.slainStack.forEach((c, idx) => {
                const container = createTrophyElement(c, idx);
                trophyShelf.appendChild(container);
            });
        }
    }

    // Update Class Icon
    const classIcon = document.getElementById('classIconDisplay');
    if (classIcon) {
        const classMap = { 'knight': 0, 'rogue': 1, 'occultist': 2 };
        const cIdx = classMap[game.classId] || 0;
        classIcon.style.backgroundImage = "url('assets/images/classes.png')";
        classIcon.style.backgroundSize = "900% 100%";
        classIcon.style.backgroundPosition = `${cIdx * (100/8)}% 0%`;
    }
    
    // Update Coins
    const coinsEl = document.getElementById('invSoulCoins');
    if (coinsEl) coinsEl.innerText = game.soulCoins;
}

function createTrophyElement(c, idx) {
    let sheetFile = 'diamond.png'; 
    if (c.suit === '♥') sheetFile = 'heart.png';
    else if (c.suit === '♣') sheetFile = 'club.png';
    else if (c.suit === '♠') sheetFile = 'spade.png';
    else if (c.suit === '👺') sheetFile = 'menace.png';
    else if (c.suit === '💀') sheetFile = 'skull.png';
    
    const container = document.createElement('div');
    container.className = 'mini-trophy';
    container.style.cssText = "position:relative; width:80px; height:80px; cursor:pointer; border:1px solid #333; background:#080808; flex-shrink:0;";
    container.title = `Burn ${c.name} (+${c.val * 2} Fuel)`;
    container.onclick = () => burnTrophy(idx);

    const monster = document.createElement('div');
    let cellIdx = 0;
    if (c.val <= 3) cellIdx = 0;
    else if (c.val <= 5) cellIdx = 1;
    else if (c.val <= 7) cellIdx = 2;
    else if (c.val <= 9) cellIdx = 3;
    else if (c.val === 10) cellIdx = 4;
    else if (c.val === 11) cellIdx = 5;
    else if (c.val === 12) cellIdx = 6;
    else if (c.val === 13) cellIdx = 7;
    else if (c.val === 14) cellIdx = 8;
    const px = cellIdx * (100/8);

    monster.style.cssText = `width:100%; height:100%; background: url('assets/images/${sheetFile}'); background-size: 900% 100%; background-position: ${px}% 0%; filter: grayscale(0.2) contrast(1.2);`;
    container.appendChild(monster);
    return container;
}

export function setupInventoryUI() {
    let modal = document.getElementById('inventoryModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'inventoryModal';
        modal.className = 'modal-overlay';
        document.body.appendChild(modal);
    }
    
    // Determine doll image based on sex
    const sex = game.sex || 'm';
    
    modal.innerHTML = `
    <div class="inventory-layout-container" style="
        width: 850px; 
        max-width: 95vw;
        height: 700px; 
        background: #050505; 
        border: 2px solid var(--gold); 
        padding: 5px; 
        box-shadow: 0 0 20px #000; 
        display:grid; 
        grid-template-rows: 40px 1fr 180px; 
        gap: 5px;
        position: relative;
        font-family: 'Cinzel', serif;
        color: var(--gold);
    ">
    
        <!-- HEADER -->
        <div style="grid-row:1; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #333; padding:0 10px;">
            <div style="font-size:1.4rem; font-weight:bold; letter-spacing:1px; color:#d4af37;">INVENTORY</div>
            <div style="display:flex; gap:15px; align-items:center;">
                <div style="font-size:0.9rem; color:#aaa;">Coins: <span id="invSoulCoins" style="color:var(--gold);">0</span></div>
                <div onclick="sortInventory()" title="Sort Backpack" style="width:32px; height:32px; cursor:pointer; background-color:#d4af37; background-image:url('assets/images/sort.png'); background-repeat:no-repeat; background-position:center; background-size:contain; opacity:0.8; transition:opacity 0.2s; border:1px solid #9a7d25;"></div>
                <div onclick="sellAllLoot()" title="Sell All Loot" style="width:32px; height:32px; cursor:pointer; background-color:#d4af37; background-image:url('assets/images/money.png'); background-repeat:no-repeat; background-position:center; background-size:contain; opacity:0.8; transition:opacity 0.2s; border:1px solid #9a7d25;"></div>
                <div onclick="toggleInventory()" style="width:32px; height:32px; background:#d4af37; color:#000; border:1px solid #9a7d25; display:flex; align-items:center; justify-content:center; cursor:pointer; font-weight:bold; font-family:sans-serif;">X</div>
            </div>
        </div>

        <!-- MAIN CONTENT: DOLL vs BACKPACK -->
        <div style="grid-row:2; display:grid; grid-template-columns: 320px 1fr; gap:10px;">
            
            <!-- LEFT: PAPER DOLL -->
            <div style="position:relative; background:#111; border:1px solid #333;">
                <!-- Doll Image -->
                <div id="paperDoll" style="
                    width:100%; height:100%; 
                    background:url('assets/images/visualnovel/${sex}_doll.png') no-repeat center bottom; 
                    background-size:contain; 
                    opacity:0.8;">
                </div>
                
                <!-- Class Icon (Top Left) -->
                <div id="classIconDisplay" style="
                    position:absolute; top:10px; left:10px; 
                    width:64px; height:64px; 
                    border:2px solid var(--gold); 
                    background-color:rgba(0,0,0,0.5); 
                    box-shadow: 0 0 10px rgba(0,0,0,0.5);
                " title="Class"></div>

                <!-- Equip Slots (Absolute positioned over doll) -->
                <!-- Head -->
                <div id="equipSlot_head" data-slot-type="equipment" data-slot-idx="head" style="position:absolute; top:20px; left:50%; transform:translateX(-50%); width:64px; height:64px; border:1px solid var(--gold); background:rgba(0,0,0,0.3); box-shadow:0 0 10px gold inset;" ondrop="handleDrop(event, 'equipment', 'head')" ondragover="allowDrop(event)"></div>
                
                <!-- Chest -->
                <div id="equipSlot_chest" data-slot-type="equipment" data-slot-idx="chest" style="position:absolute; top:110px; left:50%; transform:translateX(-50%); width:64px; height:80px; border:1px solid var(--gold); background:rgba(0,0,0,0.3);" ondrop="handleDrop(event, 'equipment', 'chest')" ondragover="allowDrop(event)"></div>
                
                <!-- Hands -->
                <div id="equipSlot_hands" data-slot-type="equipment" data-slot-idx="hands" style="position:absolute; top:200px; left:20px; width:54px; height:54px; border:1px solid var(--gold); background:rgba(0,0,0,0.3);" ondrop="handleDrop(event, 'equipment', 'hands')" ondragover="allowDrop(event)"></div>
                
                <!-- Weapon -->
                <div id="equipSlot_weapon" data-slot-type="equipment" data-slot-idx="weapon" style="position:absolute; top:200px; right:20px; width:54px; height:54px; border:1px solid var(--gold); background:rgba(0,0,0,0.3);" ondrop="handleDrop(event, 'equipment', 'weapon')" ondragover="allowDrop(event)"></div>
                
                <!-- Legs -->
                <div id="equipSlot_legs" data-slot-type="equipment" data-slot-idx="legs" style="position:absolute; bottom:80px; left:50%; transform:translateX(-50%); width:64px; height:64px; border:1px solid var(--gold); background:rgba(0,0,0,0.3);" ondrop="handleDrop(event, 'equipment', 'legs')" ondragover="allowDrop(event)"></div>
                
            </div>

            <!-- RIGHT: BACKPACK & HOTBAR -->
            <div style="display:flex; flex-direction:column; gap:10px;">
                
                <!-- Backpack Label -->
                <div style="font-size:1.1rem; color:#d4af37; border-bottom:1px solid #333; padding-bottom:2px;">BACKPACK</div>
                
                <!-- 6x4 Grid -->
                <div id="invGrid" style="
                    display:grid; 
                    grid-template-columns: repeat(6, 1fr); 
                    grid-template-rows: repeat(4, 1fr); 
                    gap:4px; 
                    flex-grow:1;
                ">
                    <!-- JS Injects 24 slots here -->
                </div>

                <!-- Provisioning Label -->
                <div style="font-size:1.1rem; color:#d4af37; border-bottom:1px solid #333; padding-bottom:2px; margin-top:10px;">PROVISIONING (HOTBAR)</div>
                
                <!-- Hotbar Row -->
                <div id="hotbarGrid" style="display:grid; grid-template-columns: repeat(6, 1fr); gap:4px; height:60px;">
                    <!-- JS Injects 6 slots here -->
                </div>
            </div>
        </div>

        <!-- BOTTOM: DETAILS, TROPHY, ANVIL -->
        <div style="grid-row:3; display:grid; grid-template-columns: 1fr 200px; gap:10px; border-top:1px solid #444; padding-top:5px;">
            
            <!-- LEFT BOTTOM: Description + Trophies -->
            <div style="display:flex; flex-direction:column; gap:5px;">
                <!-- Description Line -->
                <div id="invDescription" style="
                    font-family: 'Special Elite', monospace; 
                    color:#aaa; 
                    font-size:0.9rem; 
                    padding:5px; 
                    background:#111; 
                    border:1px solid #333; 
                    height:24px; 
                    display:flex; align-items:center;
                    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
                ">Select an item to view details...</div>
                
                <!-- Trophies Label -->
                <div style="font-size:0.9rem; color:#d4af37; margin-top:5px;">TROPHIES (CLICK TO BURN)</div>
                
                <!-- Trophy Shelf (Vertical Scroll) -->
                <div id="invTrophyShelf" style="
                    display: grid; 
                    grid-template-columns: repeat(6, 80px);
                    gap:5px; 
                    overflow-y:auto; 
                    height:100px; 
                    background:#080808; 
                    border:1px solid #333; 
                    padding:5px;
                    scrollbar-width: thin;
                    scrollbar-color: #444 #111;
                    align-content: start;
                ">
                    <!-- JS Injects Trophies -->
                </div>
            </div>

            <!-- RIGHT BOTTOM: ANVIL -->
            <div style="display:flex; flex-direction:column; border:1px solid #444; background:#111; padding:5px;">
                <div style="text-align:center; color:#d4af37; margin-bottom:5px;">THE ANVIL</div>
                
                <!-- Anvil Slots -->
                <div style="display:flex; justify-content:center; gap:10px; margin-bottom:10px;">
                    <div id="anvilSlot0" data-slot-type="anvil" data-slot-idx="0" style="width:60px; height:60px; border:1px dashed #666; background:#222;" ondrop="handleDrop(event, 'anvil', '0')" ondragover="allowDrop(event)"></div>
                    <div id="anvilSlot1" data-slot-type="anvil" data-slot-idx="1" style="width:60px; height:60px; border:1px dashed #666; background:#222;" ondrop="handleDrop(event, 'anvil', '1')" ondragover="allowDrop(event)"></div>
                </div>
                
                <button class="v2-btn" onclick="window.forgeItems()" style="width:100%; font-size:0.9rem; padding:5px;">FORGE</button>
            </div>
        </div>

    </div>
    `;
}

// --- INVENTORY HELPERS ---
export function getFreeBackpackSlot() {
    return game.backpack.findIndex(s => s === null);
}

export function addToBackpack(item) {
    const idx = getFreeBackpackSlot();
    if (idx !== -1) {
        game.backpack[idx] = item;
        updateUI();
        return true;
    }
    return false;
}

export function addToHotbar(item) {
    const idx = game.hotbar.findIndex(s => s === null);
    if (idx !== -1) {
        game.hotbar[idx] = item;
        updateUI();
        return true;
    }
    return false;
}

export function recalcAP() {
    let total = 0;
    Object.values(game.equipment).forEach(i => {
        if (i && i.type === 'armor') total += i.ap;
    });
    game.maxAp = total;
    if (game.ap > game.maxAp) game.ap = game.maxAp;
}

// --- GLOBAL HANDLERS (Exposed to Window) ---
export function allowDrop(e) { e.preventDefault(); }
window.allowDrop = allowDrop;

export function handleDrop(e, targetType, targetIdx) {
    if (e && e.preventDefault) e.preventDefault();
    if (window.touchDragGhost) { 
        if (window.touchDragGhost.parentNode) document.body.removeChild(window.touchDragGhost);
        window.touchDragGhost = null;
    }
    
    let data;
    try {
        const raw = e.dataTransfer ? e.dataTransfer.getData('text/plain') : (window.touchDragData ? JSON.stringify(window.touchDragData) : null);
        if (!raw) return;
        data = JSON.parse(raw);
    } catch (err) { return; }
    
    const srcType = data.source;
    const srcIdx = data.idx;

    // Get Source Item
    let srcItem = null;
    if (srcType === 'equipment') srcItem = game.equipment[srcIdx];
    else if (srcType === 'backpack') srcItem = game.backpack[srcIdx];
    else if (srcType === 'hotbar') srcItem = game.hotbar[srcIdx];
    else if (srcType === 'anvil') srcItem = game.anvil[srcIdx];

    if (!srcItem) return;

    // Get Target Item
    let tgtItem = null;
    if (targetType === 'equipment') tgtItem = game.equipment[targetIdx];
    else if (targetType === 'backpack') tgtItem = game.backpack[targetIdx];
    else if (targetType === 'hotbar') tgtItem = game.hotbar[targetIdx];
    else if (targetType === 'anvil') tgtItem = game.anvil[targetIdx];

    // Validation
    const canEquip = (item, type, idx) => {
        if (!item) return true; 
        if (type === 'equipment') {
            if (idx === 'weapon') {
                if (item.type !== 'weapon') return false;
                if (game.classId === 'occultist' && !item.isSpell && item.val > 5) return false;
                return true;
            } else {
                return (item.type === 'armor' && item.slot === idx);
            }
        }
        return true;
    };

    if (!canEquip(srcItem, targetType, targetIdx)) { spawnFloatingText("Invalid Slot!", e.clientX, e.clientY, '#ff0000'); return; }
    if (tgtItem && !canEquip(tgtItem, srcType, srcIdx)) { spawnFloatingText("Cannot Swap!", e.clientX, e.clientY, '#ff0000'); return; }
    
    // Execute Swap
    if (srcType === 'equipment') game.equipment[srcIdx] = null;
    else if (srcType === 'backpack') game.backpack[srcIdx] = null;
    else if (srcType === 'hotbar') game.hotbar[srcIdx] = null;
    else if (srcType === 'anvil') game.anvil[srcIdx] = null;

    if (targetType === 'equipment') game.equipment[targetIdx] = null;
    else if (targetType === 'backpack') game.backpack[targetIdx] = null;
    else if (targetType === 'hotbar') game.hotbar[targetIdx] = null;
    else if (targetType === 'anvil') game.anvil[targetIdx] = null;

    if (targetType === 'equipment') game.equipment[targetIdx] = srcItem;
    else if (targetType === 'backpack') game.backpack[targetIdx] = srcItem;
    else if (targetType === 'hotbar') game.hotbar[targetIdx] = srcItem;
    else if (targetType === 'anvil') game.anvil[targetIdx] = srcItem;

    if (tgtItem) {
        if (srcType === 'equipment') game.equipment[srcIdx] = tgtItem;
        else if (srcType === 'backpack') game.backpack[srcIdx] = tgtItem;
        else if (srcType === 'hotbar') game.hotbar[srcIdx] = tgtItem;
        else if (srcType === 'anvil') game.anvil[srcIdx] = tgtItem;
    }

    if (srcType === 'equipment' || targetType === 'equipment') {
        recalcAP();
        if (game.equipment.weapon) game.weaponDurability = (game.equipment.weapon.durability !== undefined) ? game.equipment.weapon.durability : Infinity;
        else game.weaponDurability = Infinity;
    }

    window.touchDragData = null;
    updateUI();
    renderInventoryUI(); 
}
window.handleDrop = handleDrop;

window.toggleInventory = function () {
    const modal = document.getElementById('inventoryModal');
    if (modal.style.display === 'flex') {
        modal.style.display = 'none';
    } else {
        modal.style.display = 'flex';
        updateUI();
    }
};

window.openInventory = () => {
    if (!document.getElementById('inventoryModal')) setupInventoryUI();
    window.toggleInventory();
};

window.useHotbarItem = (idx) => {
    if (window.useItem) { window.useItem(idx); updateUI(); }
};

window.sortInventory = function () {
    const typePriority = { 'weapon': 1, 'armor': 2, 'potion': 3, 'item': 4 };
    game.backpack.sort((a, b) => {
        if (!a && !b) return 0;
        if (!a) return 1;
        if (!b) return -1;
        const typeA = typePriority[a.type] || 5;
        const typeB = typePriority[b.type] || 5;
        if (typeA !== typeB) return typeA - typeB;
        return (b.val || 0) - (a.val || 0);
    });
    updateUI();
    renderInventoryUI();
};

window.forgeItems = function () {
    const i1 = game.anvil[0];
    const i2 = game.anvil[1];
    if (!i1 || !i2) { spawnFloatingText("Need 2 items!", window.innerWidth/2, window.innerHeight/2, '#ff0000'); return; }
    if (i1.type !== i2.type) { spawnFloatingText("Types must match!", window.innerWidth/2, window.innerHeight/2, '#ff0000'); return; }
    
    const newVal = Math.min(16, i1.val + i2.val - 1);
    const survivor = (Math.random() < 0.5 ? i1 : i2);
    survivor.val = newVal;
    if (survivor.type === 'weapon') {
        survivor.name = survivor.name.split(' (')[0] + ` (${newVal})`;
        survivor.durability = Infinity;
    } else {
        survivor.name = survivor.name.split(' (')[0] + ` (${newVal})`;
    }
    game.anvil = [survivor, null];
    spawnFloatingText("Forged!", window.innerWidth/2, window.innerHeight/2, '#00ff00');
    updateUI();
};

window.sellAllLoot = function() {
    let soldCount = 0;
    let totalValue = 0;

    // Iterate backwards to safely remove items
    for (let i = game.backpack.length - 1; i >= 0; i--) {
        const item = game.backpack[i];
        // Sell only "Loot" items (weapons/armor/potions that aren't special/cursed?)
        // For now, let's sell EVERYTHING that isn't a key item or cursed.
        if (item && !item.isCursed && item.id !== 2 && item.id !== 8) { // Skip Key (2) and Tome (8)
            game.backpack[i] = null;
            game.soulCoins++;
            game.torchCharge += (item.val || 5);
            soldCount++;
            totalValue++;
        }
    }

    if (soldCount > 0) {
        spawnFloatingText(`Sold ${soldCount} items!`, window.innerWidth/2, window.innerHeight/2, '#ffd700');
        logMsg(`Sold ${soldCount} items for ${totalValue} coins.`);
        updateUI();
        renderInventoryUI();
    } else {
        spawnFloatingText("Nothing to sell!", window.innerWidth/2, window.innerHeight/2, '#aaa');
    }
};

export function burnTrophy(idx) {
    if (idx < 0 || idx >= game.slainStack.length) return;
    const card = game.slainStack[idx];
    
    // Remove from stack
    game.slainStack.splice(idx, 1);
    
    // Add Fuel
    const fuelGain = card.val * 2;
    game.torchCharge = Math.min(100, (game.torchCharge || 0) + fuelGain);

    logMsg(`Burned ${card.name}. +${fuelGain} Fuel.`);
    
    updateUI(); 
    renderInventoryUI();
}

// --- GLOBAL TOUCH HANDLERS ---
window.addEventListener('touchmove', (e) => {
    if (window.touchDragGhost) {
        e.preventDefault();
        window.touchDragMoved = true;
        const touch = e.touches[0];
        window.touchDragGhost.style.left = (touch.clientX - 32) + 'px';
        window.touchDragGhost.style.top = (touch.clientY - 32) + 'px';
    }
}, { passive: false });

window.addEventListener('touchend', (e) => {
    if (!window.touchDragGhost) return;
    const touch = e.changedTouches[0];

    window.touchDragGhost.style.display = 'none';
    const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);
    
    if (window.touchDragGhost.parentNode) document.body.removeChild(window.touchDragGhost);
    window.touchDragGhost = null;

    if (elemBelow && window.touchDragMoved) {
        const slot = elemBelow.closest('[data-slot-type]');
        if (slot) {
            handleDrop({ preventDefault: () => {} }, slot.dataset.slotType, slot.dataset.slotIdx);
        }
    }
    window.touchDragData = null;
    window.touchDragMoved = false;
});

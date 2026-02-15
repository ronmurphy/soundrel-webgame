export class CardDesigner {
    constructor() {
        this.active = false;
        this.modal = null;
        this.canvas = null;
        this.ctx = null;
        this.images = {}; // Image cache

        // Preview State (Data to render)
        this.previewState = {
            artPath: 'assets/images/animations/club_1.png',
            artIndex: 0,
            sheetCount: 25, // Default for animations
            textName: "Name Holder",
            textSuit: "♣",
            textVal: "1"
        };

        this.currentTemplate = 'common';
        this.showGrid = false;

        // Configuration for each rarity
        // Layers: Order of drawing (0 is bottom, last is top)
        this.config = {
            common: {
                frame: 'assets/images/cards/card_frame_common.png',
                layers: ['frame', 'art', 'text'], // Pop-out: Art on top of frame
                name: { x: 385, y: 1120, size: 70, color: '#ffffff', stroke: '#000000', strokeWidth: 6, font: 'Cinzel' },
                suit: { x: 100, y: 120, size: 120, color: '#ffffff', stroke: '#000000', strokeWidth: 4 },
                val: { x: 670, y: 120, size: 120, color: '#ffffff', stroke: '#000000', strokeWidth: 4 },
                art: { x: 385, y: 600, scale: 4.0 }
            },
            uncommon: {
                frame: 'assets/images/cards/card_frame_uncommon.png',
                layers: ['frame', 'art', 'text'],
                name: { x: 385, y: 1120, size: 70, color: '#ffaa00', stroke: '#000000', strokeWidth: 6, font: 'Cinzel' },
                suit: { x: 100, y: 120, size: 120, color: '#ffaa00', stroke: '#000000', strokeWidth: 4 },
                val: { x: 670, y: 120, size: 120, color: '#ffaa00', stroke: '#000000', strokeWidth: 4 },
                art: { x: 385, y: 600, scale: 4.0 }
            },
            rare: {
                frame: 'assets/images/cards/card_frame_rare.png',
                layers: ['art', 'frame', 'text'],
                name: { x: 385, y: 1120, size: 80, color: '#aa00ff', stroke: '#000000', strokeWidth: 8, font: 'Cinzel' },
                suit: { x: 100, y: 120, size: 130, color: '#aa00ff', stroke: '#000000', strokeWidth: 5 },
                val: { x: 670, y: 120, size: 130, color: '#aa00ff', stroke: '#000000', strokeWidth: 5 },
                art: { x: 385, y: 600, scale: 4.5 }
            },
            boss: {
                frame: 'assets/images/cards/card_frame_boss.png',
                layers: ['art', 'frame', 'text'], // Boss frame might need to be on top of art?
                name: { x: 385, y: 1150, size: 90, color: '#ffd700', stroke: '#440000', strokeWidth: 10, font: 'Cinzel' },
                suit: { x: 100, y: 120, size: 140, color: '#ffd700', stroke: '#000000', strokeWidth: 6 },
                val: { x: 670, y: 120, size: 140, color: '#ffd700', stroke: '#000000', strokeWidth: 6 },
                art: { x: 385, y: 600, scale: 5.0 }
            }
        };

        this.loadExternalConfig();
    }

    init() {
        if (this.modal) return;

        // Create Modal Container
        this.modal = document.createElement('div');
        this.modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(10,10,10,0.98); z-index: 30000; display: none;
            flex-direction: row; align-items: flex-start; justify-content: center;
            font-family: monospace; color: #fff; padding: 20px; box-sizing: border-box;
        `;

        // Left: Canvas Preview
        const previewContainer = document.createElement('div');
        previewContainer.style.cssText = "margin-right: 20px; display:flex; flex-direction:column; align-items:center;";

        this.canvas = document.createElement('canvas');
        this.canvas.width = 770;
        this.canvas.height = 1346;
        // Display at scale to fit screen
        const scale = Math.min(1, (window.innerHeight - 100) / 1346);
        this.canvas.style.width = `${770 * scale}px`;
        this.canvas.style.height = `${1346 * scale}px`;
        this.canvas.style.border = "2px solid #444";
        // this.canvas.style.background = "url('assets/images/block.png')"; // Checkerboard bg
        this.canvas.style.imageRendering = "pixelated";

        this.ctx = this.canvas.getContext('2d');
        previewContainer.appendChild(this.canvas);

        const gridToggle = document.createElement('div');
        gridToggle.innerHTML = `<label><input type="checkbox" id="cd_grid"> Show Grid</label>`;
        gridToggle.style.marginTop = "10px";
        previewContainer.appendChild(gridToggle);

        // Right: Controls
        const controls = document.createElement('div');
        controls.style.cssText = "width: 400px; background: #222; padding: 20px; border: 1px solid #d4af37; height: 100%; overflow-y: auto; display:flex; flex-direction:column; gap:15px;";

        // Generate Animation Options
        let animOptions = '';
        ['club', 'spade'].forEach(suit => {
            for (let i = 1; i <= 14; i++) {
                let name = i;
                if (i === 11) name = 'jack'; if (i === 12) name = 'queen'; if (i === 13) name = 'king'; if (i === 14) name = 'ace';
                animOptions += `<option value="animations/${suit}_${name}.png">${suit} ${name}</option>`;
            }
        });
        // Add Bosses
        animOptions += `<option value="animations/guardian_abyssal_maw.png">Guardian Maw</option>`;
        animOptions += `<option value="animations/guardian_ironclad_sentinel.png">Guardian Sentinel</option>`;
        animOptions += `<option value="animations/guardian_gargoyle.png">Guardian Gargoyle</option>`;

        controls.innerHTML = `
            <h2 style="color: #d4af37; margin: 0; text-align:center; border-bottom:1px solid #444; padding-bottom:10px;">Card Designer</h2>
            
            <!-- Template & Data -->
            <div class="cd-section">
                <label>Rarity Template:</label>
                <select id="cd_template" style="width: 100%; padding: 5px; background: #111; color: #fff; border: 1px solid #555;">
                    <option value="common">Common (1-5)</option>
                    <option value="uncommon">Uncommon (6-10)</option>
                    <option value="rare">Rare (11-14)</option>
                    <option value="boss">Boss</option>
                </select>
                
                <div style="display:flex; gap:5px; margin-top:5px;">
                    <input type="text" id="cd_text_name" placeholder="Name" value="${this.previewState.textName}" style="flex:2; padding:5px;">
                    <input type="text" id="cd_text_val" placeholder="Val" value="${this.previewState.textVal}" style="flex:1; padding:5px;">
                    <input type="text" id="cd_text_suit" placeholder="Suit" value="${this.previewState.textSuit}" style="flex:1; padding:5px;">
                </div>
            </div>

            <!-- Frame & Layering -->
            <div class="cd-section" style="background:#333; padding:10px; border-radius:4px;">
                <label style="color:#88ccff;">Layer Order:</label>
                <select id="cd_layer_select" style="width: 100%; padding: 5px; background: #111; color: #fff; border: 1px solid #555;">
                    <option value="art,frame,text">Standard (Art Behind Frame)</option>
                    <option value="frame,art,text">Pop-out (Art Over Frame)</option>
                </select>
            </div>

            <!-- Art Controls -->
            <div class="cd-section" style="background:#333; padding:10px; border-radius:4px;">
                <label style="color:#88ff88;">Sprite Art:</label>
                <select id="cd_art_select" style="width: 100%; padding: 5px; background: #111; color: #fff; border: 1px solid #555; margin-bottom:5px;">
                    <optgroup label="Animations (25 Frames)">
                        ${animOptions}
                    </optgroup>
                    <optgroup label="Static Assets">
                        <option value="diamond.png">Diamonds (Weapons)</option>
                        <option value="heart.png">Hearts (Potions)</option>
                        <option value="items.png">Items</option>
                        <option value="armor.png">Armor</option>
                    </optgroup>
                </select>
                
                <div style="display:flex; gap:10px;">
                    <div style="flex:1">
                        <label style="font-size:10px;">Frame Index</label>
                        <input type="range" id="cd_art_idx" min="0" max="24" value="0" style="width:100%">
                    </div>
                    <div style="flex:1">
                        <label style="font-size:10px;">Sheet Count</label>
                        <input type="number" id="cd_sheet_count" value="25" style="width:100%; background:#111; color:#fff; border:1px solid #555;">
                    </div>
                </div>
            </div>
            
            <!-- Dynamic Sliders -->
            <div id="cd_sliders" style="flex-grow:1; overflow-y:auto;">
                <!-- Sliders injected here -->
            </div>

            <div style="margin-top: auto; display: flex; gap: 10px;">
                <button id="cd_save" style="flex: 1; padding: 10px; background: #006600; color: white; border: none; cursor: pointer;">Export JSON</button>
                <button id="cd_import" style="flex: 1; padding: 10px; background: #004488; color: white; border: none; cursor: pointer;">Import</button>
                <button id="cd_close" style="flex: 1; padding: 10px; background: #660000; color: white; border: none; cursor: pointer;">Close</button>
            </div>
        `;

        this.modal.appendChild(previewContainer);
        this.modal.appendChild(controls);
        document.body.appendChild(this.modal);

        // Bind Events
        this.bindEvents();
        this.refreshControls();
    }

    bindEvents() {
        document.getElementById('cd_close').onclick = () => this.close();
        document.getElementById('cd_import').onclick = () => this.importJSON();
        document.getElementById('cd_save').onclick = () => this.exportJSON();

        document.getElementById('cd_grid').onchange = (e) => {
            this.showGrid = e.target.checked;
            this.draw();
        };

        document.getElementById('cd_template').onchange = (e) => {
            this.currentTemplate = e.target.value;
            this.refreshControls();
            this.draw();
        };

        // Frame & Layer
        document.getElementById('cd_layer_select').onchange = (e) => {
            this.config[this.currentTemplate].layers = e.target.value.split(',');
            this.draw();
        };

        // Text Inputs
        ['name', 'val', 'suit'].forEach(key => {
            document.getElementById(`cd_text_${key}`).oninput = (e) => {
                const val = e.target.value;
                if (key === 'name') this.previewState.textName = val;
                if (key === 'suit') this.previewState.textSuit = val;
                if (key === 'val') {
                    this.previewState.textVal = val;
                    this.autoSelectTemplate(val);
                }
                this.draw();
            };
        });

        // Art Controls
        document.getElementById('cd_art_select').onchange = (e) => {
            this.previewState.artPath = `assets/images/${e.target.value}`;
            // Auto-detect sheet count based on path
            if (e.target.value.includes('animations')) {
                this.previewState.sheetCount = 25;
                document.getElementById('cd_sheet_count').value = 25;
            } else {
                this.previewState.sheetCount = 9; // Standard strips
                document.getElementById('cd_sheet_count').value = 9;
            }
            this.draw();
        };

        document.getElementById('cd_art_idx').oninput = (e) => {
            this.previewState.artIndex = parseInt(e.target.value);
            this.draw();
        };
        document.getElementById('cd_sheet_count').oninput = (e) => {
            this.previewState.sheetCount = parseInt(e.target.value);
            this.draw();
        };
    }

    autoSelectTemplate(valStr) {
        const v = parseInt(valStr);
        if (isNaN(v)) return;

        let t = 'common';
        if (v >= 6 && v <= 10) t = 'uncommon';
        else if (v >= 11 && v <= 14) t = 'rare';
        else if (v > 14) t = 'boss';

        if (this.currentTemplate !== t) {
            this.currentTemplate = t;
            const sel = document.getElementById('cd_template');
            if (sel) sel.value = t;
            this.refreshControls();
        }
    }

    async loadExternalConfig() {
        try {
            const res = await fetch('assets/images/cards/card_layout.json?v=' + Date.now());
            if (res.ok) {
                const data = await res.json();
                // Deep merge to preserve defaults if JSON is partial
                Object.keys(data).forEach(rarity => {
                    if (this.config[rarity]) {
                        Object.keys(data[rarity]).forEach(prop => {
                            // If it's a nested object (like name, suit, val, art), merge it
                            if (typeof data[rarity][prop] === 'object' && !Array.isArray(data[rarity][prop]) && this.config[rarity][prop]) {
                                this.config[rarity][prop] = { ...this.config[rarity][prop], ...data[rarity][prop] };
                            } else {
                                // Otherwise overwrite (strings, arrays like layers)
                                this.config[rarity][prop] = data[rarity][prop];
                            }
                        });
                    } else {
                        this.config[rarity] = data[rarity];
                    }
                });
                console.log("Card Designer: Loaded external layout config.");
                if (this.active) {
                    this.refreshControls();
                    this.draw();
                }
            }
        } catch (e) {
            console.log("Card Designer: Using default layout.");
        }
    }

    refreshControls() {
        const container = document.getElementById('cd_sliders');
        container.innerHTML = '';
        const cfg = this.config[this.currentTemplate];

        // Update static selectors to match config
        // const framePath = cfg.frame ? cfg.frame.replace('assets/images/', '') : '';
        // const frameSel = document.getElementById('cd_frame_select');
        // if(frameSel && framePath) frameSel.value = framePath;

        const layerSel = document.getElementById('cd_layer_select');
        if (layerSel && cfg.layers) layerSel.value = cfg.layers.join(',');

        const addControl = (category, obj, key, min, max, step = 1) => {
            const div = document.createElement('div');
            div.style.marginBottom = '5px';
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; font-size:11px; color:#aaa;">
                    <span>${category} ${key}</span>
                    <span id="val_${category}_${key}">${obj[key]}</span>
                </div>
                <input type="range" min="${min}" max="${max}" step="${step}" value="${obj[key]}" style="width:100%" 
                    oninput="document.getElementById('val_${category}_${key}').innerText = this.value; window.cardDesigner.updateValue('${category}', '${key}', this.value)">
            `;
            container.appendChild(div);
        };

        const addSection = (title, color) => {
            const h = document.createElement('h4');
            h.innerText = title;
            h.style.cssText = `margin:15px 0 5px 0; color:${color}; border-bottom:1px solid #444; font-size:14px;`;
            container.appendChild(h);
        };

        // Art Settings
        addSection("Art Placement", "#88ff88");
        addControl('art', cfg.art, 'y', 0, 1346);
        addControl('art', cfg.art, 'scale', 0.1, 10.0, 0.1);

        // Text Settings
        addSection("Name Text", "#ffffff");
        addControl('name', cfg.name, 'x', 0, 770);
        addControl('name', cfg.name, 'y', 0, 1346);
        addControl('name', cfg.name, 'size', 10, 200);

        addSection("Suit Icon", "#ff8888");
        addControl('suit', cfg.suit, 'x', 0, 770);
        addControl('suit', cfg.suit, 'y', 0, 1346);
        addControl('suit', cfg.suit, 'size', 10, 200);

        addSection("Value Text", "#8888ff");
        addControl('val', cfg.val, 'x', 0, 770);
        addControl('val', cfg.val, 'y', 0, 1346);
        addControl('val', cfg.val, 'size', 10, 200);
    }

    updateValue(group, key, val) {
        this.config[this.currentTemplate][group][key] = parseFloat(val);
        this.draw();
    }

    loadImage(path) {
        if (!path) return null;
        if (this.images[path]) return this.images[path];

        const img = new Image();
        img.src = path;
        img.onload = () => this.draw();
        img.onerror = () => console.error(`[CardDesigner] FAILED to load: ${path}`);

        this.images[path] = img;
        return img;
    }

    open() {
        this.init();
        this.modal.style.display = 'flex';
        this.active = true;
        this.draw();
    }

    close() {
        if (this.modal) this.modal.style.display = 'none';
        this.active = false;
    }

    draw() {
        if (!this.ctx) return;
        const ctx = this.ctx;
        const cfg = this.config[this.currentTemplate];
        if (!cfg) return;

        // Clear Canvas
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Helper: Draw Art
        const drawArt = () => {
            const artImg = this.loadImage(this.previewState.artPath);
            ctx.save();
            ctx.translate(385, cfg.art.y); // Center X is 385
            ctx.scale(cfg.art.scale, cfg.art.scale);

            if (artImg && artImg.complete && artImg.naturalWidth > 0) {
                const sw = artImg.width / this.previewState.sheetCount;
                const sh = artImg.height;
                const sx = this.previewState.artIndex * sw;
                ctx.drawImage(artImg, sx, 0, sw, sh, -sw / 2, -sh / 2, sw, sh);
            } else {
                // Placeholder
                ctx.fillStyle = '#333';
                ctx.fillRect(-64, -64, 128, 128);
                ctx.fillStyle = '#555';
                ctx.textAlign = 'center';
                ctx.fillText("ART", 0, 0);
            }
            ctx.restore();
        };

        // Helper: Draw Frame
        const drawFrame = () => {
            const frameImg = this.loadImage(cfg.frame);
            if (frameImg && frameImg.complete && frameImg.naturalWidth > 0) {
                ctx.drawImage(frameImg, 0, 0, this.canvas.width, this.canvas.height);
            } else {
                ctx.strokeStyle = '#f00';
                ctx.lineWidth = 5;
                ctx.strokeRect(0, 0, this.canvas.width, this.canvas.height);
            }
        };

        // Helper: Draw Text
        const drawText = () => {
            const renderTxt = (text, settings) => {
                if (!settings) return;
                ctx.save();

                const size = settings.size || 40;
                const font = settings.font || 'Cinzel';
                const x = settings.x !== undefined ? settings.x : this.canvas.width / 2;
                const y = settings.y !== undefined ? settings.y : this.canvas.height / 2;

                ctx.font = `bold ${size}px ${font}, Arial, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                if (settings.shadow > 0) {
                    ctx.shadowColor = "black";
                    ctx.shadowBlur = settings.shadow;
                }

                if (settings.strokeWidth > 0) {
                    ctx.strokeStyle = settings.stroke || '#000';
                    ctx.lineWidth = settings.strokeWidth;
                    ctx.strokeText(text, x, y);
                }

                ctx.fillStyle = settings.color || '#fff';
                ctx.fillText(text, x, y);
                ctx.restore();
            };

            renderTxt(this.previewState.textName, cfg.name);
            renderTxt(this.previewState.textSuit, cfg.suit);
            renderTxt(this.previewState.textVal, cfg.val);
        };

        // Render Layers based on Order
        const layers = cfg.layers || ['art', 'frame', 'text'];
        layers.forEach(layer => {
            if (layer === 'art') drawArt();
            if (layer === 'frame') drawFrame();
            if (layer === 'text') drawText();
        });

        // Draw Grid Overlay
        if (this.showGrid) {
            ctx.strokeStyle = 'rgba(0, 255, 255, 0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            // Center Line
            ctx.moveTo(385, 0); ctx.lineTo(385, 1346);
            // Horizontal Lines
            for (let y = 0; y < 1346; y += 100) { ctx.moveTo(0, y); ctx.lineTo(770, y); }
            ctx.stroke();
        }
    }

    exportJSON() {
        console.log(JSON.stringify(this.config, null, 2));
        alert("Config dumped to Console! Copy it to assets/images/cards/card_layout.json");
    }

    importJSON() {
        const str = prompt("Paste JSON config here:");
        if (!str) return;
        try {
            let data = JSON.parse(str);
            this.config = data;
            this.refreshControls();
            this.draw();
        } catch (e) {
            alert("Invalid JSON!");
            console.error(e);
        }
    }
}

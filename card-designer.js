export class CardDesigner {
    constructor() {
        this.active = false;
        this.modal = null;
        this.canvas = null;
        this.ctx = null;
        this.images = {}; // Image cache
        
        // Preview State (What we are looking at right now)
        this.previewState = {
            artPath: 'assets/images/animations/club_1.png', // Default to an animation
            artIndex: 0, // Frame 0
            sheetCount: 25, // Default to 25 frames for animations
            textName: "Goblin Grunt",
            textSuit: "♣",
            textVal: "3"
        };

        this.currentTemplate = 'common';

        // High-Res Configuration (770 x 1346)
        // Defaults based on standard poker card layout scaled up
        this.config = {
            common: {
                frame: 'assets/images/cards/card_frame_common.png',
                artBehind: true,
                name: { x: 385, y: 1120, size: 70, color: '#ffffff', stroke: '#000000', strokeWidth: 6, font: 'Cinzel' },
                suit: { x: 100, y: 120, size: 120, color: '#ffffff', stroke: '#000000', strokeWidth: 4 },
                val: { x: 670, y: 120, size: 120, color: '#ffffff', stroke: '#000000', strokeWidth: 4 },
                art: { x: 385, y: 600, scale: 4.0 }
            },
            uncommon: {
                frame: 'assets/images/cards/card_frame_uncommon.png',
                artBehind: true,
                name: { x: 385, y: 1120, size: 70, color: '#ffaa00', stroke: '#000000', strokeWidth: 6, font: 'Cinzel' },
                suit: { x: 100, y: 120, size: 120, color: '#ffaa00', stroke: '#000000', strokeWidth: 4 },
                val: { x: 670, y: 120, size: 120, color: '#ffaa00', stroke: '#000000', strokeWidth: 4 },
                art: { x: 385, y: 600, scale: 4.0 }
            },
            rare: {
                frame: 'assets/images/cards/card_frame_rare.png',
                artBehind: true,
                name: { x: 385, y: 1120, size: 80, color: '#aa00ff', stroke: '#000000', strokeWidth: 8, font: 'Cinzel' },
                suit: { x: 100, y: 120, size: 130, color: '#aa00ff', stroke: '#000000', strokeWidth: 5 },
                val: { x: 670, y: 120, size: 130, color: '#aa00ff', stroke: '#000000', strokeWidth: 5 },
                art: { x: 385, y: 600, scale: 4.5 }
            },
            boss: {
                frame: 'assets/images/cards/card_frame_boss.png',
                artBehind: true,
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
            background: rgba(0,0,0,0.95); z-index: 30000; display: none;
            flex-direction: row; align-items: center; justify-content: center;
            font-family: monospace; color: #fff;
        `;

        // Left: Canvas Preview
        const previewContainer = document.createElement('div');
        previewContainer.style.cssText = "margin-right: 40px; border: 2px solid #444; background: #000; display:flex; align-items:center; justify-content:center;";
        
        this.canvas = document.createElement('canvas');
        this.canvas.width = 770;
        this.canvas.height = 1346; 
        // Display at 50% scale to fit screen
        this.canvas.style.width = "385px"; 
        this.canvas.style.height = "673px";
        this.canvas.style.imageRendering = "pixelated";
        
        this.ctx = this.canvas.getContext('2d');
        previewContainer.appendChild(this.canvas);

        // Right: Controls
        const controls = document.createElement('div');
        controls.style.cssText = "width: 360px; background: #222; padding: 20px; border: 1px solid #d4af37; height: 90%; overflow-y: auto; display:flex; flex-direction:column; gap:10px;";
        
        controls.innerHTML = `
            <h2 style="color: #d4af37; margin: 0 0 10px 0; text-align:center;">Card Designer</h2>
            
            <div style="background:#333; padding:10px; border-radius:4px;">
                <label>Template (Rarity):</label>
                <select id="cd_template" style="width: 100%; padding: 5px; background: #111; color: #fff; border: 1px solid #555;">
                    <option value="common">Common (1-5)</option>
                    <option value="uncommon">Uncommon (6-10)</option>
                    <option value="rare">Rare (11-14)</option>
                    <option value="boss">Boss</option>
                </select>
            </div>

            <div style="background:#333; padding:10px; border-radius:4px;">
                <label>Card Data:</label>
                <div style="display:flex; gap:5px; margin-bottom:5px;">
                    <input type="text" id="cd_text_name" placeholder="Name" value="${this.previewState.textName}" style="flex:2; padding:5px;">
                    <input type="text" id="cd_text_val" placeholder="Val" value="${this.previewState.textVal}" style="flex:1; padding:5px;">
                    <input type="text" id="cd_text_suit" placeholder="Suit" value="${this.previewState.textSuit}" style="flex:1; padding:5px;">
                </div>
            </div>

            <div style="background:#333; padding:10px; border-radius:4px;">
                <label>Preview Art:</label>
                <select id="cd_art_select" style="width: 100%; padding: 5px; background: #111; color: #fff; border: 1px solid #555; margin-bottom:5px;">
                    <optgroup label="Animations (25 Frames)">
                        <option value="animations/club_1.png">Club 1 (Beast)</option>
                        <option value="animations/club_jack.png">Club Jack (Boss)</option>
                        <option value="animations/spade_1.png">Spade 1 (Undead)</option>
                        <option value="animations/spade_king.png">Spade King (Boss)</option>
                        <option value="animations/guardian_abyssal_maw.png">Guardian Maw</option>
                    </optgroup>
                    <optgroup label="Static Assets">
                        <option value="diamond.png">Diamonds (Weapons)</option>
                        <option value="heart.png">Hearts (Potions)</option>
                        <option value="items.png">Items</option>
                        <option value="armor.png">Armor</option>
                    </optgroup>
                </select>
                <div style="display:flex; justify-content:space-between; font-size:11px; color:#aaa;">
                    <span>Frame Index</span>
                    <span id="val_art_idx">0</span>
                </div>
                <input type="range" id="cd_art_idx" min="0" max="24" value="0" style="width:100%">
                
                <div style="display:flex; justify-content:space-between; font-size:11px; color:#aaa;">
                    <span>Sheet Count</span>
                    <span id="val_sheet_count">25</span>
                </div>
                <input type="range" id="cd_sheet_count" min="1" max="25" value="25" style="width:100%">
            </div>
            
            <div id="cd_sliders">
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
        document.getElementById('cd_close').onclick = () => this.close();
        document.getElementById('cd_import').onclick = () => this.importJSON();
        document.getElementById('cd_save').onclick = () => this.exportJSON();
        
        document.getElementById('cd_template').onchange = (e) => {
            this.currentTemplate = e.target.value;
            this.refreshControls();
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
                document.getElementById('val_sheet_count').innerText = 25;
            } else {
                this.previewState.sheetCount = 9; // Standard strips
                document.getElementById('cd_sheet_count').value = 9;
                document.getElementById('val_sheet_count').innerText = 9;
            }
            this.draw();
        };

        document.getElementById('cd_art_idx').oninput = (e) => {
            this.previewState.artIndex = parseInt(e.target.value);
            document.getElementById('val_art_idx').innerText = e.target.value;
            this.draw();
        };
        document.getElementById('cd_sheet_count').oninput = (e) => {
            this.previewState.sheetCount = parseInt(e.target.value);
            document.getElementById('val_sheet_count').innerText = e.target.value;
            this.draw();
        };

        this.refreshControls();
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
                // Merge loaded config with defaults to ensure missing keys don't break
                this.config = { ...this.config, ...data };
                console.log("Card Designer: Loaded external layout config.");
            }
        } catch (e) {
            console.log("Card Designer: Using default layout.");
        }
    }

    refreshControls() {
        const container = document.getElementById('cd_sliders');
        container.innerHTML = '';
        const cfg = this.config[this.currentTemplate];

        const addControl = (category, obj, key, min, max, step = 1) => {
            const div = document.createElement('div');
            div.style.marginBottom = '5px';
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; font-size:12px; color:#aaa;">
                    <span>${category} ${key}</span>
                    <span id="val_${category}_${key}">${obj[key]}</span>
                </div>
                <input type="range" min="${min}" max="${max}" step="${step}" value="${obj[key]}" style="width:100%" 
                    oninput="document.getElementById('val_${category}_${key}').innerText = this.value; window.cardDesigner.updateValue('${category}', '${key}', this.value)">
            `;
            container.appendChild(div);
        };

        const addSection = (title) => {
            const h = document.createElement('h4');
            h.innerText = title;
            h.style.cssText = "margin:15px 0 5px 0; color:#ddd; border-bottom:1px solid #444; font-size:14px;";
            container.appendChild(h);
        };

        // Art Settings
        addSection("Art Placement");
        const cbDiv = document.createElement('div');
        cbDiv.style.marginBottom = '10px';
        cbDiv.innerHTML = `
            <div style="display:flex; align-items:center; font-size:12px; color:#aaa;">
                <input type="checkbox" id="cb_artBehind" ${cfg.artBehind ? 'checked' : ''} 
                    onchange="window.cardDesigner.updateValue('root', 'artBehind', this.checked)">
                <label for="cb_artBehind" style="margin-left:5px; color:#fff;">Art Behind Frame</label>
            </div>
        `;
        container.appendChild(cbDiv);
        addControl('art', cfg.art, 'y', 0, 1346);
        addControl('art', cfg.art, 'scale', 0.1, 10.0, 0.1);

        // Text Settings
        addSection("Name Text");
        addControl('name', cfg.name, 'x', 0, 770);
        addControl('name', cfg.name, 'y', 0, 1346);
        addControl('name', cfg.name, 'size', 10, 200);

        addSection("Suit Icon");
        addControl('suit', cfg.suit, 'x', 0, 770);
        addControl('suit', cfg.suit, 'y', 0, 1346);
        addControl('suit', cfg.suit, 'size', 10, 200);

        addSection("Value Text");
        addControl('val', cfg.val, 'x', 0, 770);
        addControl('val', cfg.val, 'y', 0, 1346);
        addControl('val', cfg.val, 'size', 10, 200);
    }

    updateValue(group, key, val) {
        if (group === 'root') {
            this.config[this.currentTemplate][key] = val;
        } else {
            this.config[this.currentTemplate][group][key] = parseFloat(val);
        }
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
        
        // Fill black background to see transparency
        ctx.fillStyle = '#000'; 
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Helper: Draw Art
        const drawArt = () => {
            const artImg = this.loadImage(this.previewState.artPath);
            ctx.save();
            ctx.translate(385, cfg.art.y); // Center X is 385
            ctx.scale(cfg.art.scale, cfg.art.scale);
            
            if (artImg && artImg.complete && artImg.naturalWidth > 0) {
                // Sprite Sheet Logic
                // If sheetCount is 25, width of one cell is totalWidth / 25
                const sw = artImg.width / this.previewState.sheetCount;
                const sh = artImg.height;
                const sx = this.previewState.artIndex * sw;
                
                // Draw centered at origin (which is translated to 385, art.y)
                ctx.drawImage(artImg, sx, 0, sw, sh, -sw/2, -sh/2, sw, sh);
            } else {
                // Placeholder box
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
                // Fallback frame
                ctx.strokeStyle = this.currentTemplate === 'rare' ? 'gold' : '#888';
                ctx.lineWidth = 10;
                ctx.strokeRect(5, 5, 760, 1336);
            }
        };

        // Layering
        if (cfg.artBehind) {
            drawArt();
            drawFrame();
        } else {
            drawFrame();
            drawArt();
        }

        // Helper: Draw Text
        const drawText = (text, settings) => {
            ctx.font = `bold ${settings.size}px ${settings.font || 'Arial'}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            if (settings.strokeWidth > 0) {
                ctx.strokeStyle = settings.stroke || '#000';
                ctx.lineWidth = settings.strokeWidth;
                ctx.strokeText(text, settings.x, settings.y);
            }
            
            ctx.fillStyle = settings.color;
            ctx.fillText(text, settings.x, settings.y);
        };

        drawText(this.previewState.textName, cfg.name);
        drawText(this.previewState.textSuit, cfg.suit);
        drawText(this.previewState.textVal, cfg.val);
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

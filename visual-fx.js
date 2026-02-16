export const fxState = {
    use3dModel: false
};

const fxCanvas = document.getElementById('fxCanvas');
const fxCtx = fxCanvas ? fxCanvas.getContext('2d') : null;
const uiFxCanvas = document.getElementById('uiFxCanvas');
const uiFxCtx = uiFxCanvas ? uiFxCanvas.getContext('2d') : null;

let particles = [];
let uiParticles = [];
const particlePool = [];
const uiParticlePool = [];
const MAX_PARTICLES = 600;
const MAX_UI_PARTICLES = 400;

let screenShake = { intensity: 0, duration: 0 };

const fxImageCache = new Map();

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

class ImageParticle extends Particle {
    constructor(x, y, img, opts = {}) {
        super(x, y, null);
        this.reset(x, y, img, opts);
    }
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
        this.filter = opts.filter || null;
        this.intensity = opts.intensity || 1.0;
        this.noGravity = opts.noGravity || false;
    }
    update() {
        this.x += this.vx; this.y += this.vy;
        if (!this.noGravity) this.vy += 0.1;
        this.rotation += this.angularVel;
        this.life -= this.decay;
    }
    draw(ctx) {
        if (!this.img || !this.img.complete) return;
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        if (this.filter) ctx.filter = this.filter;
        ctx.globalAlpha = Math.max(0, this.life) * Math.min(1.0, this.intensity);
        ctx.globalCompositeOperation = this.blend;
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);
        const s = this.size;
        ctx.drawImage(this.img, -s / 2, -s / 2, s, s);
        if (this.tint) {
            ctx.globalCompositeOperation = 'source-atop';
            ctx.fillStyle = this.tint;
            ctx.globalAlpha = Math.max(0, this.life) * 0.6 * this.intensity;
            ctx.fillRect(-s / 2, -s / 2, s, s);
        }
        ctx.restore();
        ctx.globalCompositeOperation = 'source-over';
        ctx.filter = 'none';
    }
}

function loadFXImage(name) {
    const path = `assets/images/textures/${name}`;
    if (fxImageCache.has(path)) return fxImageCache.get(path);
    const img = new Image();
    img.src = path;
    fxImageCache.set(path, img);
    return img;
}

export function preloadFXTextures() {
    const list = ['slash_02.png', 'spark_01.png', 'twirl_01.png', 'circle_03.png', 'flame_03.png', 'muzzle_02.png', 'trace_01.png', 'scorch_03.png', 'star_04.png'];
    list.forEach(n => loadFXImage(n));
}

export function spawnParticles(x, y, color, count = 20) {
    for (let i = 0; i < count; i++) particles.push(new Particle(x, y, color));
}

export function spawnDOMParticles(name, x, y, count = 10, opts = {}) {
    if (fxState.use3dModel) return;
    const container = document.createElement('div');
    container.className = 'ui-fx';
    document.body.appendChild(container);

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

        requestAnimationFrame(() => {
            el.style.opacity = '1';
            const dx = (Math.random() - 0.5) * (opts.dx || 120);
            const dy = -30 - Math.random() * (opts.dy || 120);
            const rot = (Math.random() - 0.5) * 720;
            el.style.transform = `translate(${dx}px, ${dy}px) scale(${0.4 + Math.random() * 1.2}) rotate(${rot}deg)`;
            el.style.opacity = '0';
        });
    }
    setTimeout(() => { if (container.parentNode) container.parentNode.removeChild(container); }, opts.life || 1000);
}

export function spawnDOMProjectile(name, fromX, fromY, toX, toY, count = 6, opts = {}) {
    if (fxState.use3dModel) return Promise.resolve();
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

            requestAnimationFrame(() => {
                const dx = toX - sx + (Math.random() - 0.5) * (opts.spread || 40);
                const dy = toY - sy + (Math.random() - 0.5) * (opts.spread || 40);
                const rot = (Math.random() - 0.5) * 720;
                el.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(${0.6 + Math.random() * 0.8})`;
                el.style.opacity = '0.01';
            });

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

export function spawnTextureParticles(name, x, y, count = 12, opts = {}) {
    if (fxState.use3dModel) return;
    const img = loadFXImage(name);
    while (particles.length + count > MAX_PARTICLES) {
        const old = particles.shift(); if (old) particlePool.push(old);
    }
    for (let i = 0; i < count; i++) {
        const pOpts = { ...opts, size: opts.size || (20 + Math.random() * 40) };
        if (opts.sizeRange) pOpts.size = opts.sizeRange[0] + Math.random() * (opts.sizeRange[1] - opts.sizeRange[0]);
        
        const sx = x + (Math.random() - 0.5) * (opts.spread || 40);
        const sy = y + (Math.random() - 0.5) * (opts.spread || 40);
        let p = particlePool.pop();
        if (p) p.reset(sx, sy, img, pOpts);
        else p = new ImageParticle(sx, sy, img, pOpts);
        particles.push(p);
    }
}

export function spawnUITextureParticles(name, x, y, count = 12, opts = {}) {
    if (fxState.use3dModel) return;
    const img = loadFXImage(name);
    while (uiParticles.length + count > MAX_UI_PARTICLES) {
        const old = uiParticles.shift(); if (old) uiParticlePool.push(old);
    }
    for (let i = 0; i < count; i++) {
        const pOpts = { ...opts, size: opts.size || (20 + Math.random() * 40), blend: opts.blend || 'lighter' };
        if (opts.sizeRange) pOpts.size = opts.sizeRange[0] + Math.random() * (opts.sizeRange[1] - opts.sizeRange[0]);

        const sx = x + (Math.random() - 0.5) * (opts.spread || 40);
        const sy = y + (Math.random() - 0.5) * (opts.spread || 40);
        let p = uiParticlePool.pop();
        if (p) p.reset(sx, sy, img, pOpts);
        else p = new ImageParticle(sx, sy, img, pOpts);
        uiParticles.push(p);
    }
}

export function spawnAboveModalTexture(name, x, y, count = 12, opts = {}) {
    if (fxState.use3dModel) return;
    const modal = document.getElementById('combatModal');
    const modalOpen = modal && (modal.style.display === 'flex' || modal.style.display === 'block');
    if (modalOpen && uiFxCanvas) {
        spawnUITextureParticles(name, x, y, count, opts);
    } else if (modalOpen) {
        spawnDOMParticles(name, x, y, count, opts);
    } else {
        spawnTextureParticles(name, x, y, count, opts);
    }
}

export function spawnUIProjectile(name, fromX, fromY, toX, toY, count = 8, opts = {}) {
    if (fxState.use3dModel) return Promise.resolve();
    const img = loadFXImage(name);
    const duration = opts.duration || 420;
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
    return new Promise(resolve => setTimeout(() => resolve(), duration));
}

export function spawnUIHitFlash(x, y, duration = 280) {
    if (window.HIT_FLASH_ENABLED === undefined) window.HIT_FLASH_ENABLED = false;
    if (fxState.use3dModel || !window.HIT_FLASH_ENABLED) return;

    const el = document.createElement('div');
    el.className = 'ui-hit-flash';
    const hitEl = document.elementFromPoint(Math.round(x), Math.round(y));
    const isOverHp = hitEl && (hitEl.closest && (hitEl.closest('#hpValueModal') || hitEl.closest('#hpValueSidebar')));
    if (isOverHp) { el.classList.add('small'); duration = Math.min(duration, 140); }

    const nx = Math.round((x / window.innerWidth) * 100);
    const ny = Math.round((y / window.innerHeight) * 100);
    el.style.setProperty('--fx-x', `${nx}%`);
    el.style.setProperty('--fx-y', `${ny}%`);
    document.body.appendChild(el);

    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 240); }, duration);
}

export function triggerShake(intensity, duration) {
    screenShake.intensity = intensity;
    screenShake.duration = duration;
}

export function updateFX() {
    if (fxCtx) fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);

    if (screenShake.duration > 0) {
        const sx = (Math.random() - 0.5) * screenShake.intensity;
        const sy = (Math.random() - 0.5) * screenShake.intensity;
        const containers = [document.getElementById('v3-container'), document.getElementById('combatModal')];
        containers.forEach(c => { if (c) c.style.transform = `translate(${sx}px, ${sy}px)`; });
        screenShake.duration--;
        if (screenShake.duration <= 0) containers.forEach(c => { if (c) c.style.transform = ''; });
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.update();
        if (p.life <= 0) { particles.splice(i, 1); particlePool.push(p); }
        else if (fxCtx) p.draw(fxCtx);
    }
}

export function updateUIFX() {
    if (!uiFxCanvas || !uiFxCtx) return;
    uiFxCtx.clearRect(0, 0, uiFxCanvas.width, uiFxCanvas.height);

    while (uiParticles.length > MAX_UI_PARTICLES) {
        const old = uiParticles.shift(); if (old) uiParticlePool.push(old);
    }

    for (let i = uiParticles.length - 1; i >= 0; i--) {
        const p = uiParticles[i];
        if (!p.noGravity) p.vy += 0.1;
        p.update();
        if (p.life <= 0) { uiParticles.splice(i, 1); uiParticlePool.push(p); }
        else p.draw(uiFxCtx);
    }
}

export function resizeFX() {
    if (fxCanvas) { fxCanvas.width = window.innerWidth; fxCanvas.height = window.innerHeight; }
    if (uiFxCanvas) { uiFxCanvas.width = window.innerWidth; uiFxCanvas.height = window.innerHeight; }
}

// Wisps (Ambient)
let wisps = [];
class Wisp {
    constructor() {
        this.x = Math.random() * window.innerWidth;
        this.y = Math.random() * window.innerHeight;
        this.vx = (Math.random() - 0.5) * 0.5;
        this.vy = (Math.random() - 0.5) * 0.5;
        this.size = Math.random() * 2 + 1;
        this.color = Math.random() > 0.5 ? 'rgba(200, 255, 255, 0.4)' : 'rgba(255, 255, 200, 0.3)';
        this.pulse = Math.random() * Math.PI;
    }
    update() {
        this.x += this.vx; this.y += this.vy;
        this.pulse += 0.05;
        if (this.x < 0) this.x = window.innerWidth;
        if (this.x > window.innerWidth) this.x = 0;
        if (this.y < 0) this.y = window.innerHeight;
        if (this.y > window.innerHeight) this.y = 0;
    }
    draw(ctx) {
        const alpha = 0.3 + Math.sin(this.pulse) * 0.2;
        ctx.fillStyle = this.color.replace('0.4', alpha).replace('0.3', alpha);
        ctx.globalAlpha = alpha;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1.0;
    }
}

export function updateWisps() {
    if (!fxCtx) return;
    if (wisps.length < 15) wisps.push(new Wisp());
    wisps.forEach(w => { w.update(); w.draw(fxCtx); });
}
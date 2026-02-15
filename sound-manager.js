export class SoundManager {
    constructor() {
        this.ctx = null;
        this.buffers = new Map();
        this.activeLoops = new Map(); // key -> { source, gain }
        this.masterGain = null;
        this.musicFilter = null;
        this.musicGain = null;
        this.sfxGain = null;
        this.initialized = false;
    }

    // Must be called after a user gesture (click)
    init() {
        if (!this.initialized || !this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.ctx.createGain();
            this.masterGain.connect(this.ctx.destination);
            this.masterGain.gain.value = 0.4; // Default master volume

            // Music Channel
            this.musicGain = this.ctx.createGain();
            this.musicGain.connect(this.masterGain);

            // SFX Channel
            this.sfxGain = this.ctx.createGain();
            this.sfxGain.connect(this.masterGain);

            // Music Filter (Low Pass for "Muffled" effect)
            this.musicFilter = this.ctx.createBiquadFilter();
            this.musicFilter.type = 'lowpass';
            this.musicFilter.frequency.value = 22000; // Start fully open (clear)
            this.musicFilter.connect(this.musicGain);

            this.initialized = true;
        }
        // Always try to resume if suspended (handles preloading vs user gesture timing)
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    async load(name, url) {
        if (!this.ctx) this.init();
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
            this.buffers.set(name, audioBuffer);
            // console.log(`Sound loaded: ${name}`);
        } catch (error) {
            console.warn(`SoundManager: Could not load ${name} from ${url}`, error);
        }
    }

    play(name, opts = {}) {
        if (!this.ctx || !this.buffers.has(name)) return null;
        
        const source = this.ctx.createBufferSource();
        source.buffer = this.buffers.get(name);
        
        const gain = this.ctx.createGain();
        gain.gain.value = opts.volume !== undefined ? opts.volume : 1.0;
        
        source.connect(gain);
        
        if (opts.isMusic) {
            gain.connect(this.musicFilter);
        } else {
            gain.connect(this.sfxGain);
        }
        
        source.loop = opts.loop || false;
        if (opts.rate) source.playbackRate.value = opts.rate;
        
        source.start(0);
        return { source, gain };
    }

    startLoop(id, name, opts = {}) {
        if (this.activeLoops.has(id)) return; // Already playing
        const sound = this.play(name, { ...opts, loop: true });
        if (sound) this.activeLoops.set(id, sound);
    }

    stopLoop(id, fadeDuration = 0.5) {
        if (this.activeLoops.has(id) && this.ctx) {
            const { source, gain } = this.activeLoops.get(id);
            const now = this.ctx.currentTime;
            gain.gain.setValueAtTime(gain.gain.value, now);
            gain.gain.linearRampToValueAtTime(0, now + fadeDuration);
            source.stop(now + fadeDuration);
            this.activeLoops.delete(id);
        }
    }

    setLoopVolume(id, vol) {
        if (this.activeLoops.has(id) && this.ctx) {
            const { gain } = this.activeLoops.get(id);
            // Smooth transition to new volume
            gain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.1);
        }
    }

    setMusicMuffled(isMuffled) {
        if (this.musicFilter && this.ctx) {
            const freq = isMuffled ? 600 : 22000;
            this.musicFilter.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.3);
        }
    }

    setMasterVolume(val) {
        if (this.masterGain) this.masterGain.gain.setTargetAtTime(val, this.ctx.currentTime, 0.1);
    }

    setMusicMute(muted) {
        if (this.musicGain) this.musicGain.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.1);
    }

    setSFXMute(muted) {
        if (this.sfxGain) this.sfxGain.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.1);
    }

    // Generate simple synthesized sounds so no files are needed
    loadPlaceholders() {
        if (!this.ctx) this.init();

        const createBuffer = (seconds, fn) => {
            const rate = this.ctx.sampleRate;
            const buf = this.ctx.createBuffer(1, rate * seconds, rate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < data.length; i++) {
                data[i] = fn(i, i / rate);
            }
            return buf;
        };

        // 1. Torch/Bonfire (Brown Noise Loop)
        // Brad note > people complained of this sound, so i commented it out.
        // if (!this.buffers.has('torch_loop')) {
        //     let lastOut = 0;
        //     const buf = createBuffer(2.0, () => {
        //         const white = Math.random() * 2 - 1;
        //         lastOut = (lastOut + (0.02 * white)) / 1.02;
        //         return lastOut * 3.5; 
        //     });
        //     this.buffers.set('torch_loop', buf);
        //     this.buffers.set('bonfire_loop', buf);
        // }

        // 2. Card Flip (Short high-pitch slide)
        if (!this.buffers.has('card_flip')) {
            this.buffers.set('card_flip', createBuffer(0.1, (i, t) => {
                return (Math.random() * 2 - 1) * (1 - t/0.1) * 0.5;
            }));
        }

        // 3. Attacks (Noise bursts)
        if (!this.buffers.has('attack_slash')) {
            this.buffers.set('attack_slash', createBuffer(0.3, (i, t) => {
                return (Math.random() * 2 - 1) * Math.pow(1 - t/0.3, 2);
            }));
        }
        if (!this.buffers.has('attack_blunt')) {
            this.buffers.set('attack_blunt', createBuffer(0.2, (i, t) => {
                // Lower pitch noise
                return (Math.random() > 0.5 ? 0.5 : -0.5) * Math.pow(1 - t/0.2, 2);
            }));
        }

        // 4. Footstep (Short thud)
        if (!this.buffers.has('footstep')) {
            this.buffers.set('footstep', createBuffer(0.1, (i, t) => {
                return (Math.random() * 2 - 1) * Math.pow(1 - t/0.1, 2) * 0.15;
            }));
        }
        
        // 5. BGM (Dark Drone)
        if (!this.buffers.has('bgm_dungeon')) {
             this.buffers.set('bgm_dungeon', createBuffer(10.0, (i, t) => {
                // D Minor Cluster (Low D1, F1, A1)
                const f1 = Math.sin(t * 36.71 * Math.PI * 2); // D1
                const f2 = Math.sin(t * 43.65 * Math.PI * 2); // F1
                const f3 = Math.sin(t * 55.00 * Math.PI * 2); // A1
                
                // Slow breathing modulation (0.2 Hz)
                const breath = 0.5 + 0.5 * Math.sin(t * 0.2 * Math.PI * 2);
                
                // Pink-ish noise for "wind" texture
                const noise = (Math.random() * 2 - 1) * 0.03;
                
                // Combine: Low rumble + chord + wind
                return (f1 * 0.5 + f2 * 0.3 + f3 * 0.3) * 0.08 * breath + noise;
            }));
        }

        // 6. Spells (Synthesized)
        if (!this.buffers.has('spell_fire')) {
            // Hissing noise
            this.buffers.set('spell_fire', createBuffer(0.8, (i, t) => {
                return (Math.random() * 2 - 1) * Math.pow(1 - t/0.8, 2) * 0.6;
            }));
        }
        if (!this.buffers.has('spell_ice')) {
            // High pitched sine shatter
            this.buffers.set('spell_ice', createBuffer(0.6, (i, t) => {
                const freq = 2000 + Math.random() * 1000;
                return Math.sin(t * freq * Math.PI * 2) * (1 - t/0.6) * 0.3;
            }));
        }
        if (!this.buffers.has('spell_poison')) {
            // Low bubbling
            this.buffers.set('spell_poison', createBuffer(0.6, (i, t) => {
                return Math.sin(t * 200 * Math.PI * 2 + Math.sin(t * 50)) * (1 - t/0.6) * 0.5;
            }));
        }
        if (!this.buffers.has('spell_electric')) {
            // Sawtooth buzz
            this.buffers.set('spell_electric', createBuffer(0.4, (i, t) => {
                const freq = 150 + Math.random() * 50;
                return ((t * freq) % 1 - 0.5) * (1 - t/0.4) * 0.4;
            }));
        }
        if (!this.buffers.has('spell_void')) {
            // Deep wobble
            this.buffers.set('spell_void', createBuffer(1.2, (i, t) => {
                const freq = 60 + Math.sin(t * 20) * 20;
                return Math.sin(t * freq * Math.PI * 2) * (1 - t/1.2) * 0.8;
            }));
        }
    }
}
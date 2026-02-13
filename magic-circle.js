export class MagicCircleFX {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'shaderCanvas';
        // Z-index 6500 puts it above the modal overlay (6000) but below UI elements like tooltips
        this.canvas.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:6500; mix-blend-mode: screen;';
        document.body.appendChild(this.canvas);

        this.gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
        this.program = null;
        this.startTime = 0;
        this.active = false;
        this.duration = 2000; // ms
        this.center = { x: 0, y: 0 };
        this.color = [1, 1, 1];
        
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.initShader();
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        if (this.gl) this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    initShader() {
        if (!this.gl) return;
        const gl = this.gl;

        const vsSrc = `
            attribute vec2 position;
            void main() {
                gl_Position = vec4(position, 0.0, 1.0);
            }
        `;

        const fsSrc = `
            precision mediump float;
            uniform vec2 uResolution;
            uniform float uTime;
            uniform vec2 uCenter;
            uniform vec3 uColor;
            
            #define PI 3.14159265359

            vec2 rotate(vec2 p, float rad) {
                float c = cos(rad);
                float s = sin(rad);
                return mat2(c, s, -s, c) * p;
            }

            vec2 scale(vec2 p, float r) {
                return p * r;
            }

            vec2 translate(vec2 p, vec2 diff) {
                return p - diff;
            }

            float circle(float pre, vec2 p, float r1, float r2, float power) {
                float leng = length(p);
                float d = min(abs(leng-r1), abs(leng-r2));
                if (r1<leng && leng<r2) pre /= exp(d)/r2;
                float res = power / d;
                return clamp(pre + res, 0.0, 1.0);
            }

            float rectangle(float pre, vec2 p, vec2 half1, vec2 half2, float power) {
                p = abs(p);
                if ((half1.x<p.x || half1.y<p.y) && (p.x<half2.x && p.y<half2.y)) {
                    pre = max(0.01, pre);
                }
                float dx1 = (p.y < half1.y) ? abs(half1.x-p.x) : length(p-half1);
                float dx2 = (p.y < half2.y) ? abs(half2.x-p.x) : length(p-half2);
                float dy1 = (p.x < half1.x) ? abs(half1.y-p.y) : length(p-half1);
                float dy2 = (p.x < half2.x) ? abs(half2.y-p.y) : length(p-half2);
                float d = min(min(dx1, dx2), min(dy1, dy2));
                float res = power / d;
                return clamp(pre + res, 0.0, 1.0);
            }

            float radiation(float pre, vec2 p, float r1, float r2, int num, float power) {
                float angle = 2.0*PI/float(num);
                float d = 1e10;
                for(int i=0; i<360; i++) {
                    if (i>=num) break;
                    float _d = (r1<p.y && p.y<r2) ? abs(p.x) : min(length(p-vec2(0.0, r1)), length(p-vec2(0.0, r2)));
                    d = min(d, _d);
                    p = rotate(p, angle);
                }
                float res = power / d;
                return clamp(pre + res, 0.0, 1.0);
            }

            float calc(vec2 p) {
                float dst = 0.0;
                // Zoom out slightly to fit screen better
                p = p * 1.2; 
                
                p = scale(p, sin(PI*uTime/1.0)*0.02+1.1);
                {
                    vec2 q = p;
                    q = rotate(q, uTime * PI / 6.0);
                    dst = circle(dst, q, 0.85, 0.9, 0.006);
                    dst = radiation(dst, q, 0.87, 0.88, 36, 0.0008);
                }
                {
                    vec2 q = p;
                    q = rotate(q, uTime * PI / 6.0);
                    const int n = 6;
                    float angle = PI / float(n);
                    q = rotate(q, floor(atan(q.x, q.y)/angle + 0.5) * angle);
                    for(int i=0; i<n; i++) {
                        dst = rectangle(dst, q, vec2(0.85/sqrt(2.0)), vec2(0.85/sqrt(2.0)), 0.0015);
                        q = rotate(q, angle);
                    }
                }
                {
                    vec2 q = p;
                    q = rotate(q, uTime * PI / 6.0);
                    const int n = 12;
                    q = rotate(q, 2.0*PI/float(n)/2.0);
                    float angle = 2.0*PI / float(n);
                    for(int i=0; i<n; i++) {
                        dst = circle(dst, q-vec2(0.0, 0.875), 0.001, 0.05, 0.004);
                        dst = circle(dst, q-vec2(0.0, 0.875), 0.001, 0.001, 0.008);
                        q = rotate(q, angle);
                    }
                }
                {
                    vec2 q = p;
                    dst = circle(dst, q, 0.5, 0.55, 0.002);
                }
                {
                    vec2 q = p;
                    q = rotate(q, -uTime * PI / 6.0);
                    const int n = 3;
                    float angle = PI / float(n);
                    q = rotate(q, floor(atan(q.x, q.y)/angle + 0.5) * angle);
                    for(int i=0; i<n; i++) {
                        dst = rectangle(dst, q, vec2(0.36, 0.36), vec2(0.36, 0.36), 0.0015);
                        q = rotate(q, angle);
                    }
                }
                {
                    vec2 q = p;
                    q = rotate(q, -uTime * PI / 6.0);
                    const int n = 12;
                    q = rotate(q, 2.0*PI/float(n)/2.0);
                    float angle = 2.0*PI / float(n);
                    for(int i=0; i<n; i++) {
                        dst = circle(dst, q-vec2(0.0, 0.53), 0.001, 0.035, 0.004);
                        dst = circle(dst, q-vec2(0.0, 0.53), 0.001, 0.001, 0.001);
                        q = rotate(q, angle);
                    }
                }
                {
                    vec2 q = p;
                    q = rotate(q, uTime * PI / 6.0);
                    dst = radiation(dst, q, 0.25, 0.3, 12, 0.005);
                }
                {
                    vec2 q = p;
                    q = scale(q, sin(PI*uTime/1.0)*0.04+1.1);
                    q = rotate(q, -uTime * PI / 6.0);
                    for(float i=0.0; i<6.0; i++) {
                        float r = 0.13-i*0.01;
                        q = translate(q, vec2(0.1, 0.0));
                        dst = circle(dst, q, r, r, 0.002);
                        q = translate(q, -vec2(0.1, 0.0));
                        q = rotate(q, -uTime * PI / 12.0);
                    }
                    dst = circle(dst, q, 0.04, 0.04, 0.004);
                }
                return pow(dst, 2.5);
            }

            void main() {
                // Convert to centered UVs based on click position
                vec2 uv = (gl_FragCoord.xy - uCenter) / min(uResolution.x, uResolution.y) * 2.0;
                
                float intensity = calc(uv);
                
                // Fade out over time
                float fade = 1.0;
                if (uTime > 1.5) fade = 1.0 - (uTime - 1.5) * 2.0;
                
                gl_FragColor = vec4(uColor * intensity, intensity * fade);
            }
        `;

        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, vsSrc);
        gl.compileShader(vs);

        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, fsSrc);
        gl.compileShader(fs);

        this.program = gl.createProgram();
        gl.attachShader(this.program, vs);
        gl.attachShader(this.program, fs);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error('Shader link error:', gl.getProgramInfoLog(this.program));
            return;
        }

        // Full screen quad
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1,
            -1, 1, 1, -1, 1, 1
        ]), gl.STATIC_DRAW);

        this.uniforms = {
            uResolution: gl.getUniformLocation(this.program, 'uResolution'),
            uTime: gl.getUniformLocation(this.program, 'uTime'),
            uCenter: gl.getUniformLocation(this.program, 'uCenter'),
            uColor: gl.getUniformLocation(this.program, 'uColor')
        };
        
        this.attribPos = gl.getAttribLocation(this.program, 'position');
        gl.enableVertexAttribArray(this.attribPos);
        gl.vertexAttribPointer(this.attribPos, 2, gl.FLOAT, false, 0, 0);
    }

    trigger(x, y, color) {
        if (!this.gl || !this.program) return;
        this.center = { x, y: window.innerHeight - y }; // WebGL Y is inverted
        this.color = color;
        this.startTime = performance.now();
        this.active = true;
        this.animate();
    }

    animate() {
        if (!this.active) return;
        
        const now = performance.now();
        const elapsed = (now - this.startTime) / 1000;

        if (elapsed > 2.0) {
            this.active = false;
            this.gl.clear(this.gl.COLOR_BUFFER_BIT);
            return;
        }

        const gl = this.gl;
        gl.useProgram(this.program);
        gl.uniform2f(this.uniforms.uResolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.uniforms.uTime, elapsed);
        gl.uniform2f(this.uniforms.uCenter, this.center.x, this.center.y);
        gl.uniform3f(this.uniforms.uColor, this.color[0], this.color[1], this.color[2]);

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        requestAnimationFrame(() => this.animate());
    }
}

import * as THREE from "three";

/**
 * v36 atmosphere: dust hanging in the air that only shows where the torch beam passes through it,
 * and a faint visible beam. Both are cheap (one draw each) and read as "real" air in a dead building.
 */
export class TorchAir {
  readonly dust: THREE.Points;
  readonly beam: THREE.Mesh;
  private dustMat: THREE.ShaderMaterial;
  private beamMat: THREE.ShaderMaterial;

  constructor(count: number) {
    // motes live in a 10 m box that wraps around the camera, so there is always air around you
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3), s = new Float32Array(count);
    for (let i = 0; i < count; i++) { p[i * 3] = Math.random() * 10; p[i * 3 + 1] = Math.random() * 3; p[i * 3 + 2] = Math.random() * 10; s[i] = Math.random(); }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("seed", new THREE.BufferAttribute(s, 1));
    this.dustMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uCam: { value: new THREE.Vector3() }, uDir: { value: new THREE.Vector3(0, 0, -1) }, uTime: { value: 0 }, uOn: { value: 1 }, uPx: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float seed; uniform vec3 uCam; uniform vec3 uDir; uniform float uTime; uniform float uPx;
        varying float vA;
        void main() {
          vec3 drift = vec3(sin(uTime * 0.07 + seed * 40.0) * 0.6, -0.05 * uTime * (0.3 + seed), cos(uTime * 0.05 + seed * 23.0) * 0.6);
          vec3 box = vec3(10.0, 3.0, 10.0);
          vec3 w = position + drift;
          w = uCam - box * 0.5 + mod(w - (uCam - box * 0.5), box);
          w.y = mod(position.y + drift.y, 3.0) + 0.05;
          vec3 to = w - uCam; float d = length(to);
          float inCone = smoothstep(0.86, 0.95, dot(to / max(d, 0.001), uDir));
          vA = inCone * clamp(1.2 - d / 7.0, 0.0, 1.0) * smoothstep(0.7, 1.6, d) * (0.45 + 0.55 * sin(uTime * (0.8 + seed) + seed * 50.0) * 0.5 + 0.275);
          vec4 mv = viewMatrix * vec4(w, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uPx * (0.9 + seed * 1.3) * (4.0 / max(0.8, -mv.z));
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOn; varying float vA;
        void main() { vec2 c = gl_PointCoord - 0.5; float r = dot(c, c); if (r > 0.25) discard; gl_FragColor = vec4(1.0, 0.95, 0.85, (1.0 - r * 4.0) * vA * 0.28 * uOn); }`,
    });
    this.dust = new THREE.Points(g, this.dustMat);
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 5;

    // the beam: an open cone, brightest along its axis and near the lens, gone by 7 m
    const cone = new THREE.ConeGeometry(Math.tan(0.42) * 7, 7, 32, 1, true);
    cone.translate(0, -3.5, 0); cone.rotateX(-Math.PI / 2); // apex at the origin, pointing −z
    this.beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uOn: { value: 1 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying float vZ; varying vec3 vN; varying vec3 vV;
        void main() { vZ = -position.z / 7.0; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        uniform float uOn; uniform float uTime; varying float vZ; varying vec3 vN; varying vec3 vV;
        void main() {
          float edge = pow(abs(dot(vN, vV)), 1.6);
          float a = edge * (1.0 - smoothstep(0.05, 1.0, vZ)) * smoothstep(0.0, 0.06, vZ);
          a *= 0.85 + 0.15 * sin(vZ * 30.0 - uTime * 0.6);
          gl_FragColor = vec4(1.0, 0.95, 0.84, a * 0.05 * uOn);
        }`,
    });
    this.beam = new THREE.Mesh(cone, this.beamMat);
    this.beam.frustumCulled = false;
    this.beam.renderOrder = 4;
  }

  update(cam: THREE.Vector3, dir: THREE.Vector3, t: number, on: boolean, px: number) {
    const u = this.dustMat.uniforms;
    u.uCam.value.copy(cam); u.uDir.value.copy(dir); u.uTime.value = t; u.uPx.value = px;
    const k = on ? 1 : 0;
    u.uOn.value += (k - u.uOn.value) * 0.3;
    this.beamMat.uniforms.uOn.value = u.uOn.value; this.beamMat.uniforms.uTime.value = t;
  }

  dispose() { this.dust.geometry.dispose(); this.dustMat.dispose(); this.beam.geometry.dispose(); this.beamMat.dispose(); }
}

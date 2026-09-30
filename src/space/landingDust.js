import * as THREE from 'three';

// Touchdown dust: when the Lodestar's feet (or belly) meet the Moon's ground with its thrusters
// working, a ring of regolith blows out along the ground - fine grains thrown on flat, fast
// ballistic arcs (no air to hold them) that fade as they fall back. Additive points in the Moon's
// frame (km), one pool, no allocation per frame.

const N = 360, LIFE = 2.6;
const V = () => new THREE.Vector3();
const _p = V(), _t1 = V(), _t2 = V();

export class LandingDust {
  constructor(parent) {
    this.pos = new Float32Array(N * 3);
    this.col = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    this.age = new Float32Array(N).fill(LIFE);
    this.next = 0; this.live = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const m = new THREE.PointsMaterial({ size: 0.0026, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.renderOrder = 3;
    if (parent) parent.add(this.points);
  }

  /** Throw k grains from ground point P (Moon frame) with ground normal n; strength 0..1. */
  burst(P, n, k, strength) {
    _t1.set(1, 0, 0).cross(n); if (_t1.lengthSq() < 1e-6) _t1.set(0, 0, 1).cross(n);
    _t1.normalize(); _t2.crossVectors(n, _t1);
    for (let j = 0; j < k; j++) {
      const i = this.next; this.next = (this.next + 1) % N;
      const a = Math.random() * Math.PI * 2, r = Math.random() * 0.004;
      _p.copy(P).addScaledVector(_t1, Math.cos(a) * r).addScaledVector(_t2, Math.sin(a) * r).addScaledVector(n, 0.0002);
      this.pos.set([_p.x, _p.y, _p.z], i * 3);
      const sp = (0.012 + Math.random() * 0.03) * (0.4 + 0.6 * strength), up = sp * (0.05 + Math.random() * 0.25);
      this.vel[i * 3] = (Math.cos(a) * _t1.x + Math.sin(a) * _t2.x) * sp + n.x * up;
      this.vel[i * 3 + 1] = (Math.cos(a) * _t1.y + Math.sin(a) * _t2.y) * sp + n.y * up;
      this.vel[i * 3 + 2] = (Math.cos(a) * _t1.z + Math.sin(a) * _t2.z) * sp + n.z * up;
      this.age[i] = 0;
    }
    this.live = LIFE;
  }

  /** Per frame: raise dust under a working ship close to the Moon's ground, and move the grains. */
  feed(dt, pilot) {
    const c = pilot.contact;
    if (pilot.frame === 'moon' && c.agl < 0.03 && c.agl > -0.002 && !pilot.dock) {
      const thrust = Math.min(1, Math.abs(pilot.input.lift) + pilot.burn / pilot.caps.A_MAIN + (pilot.assistA || 0) / pilot.caps.A_RCS * 0.5);
      const near = 1 - c.agl / 0.03;
      const touch = c.footTouch + c.hullTouch;
      if (thrust > 0.05 || (touch && !this._was)) {
        const k = Math.round((touch && !this._was ? 60 : 0) + 90 * dt * thrust * near * 6);
        if (k > 0) this.burst(_p.copy(pilot.pos).addScaledVector(pilot.pos.clone().normalize(), -(c.agl + 0.0068)), c.groundN, Math.min(k, 90), Math.max(thrust, 0.5));
      }
      this._was = touch > 0;
    } else this._was = false;
    if (this.live <= 0) { this.points.visible = false; return; }
    this.live -= dt;
    this.points.visible = true;
    const gN = pilot.frame === 'moon' ? pilot.pos.clone().normalize().multiplyScalar(-0.00162 * dt) : V();
    for (let i = 0; i < N; i++) {
      const a = this.age[i];
      if (a >= LIFE) { this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0; continue; }
      this.age[i] = a + dt;
      this.vel[i * 3] += gN.x; this.vel[i * 3 + 1] += gN.y; this.vel[i * 3 + 2] += gN.z;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = Math.pow(1 - a / LIFE, 1.6) * 0.55;
      this.col[i * 3] = 0.78 * f; this.col[i * 3 + 1] = 0.72 * f; this.col[i * 3 + 2] = 0.64 * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

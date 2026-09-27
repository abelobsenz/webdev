import * as THREE from 'three';
import { FLOATING_ISLANDS, CHORUS, SKYPORT, GATE } from '../world/layout.js';
import { latticeRadius, AXIS } from '../world/axis.js';

/**
 * Obstacle field for route planning. Every lane, dock ramp and flight path is
 * checked against the world's colliders and the master plan at load time, and
 * lifted over (or reported for) anything it would clip.
 *
 * clearance(p) ≈ distance from p to the nearest obstacle surface (metres,
 * negative when inside). Obstacles:
 *  - terrain plus an allowance for low-rise districts
 *  - world.colliders (Axis core, crown, towers, skyport hub)
 *  - the Axis lattice, root arches, crown rings and tether
 *  - floating gardens (rock roots hang ~2.7 r below the meadow)
 *  - the Chorus envelope, the Skyport ring, the Gate of Concord
 */
export class Clearance {
  constructor(world) {
    this.world = world;
    this.colliders = world.colliders || [];
    this.towers = world.towers || [];
    this.floating = FLOATING_ISLANDS;
  }

  terrainAllowance(g) { return g > 1.0 ? 150 : 45; }

  clearance(p, { skyport = true, chorus = true, terrain = true } = {}) {
    let c = 1e9;
    const x = p.x, y = p.y, z = p.z;
    if (terrain) {
      const g = this.world.groundHeight(x, z);
      c = Math.min(c, y - g - this.terrainAllowance(g));
    }
    const dA = Math.hypot(x, z);
    if (y < AXIS.height + 150) {
      if (y > AXIS.latticeY0 - 60) c = Math.min(c, dA - (latticeRadius(Math.min(Math.max(y, AXIS.latticeY0), AXIS.latticeY1)) + 50));
      else c = Math.min(c, Math.max(dA - 690, y - AXIS.latticeY0 - 60));
    }
    if (y > AXIS.crownY - 160 && y < AXIS.anchorY + 220) c = Math.min(c, dA - 300);
    if (y > AXIS.anchorY) c = Math.min(c, dA - 60);
    for (const k of this.colliders) {
      const pad = 30;
      if (y < k.y0 - pad || y > k.y1 + pad) continue;
      const r = typeof k.radius === 'function' ? k.radius(THREE.MathUtils.clamp(y, k.y0, k.y1)) : k.radius;
      const dh = Math.hypot(x - k.x, z - k.z) - r;
      const dv = y < k.y0 ? k.y0 - y : y > k.y1 ? y - k.y1 : 0;
      c = Math.min(c, Math.max(dh, dv));
    }
    for (const f of this.floating) {
      const top = f.y + f.r * 0.35 + 40, bot = f.y - f.r * 2.75;
      const dh = Math.hypot(x - f.x, z - f.z) - f.r * 1.2;
      const dv = y > top ? y - top : y < bot ? bot - y : 0;
      c = Math.min(c, Math.max(dh, dv));
    }
    if (chorus) c = Math.min(c, Math.hypot(x - CHORUS.x, y - CHORUS.y, z - CHORUS.z) - CHORUS.scale * 1.45);
    if (skyport) {
      const dh = Math.hypot(x - SKYPORT.x, z - SKYPORT.z) - (SKYPORT.r + 70);
      const dv = y > SKYPORT.y + 220 ? y - SKYPORT.y - 220 : y < SKYPORT.y - 170 ? SKYPORT.y - 170 - y : 0;
      c = Math.min(c, Math.max(dh, dv));
    }
    {
      const dx = Math.abs(x - GATE.x) - GATE.span * 0.6, dz = Math.abs(z - GATE.z) - 320, dy = y - GATE.height - 60;
      c = Math.min(c, Math.max(dx, dz, dy));
    }
    return c;
  }

  /**
   * Lift a dense polyline over terrain / low obstacles so that clearance >= need
   * everywhere, then ease the lift along the path so climbs stay gentle.
   * Returns { pts, worst, at } with the worst remaining clearance.
   */
  liftPath(pts, need = 40, opts = {}) {
    const n = pts.length;
    const lift = new Float32Array(n);
    const q = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      q.copy(pts[i]);
      let add = 0;
      while (add < (opts.maxLift ?? 500) && this.clearance(q, opts) < need) { add += 10; q.y = pts[i].y + add; }
      lift[i] = this.clearance(q, opts) >= need ? add : 0;
    }
    // spread lifts with a max climb gradient (closed path)
    const grad = opts.grade ?? 0.12;
    const step = pts[1] ? pts[0].distanceTo(pts[1]) : 5;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < 2 * n; i++) { const a = i % n, b = (i - 1) % n; lift[a] = Math.max(lift[a], lift[b] - grad * step); }
      for (let i = 2 * n - 2; i >= 0; i--) { const a = i % n, b = (i + 1) % n; lift[a] = Math.max(lift[a], lift[b] - grad * step); }
    }
    let worst = 1e9, at = null;
    const out = pts.map((p, i) => {
      const v = p.clone(); v.y += lift[i];
      const c = this.clearance(v, opts);
      if (c < worst) { worst = c; at = v; }
      return v;
    });
    return { pts: out, worst, at };
  }

  /** Worst clearance along a polyline (for validation / logging). */
  worst(pts, opts = {}) {
    let worst = 1e9, at = null;
    for (const p of pts) { const c = this.clearance(p, opts); if (c < worst) { worst = c; at = p; } }
    return { worst, at };
  }
}

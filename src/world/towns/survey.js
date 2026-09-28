// The site survey of the inner towns: what already stands on (or is reserved on) the ground
// round a point, so everything the towns layer adds is sited on dry, level-enough land clear of
// the carriageways, the lots (their podiums and aprons), the squares, the lamps, the arcologies'
// bases, the stations, the promenade decks overhead and of everything else it has placed.

const TAU = Math.PI * 2;

export class Survey {
  /**
   * plan: the town plan (planCity + innerCivic + innerShore); ground: raw terrain height;
   * towers: built arcologies (inner only are used); stations: [{x, z, r}]
   */
  constructor(plan, ground, towers = [], stations = []) {
    this.plan = plan;
    this.ground = ground;
    this.F = plan.field;
    this.room = plan.room || null;
    this.towers = towers.filter((t) => Math.hypot(t.def.x, t.def.z) < 7000 && !t.def.ward).map((t) => {
      const q = plan.squares.find((s) => s.kind === 'tower' && s.x === t.def.x && s.z === t.def.z);
      return { x: t.def.x, z: t.def.z, base: q ? q.base : (t.def.radius || 60) * 2, t };
    });
    this.stations = stations;
    this.G = 32;
    this.lots = new Map();
    for (const L of plan.lots) this._put(this.lots, L.x, L.z, L);
    this.lamps = new Map();
    for (const l of plan.lamps) this._put(this.lamps, l.x, l.z, l);
    this.occ = new Map();          // everything the towns layer has claimed: discs {x, z, r}
    this.lotReach = 2;
  }

  _put(map, x, z, o) {
    const k = Math.floor(x / this.G) * 100003 + Math.floor(z / this.G);
    let l = map.get(k);
    if (!l) map.set(k, (l = []));
    l.push(o);
  }

  _near(map, x, z, r) {
    const out = [];
    for (let i = Math.floor((x - r) / this.G); i <= Math.floor((x + r) / this.G); i++) {
      for (let j = Math.floor((z - r) / this.G); j <= Math.floor((z + r) / this.G); j++) {
        const l = map.get(i * 100003 + j);
        if (l) for (const o of l) out.push(o);
      }
    }
    return out;
  }

  /** Lowest and highest ground over a disc (centre and two rings). */
  groundRange(x, z, r) {
    let lo = this.ground(x, z), hi = lo;
    for (const [f, n] of [[0.5, 8], [1, 16]]) {
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU, g = this.ground(x + Math.cos(a) * r * f, z + Math.sin(a) * r * f);
        if (g < lo) lo = g;
        if (g > hi) hi = g;
      }
    }
    return { lo, hi };
  }

  /** Ground range over a rectangle in a frame (x, z, yaw; local hx across, z0..z1 along +z). */
  groundRect(x, z, yaw, hx, z0, z1) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let lo = Infinity, hi = -Infinity;
    const nu = Math.max(2, Math.ceil(hx / 1.5)), nv = Math.max(2, Math.ceil((z1 - z0) / 1.5));
    for (let i = -nu; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      const lx = (i / nu) * hx, lz = z0 + ((z1 - z0) * j) / nv;
      const g = this.ground(x + lx * c + lz * s, z - lx * s + lz * c);
      if (g < lo) lo = g;
      if (g > hi) hi = g;
    }
    return { lo, hi };
  }

  /** Least signed distance to a kerb over the disc (negative: on a carriageway). */
  edgeMin(x, z, r) {
    let m = this.F.edge(x, z);
    for (const [f, n] of [[0.5, 8], [1, 16]]) for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      m = Math.min(m, this.F.edge(x + Math.cos(a) * r * f, z + Math.sin(a) * r * f));
    }
    return m - r * 0.02;
  }

  /** Is (x, z) within pad of a lot's podium (the lot + 0.6 m) or its paved apron (3.2 m ahead)? */
  inLot(x, z, pad = 0) {
    for (const L of this._near(this.lots, x, z, 40 + pad)) {
      const c = Math.cos(L.rot), s = Math.sin(L.rot), dx = x - L.x, dz = z - L.z;
      const u = dx * c - dz * s, v = dx * s + dz * c;
      if (Math.abs(u) < L.w / 2 + 0.6 + pad && v > -L.d / 2 - 0.6 - pad && v < L.d / 2 + 3.3 + pad) return true;
    }
    return false;
  }

  /** Is any part of the disc within pad of a lot? (samples the rim) */
  discInLot(x, z, r, pad = 0) {
    if (this.inLot(x, z, r + pad)) {
      // exact enough: test the rim and centre against the padded rectangles
      if (this.inLot(x, z, pad)) return true;
      for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; if (this.inLot(x + Math.cos(a) * r, z + Math.sin(a) * r, pad)) return true; }
      return this.inLot(x, z, r * 0.7 + pad);
    }
    return false;
  }

  /** Add a lamp to the plan (and to the survey). */
  addLamp(l) { this.plan.lamps.push(l); this._put(this.lamps, l.x, l.z, l); }

  /** Remove the plan's lamps that pred picks (and re-index the survey's). */
  removeLamps(pred) {
    const L = this.plan.lamps;
    for (let i = L.length - 1; i >= 0; i--) if (pred(L[i])) L.splice(i, 1);
    this.lamps = new Map();
    for (const l of L) this._put(this.lamps, l.x, l.z, l);
  }

  lampNear(x, z, r) {
    for (const l of this._near(this.lamps, x, z, r)) if (Math.hypot(l.x - x, l.z - z) < r) return true;
    return false;
  }

  /** Metres of clear air over the disc (Infinity where nothing stands). */
  headroom(x, z, r) { return this.room ? this.room.min(x, z, r) : Infinity; }

  /** The squares the point lies in (within pad of their edge). */
  squaresAt(x, z, pad = 0) { return this.plan.squares.filter((q) => Math.abs(q.x - x) < q.r + pad && Math.hypot(q.x - x, q.z - z) < q.r + pad); }

  /** Clear of every arcology's base (and the podium's stairs, canopies: 4.5 m beyond it). */
  towerClear(x, z, r, margin = 4.5) { return this.towers.every((t) => Math.hypot(t.x - x, t.z - z) >= t.base + margin + r); }

  stationClear(x, z, r, margin = 2) { return this.stations.every((s) => Math.hypot(s.x - x, s.z - z) >= (s.r || 40) + margin + r); }

  free(x, z, r) {
    for (const o of this._near(this.occ, x, z, r + 30)) if (Math.hypot(o.x - x, o.z - z) < o.r + r) return false;
    return true;
  }

  claim(x, z, r, tag = null) { this._put(this.occ, x, z, { x, z, r, tag }); }
}

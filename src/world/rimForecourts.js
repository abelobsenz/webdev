import * as THREE from 'three';
import { latheFacade, mergeClean } from './geom.js';
import { createFacadeMaterial } from './facade.js';
import { rimArcologies, towerBase, RIM_TERRACE } from './urban.js';

// Forecourts for the arcologies on the atoll rim. The rim is steep, so each arcology stands on
// a level terrace at the height of its own base: an ashlar retaining wall (down into the ground
// all round, into the lagoon floor where the terrace reaches the water) with a parapet and a
// coping, a paved top. On it: a ring colonnade on a stepped stylobate carrying an entablature
// (architrave, frieze, a cornice planted on top), open at four gates; a fountain with water in
// its basins on the side facing the lagoon; obelisks on stepped plinths on the cross axes;
// lamps round the terrace. Wherever the hill rises above the terrace the parts buried in it are
// left out. The rim streets stop at the terrace (urban.js clipAtStops).
// Each terrace has a detailed set and a massing set (same volumes: the columns turn square, the
// fountain loses its bowl) swapped by distance.

const TAU = Math.PI * 2;
const K = { STONE: 1, LANTERN: 2, GARDEN: 3, POOL: 6, PAVING: 9, METAL: 10 };

/** Mesh parts with facade coordinates (u, v, kind) and explicit normals. */
class Parts {
  constructor(observe = null) { this.pos = []; this.nrm = []; this.fac = []; this.idx = []; this.observe=observe; }
  v(x, y, z, nx, ny, nz, u, w, k) { this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.fac.push(u, w, k); return this.pos.length / 3 - 1; }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  mark(){return[this.pos.length,this.idx.length];}
  finish(mark,kind){if(!this.observe)return;const [p,i]=mark,g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(this.pos.slice(p),3));g.setAttribute('normal',new THREE.Float32BufferAttribute(this.nrm.slice(p),3));g.setAttribute('aFacade',new THREE.Float32BufferAttribute(this.fac.slice(p),3));g.setIndex(this.idx.slice(i).map(n=>n-p/3));this.observe({geometry:g,kind});}
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aFacade', new THREE.Float32BufferAttribute(this.fac, 3));
    g.setIndex(this.idx);
    return g;
  }
}

/**
 * Closed annular sector round (cx, cz): radii r0 < r1, heights y0(a) < y1, angles a0 < a1.
 * Outer face out, inner face in, top up, bottom down (optional), end caps on a partial ring.
 * y0 may be a function of the angle (retaining walls that follow the ground).
 */
function ringBand(P, cx, cz, r0, r1, y0, y1, a0, a1, { kind = K.STONE, top = kind, bottom = true, inner = true, seg } = {}) {
  const mark=P.mark();
  const full = a1 - a0 >= TAU - 1e-6;
  const n = seg || Math.max(3, Math.ceil(((a1 - a0) * r1) / 3));
  const Y0 = typeof y0 === 'function' ? y0 : () => y0;
  const Y1 = typeof y1 === 'function' ? y1 : () => y1;
  const ring = (r, face) => {
    // face: +1 outer, -1 inner
    for (let i = 0; i < n; i++) {
      const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n;
      const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
      const b0 = Y0(t0), b1 = Y0(t1);
      const p = P.v(cx + c0 * r, b0, cz + s0 * r, c0 * face, 0, s0 * face, t0 * r, b0, kind);
      const q = P.v(cx + c1 * r, b1, cz + s1 * r, c1 * face, 0, s1 * face, t1 * r, b1, kind);
      const e = P.v(cx + c1 * r, Y1(t1), cz + s1 * r, c1 * face, 0, s1 * face, t1 * r, Y1(t1), kind);
      const f = P.v(cx + c0 * r, Y1(t0), cz + s0 * r, c0 * face, 0, s0 * face, t0 * r, Y1(t0), kind);
      // counter-clockwise seen from outside
      if (face > 0) P.quad(p, f, e, q); else P.quad(p, q, e, f);
    }
  };
  const flat = (y, up, k) => {
    for (let i = 0; i < n; i++) {
      const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n;
      const pts = [[r0, t0], [r1, t0], [r1, t1], [r0, t1]].map(([r, t]) => [cx + Math.cos(t) * r, cz + Math.sin(t) * r]);
      const yy = typeof y === 'function' ? (t) => y(t) : () => y;
      const xyz=pts.map(([x,z],j)=>new THREE.Vector3(x,yy(j<2?t0:t1),z));
      const normal=new THREE.Vector3().subVectors(xyz[2],xyz[0]).cross(new THREE.Vector3().subVectors(xyz[1],xyz[0])).normalize().multiplyScalar(up?1:-1);
      const ids=xyz.map(p=>P.v(p.x,p.y,p.z,normal.x,normal.y,normal.z,p.x,p.z,k));
      if(r0<1e-8){if(up)P.idx.push(ids[0],ids[2],ids[1]);else P.idx.push(ids[0],ids[1],ids[2]);}
      else if (up) P.quad(ids[0], ids[3], ids[2], ids[1]); else P.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  };
  ring(r1, 1);
  if (inner && r0>1e-8) ring(r0, -1);
  flat(Y1, true, top);
  if (bottom) flat(Y0, false, kind);
  if (!full) {
    for (const [t, sgn] of [[a0, -1], [a1, 1]]) {
      const c = Math.cos(t), s = Math.sin(t);
      const nx = -s * sgn, nz = c * sgn;          // along the tangent, out of the sector
      const b = Y0(t);
      const ids = [[r0, b], [r1, b], [r1, Y1(t)], [r0, Y1(t)]].map(([r, y]) => P.v(cx + c * r, y, cz + s * r, nx, 0, nz, r, y, kind));
      if (sgn > 0) P.quad(ids[0], ids[1], ids[2], ids[3]); else P.quad(ids[0], ids[3], ids[2], ids[1]);
    }
  }
  P.finish(mark,'ring');
}

/** Closed box (plan rotated by rot) from y0 to y1; bottom face optional. */
function boxF(P, cx, cz, hx, hz, y0, y1, rot, { kind = K.STONE, top = kind, bottom = true } = {}) {
  const mark=P.mark();
  const c = Math.cos(rot), s = Math.sin(rot);
  const W = (x, z) => [cx + x * c - z * s, cz + x * s + z * c];
  const cs = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([x, z]) => W(x, z));
  let u = 0;
  for (let i = 0; i < 4; i++) {
    const a = cs[i], b = cs[(i + 1) % 4];
    const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
    const nx = ez / L, nz = -ex / L;                 // outward: the corners run counter-clockwise in (x, z)
    const ids = [[a, y0, u], [b, y0, u + L], [b, y1, u + L], [a, y1, u]].map(([p, y, uu]) => P.v(p[0], y, p[1], nx, 0, nz, uu, y, kind));
    P.quad(ids[0], ids[3], ids[2], ids[1]);
    u += L;
  }
  const capF = (y, up, k) => {
    const ids = cs.map(([x, z]) => P.v(x, y, z, 0, up ? 1 : -1, 0, x, z, k));
    if (up) P.quad(ids[0], ids[3], ids[2], ids[1]); else P.quad(ids[0], ids[1], ids[2], ids[3]);
  };
  capF(y1, true, top);
  if (bottom) capF(y0, false, kind);
  P.finish(mark,'box');
}

/** A closed paving slab whose four top corners can follow the terrain. */
function pathSlab(P,corners,bottom,kind=K.PAVING){
  const mark=P.mark(),points=[...corners.map(p=>new THREE.Vector3(p.x,bottom,p.z)),...corners.map(p=>new THREE.Vector3(p.x,p.y,p.z))];
  for(const face of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]])for(const ids of [[face[0],face[1],face[2]],[face[0],face[2],face[3]]]){
    const a=points[ids[0]],b=points[ids[1]],c=points[ids[2]],n=new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).normalize();
    P.idx.push(...ids.map(i=>{const p=points[i];return P.v(p.x,p.y,p.z,n.x,n.y,n.z,p.x,p.z,kind);}));
  }
  P.finish(mark,'path-slab');
}

/** Lathe with per-segment kinds (a duplicated ring at every change of kind) at (x, y, z). */
function lathe(list, x, y, z, prof, seg, opts) {
  const out = [];
  for (let i = 0; i < prof.length; i++) {
    const [r, h, k] = prof[i];
    if (i > 0 && prof[i - 1][2] !== k) out.push({ r: prof[i - 1][0], y: prof[i - 1][1], kind: k });
    out.push({ r, y: h, kind: k });
  }
  list.push(latheFacade(out, seg, opts).translate(x, y, z));
}

// the column: square plinth, torus, a shaft with entasis, necking, echinus and abacus
function column(list, x, y, z, h, lod) {
  if (lod) { lathe(list, x, y, z, [[0.7, -0.1, K.STONE], [0.6, h * 0.5, K.STONE], [0.52, h + 0.1, K.STONE]], 4, { phase: Math.PI / 4 }); return; }
  lathe(list, x, y, z, [
    [0.82, -0.1, K.STONE], [0.82, 0.28, K.STONE], [0.74, 0.34, K.STONE], [0.72, 0.46, K.STONE], [0.6, 0.56, K.STONE],
    [0.58, 1.2, K.STONE], [0.56, h * 0.45, K.STONE], [0.48, h - 0.72, K.STONE], [0.53, h - 0.66, K.STONE], [0.53, h - 0.58, K.STONE],
    [0.49, h - 0.52, K.STONE], [0.78, h - 0.22, K.STONE], [0.8, h + 0.1, K.STONE],
  ], 14);
}

export function buildRimForecourts(scene, towers, ground, avoid = () => false, { streets = [], lots = [], onComponent = null } = {}) {
  const lamps = [];
  const sets = [];
  const mat = createFacadeMaterial('pearl', 4321, { litFrac: 0.5, band: 1e5 });
  for (const t of rimArcologies(towers)) {
    const cx = t.def.x, cz = t.def.z;
    const base = t.footprint || towerBase(t);
    const RT = base + RIM_TERRACE;                  // the terrace edge (outer face of the wall)
    if (avoid(cx, cz, RT + 10)) continue;
    const Y0 = Math.max(t.baseY + 2, 1.8);           // paved top: the tower's own ground level
    const RC = base + 6;                             // colonnade axis
    const hC = 7.2;                                  // column height
    // highest and lowest ground in a small disc (the bilinear sampler can differ from the
    // rendered grid by a little: the margins below cover it)
    const gMax = (x, z, r) => { let m = ground(x, z); for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; m = Math.max(m, ground(x + Math.cos(a) * r, z + Math.sin(a) * r)); } return m; };
    const buried = (x, z, r, lift = 0) => gMax(x, z, r) > Y0 + lift;
    // the retaining wall's foot follows the lowest ground under each stretch, well sunk
    const nW = Math.max(96, Math.ceil((TAU * RT) / 4));
    const foot = new Float32Array(nW + 1);
    for (let i = 0; i <= nW; i++) {
      let m = 1e9;
      for (let k = -2; k <= 2; k++) {
        const a = ((i + k * 0.25) / nW) * TAU;
        for (const rr of [RT-8,RT-6,RT-4,RT-2,RT,RT+1]) m = Math.min(m, ground(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr));
      }
      foot[i] = Math.min(m - 3, Y0 - 1.5);
    }
    const footAt = (a) => { const f = (((a / TAU) % 1) + 1) % 1 * nW; const i = Math.floor(f); return foot[Math.min(i, nW)] + (foot[Math.min(i + 1, nW)] - foot[Math.min(i, nW)]) * (f - i); };
    const toL = Math.atan2(-cz, -cx);                // toward the lagoon
    const norm=a=>((a%TAU)+TAU)%TAU,delta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
    const walkR=RT+6.0,walkHalf=1.25;
    const walkY=a=>{const x=cx+Math.cos(a)*walkR,z=cz+Math.sin(a)*walkR;let h=ground(x,z);for(let k=0;k<8;k++){const t=k*TAU/8;h=Math.max(h,ground(x+Math.cos(t)*walkHalf*1.45,z+Math.sin(t)*walkHalf*1.45));}return Math.max(1,h+.14);};
    const nearbyLots=lots.filter(l=>Math.hypot(l.x-cx,l.z-cz)<RT+450);
    const clear=(x,z,pad=2)=>nearbyLots.every(l=>{const c=Math.cos(l.rot),s=Math.sin(l.rot),dx=x-l.x,dz=z-l.z;return Math.abs(dx*c-dz*s)>l.w/2+pad||Math.abs(dx*s+dz*c)>l.d/2+pad;});
    const clearLine=(a,b,pad=2)=>{const n=Math.max(1,Math.ceil(Math.hypot(a.x-b.x,a.z-b.z)/1.5));for(let k=0;k<=n;k++)if(!clear(a.x+(b.x-a.x)*k/n,a.z+(b.z-a.z)*k/n,pad))return false;return true;};
    const streetEnds=[],streetSegments=[];
    for(const st of streets)for(const pts of st.keep??[st.pts]){
      if(!pts?.length)continue;
      for(const ordered of [pts,[...pts].reverse()]){const p=ordered[0],r=Math.hypot(p[0]-cx,p[1]-cz);if(r>=RT-3&&r<RT+22&&ordered[1]){let x=p[0],z=p[1],remaining=6;for(let k=1;k<ordered.length&&remaining>0;k++){const q=ordered[k],dx=q[0]-x,dz=q[1]-z,length=Math.hypot(dx,dz),u=Math.min(1,remaining/(length||1));x+=dx*u;z+=dz*u;remaining-=length;}streetEnds.push({x,z,halfWidth:st.hw,a:Math.atan2(p[1]-cz,p[0]-cx),clippedEnd:{x:p[0],z:p[1]}});}}
      for(let k=1;k<pts.length;k++){const a=pts[k-1],b=pts[k],dx=b[0]-a[0],dz=b[1]-a[1],u=Math.max(0,Math.min(1,((cx-a[0])*dx+(cz-a[1])*dz)/(dx*dx+dz*dz||1))),x=a[0]+dx*u,z=a[1]+dz*u,d=Math.hypot(x-cx,z-cz);if(d-st.hw>RT+.5&&d<RT+400)streetSegments.push({x,z,d,halfWidth:st.hw,a:Math.atan2(z-cz,x-cx)});}
    }
    const arrivals=[];
    for(const end of streetEnds){const a=end.a,p={x:cx+Math.cos(a)*walkR,z:cz+Math.sin(a)*walkR};if(!arrivals.some(e=>Math.hypot(e.street.x-end.x,e.street.z-end.z)<2)&&clearLine(p,end,1.8))arrivals.push({street:end,walk:p,a});}
    // Two isolated terraces have no clipped endpoint. Their meadow approach is
    // chosen against real parcels and joins the closest clear street segment.
    if(!arrivals.length){streetSegments.sort((a,b)=>a.d-b.d);for(const end of streetSegments){const p={x:cx+Math.cos(end.a)*walkR,z:cz+Math.sin(end.a)*walkR};if(clearLine(p,end,2.6)){arrivals.push({street:end,walk:p,a:end.a});break;}}}
    const stairCandidates=[];
    for(let k=0;k<Math.max(90,Math.ceil(RT));k++){
      const a=k/Math.max(90,Math.ceil(RT))*TAU,arrivalY=walkY(a);
      let bottom=arrivalY;
      for(const da of [-3/(RT-4),0,3/(RT-4)])for(const r of [RT-7.4,RT-4,RT-.8])bottom=Math.max(bottom,ground(cx+Math.cos(a+da)*r,cz+Math.sin(a+da)*r)+.16);
      // The short outside flight reaches the landing before crossing the wall.
      // Raising its inner end enough to clear the actual slope avoids burying
      // the lower treads in the closed terrace body.
      for(let k=1;k<=12;k++){const u=k/12,r=walkR+(RT-walkR)*u;for(const off of [-1.25,0,1.25]){const h=ground(cx+Math.cos(a)*r-Math.sin(a)*off,cz+Math.sin(a)*r+Math.cos(a)*off)+.13;bottom=Math.max(bottom,(h-arrivalY*(1-u))/u);}}
      if(bottom-arrivalY>3.6)continue;
      const rise=Y0-bottom;
      if(rise<.24||rise>32)continue;
      const steps=Math.ceil(rise/.18),length=5+steps*.42;
      for(const direction of [-1,1]){
        const start=a-direction*2/(RT-4),end=start+direction*length/(RT-4);let exposed=true;
        for(let q=0;q<=steps+6&&exposed;q++){const distance=length*q/(steps+6),angle=start+direction*distance/(RT-4),y=bottom+rise*Math.max(0,Math.min(1,(distance-5)/(length-5)));for(const r of [RT-7.4,RT-4,RT-.8])if(ground(cx+Math.cos(angle)*r,cz+Math.sin(angle)*r)>y-.08)exposed=false;}
        if(!exposed)continue;
        const streetDistance=arrivals.length?Math.min(...arrivals.map(e=>Math.abs(delta(e.a,a))*walkR)):Math.abs(delta(a,toL))*walkR;
        stairCandidates.push({a,start,end,bottom,arrivalY,steps,rise,direction,length,score:rise*2+Math.abs(bottom-arrivalY)*3+streetDistance*.18});
      }
    }
    stairCandidates.sort((a,b)=>a.score-b.score);
    const entrances=[];
    for(const c of stairCandidates){if(entrances.some(e=>Math.abs(delta(e.a,c.a))*(RT-4)<(e.length+c.length)/2+18))continue;entrances.push(c);if(entrances.length===(RT>150?2:1))break;}
    const inStair=(a,e)=>{const u=norm((a-e.start)*e.direction)*(RT-4);return u<e.length?u:null;};
    const stepY=a=>{for(const e of entrances){const d=inStair(a,e);if(d!==null)return e.bottom+e.rise*Math.min(e.steps,Math.max(0,Math.ceil((d-5)/.42)))/e.steps;}return Y0;};
    const gateAngles=[...entrances.map(e=>norm(e.end)),toL,toL+Math.PI/2,toL+Math.PI,toL-Math.PI/2];
    const cuts=[0,TAU];for(let k=1;k<nW;k++)cuts.push(k/nW*TAU);
    for(const e of entrances){cuts.push(norm(e.start));for(let k=0;k<=e.steps;k++)cuts.push(norm(e.start+e.direction*(5+k*.42)/(RT-4)));cuts.push(norm(e.a-3/RT),norm(e.a+3/RT));}
    cuts.sort((a,b)=>a-b);const angles=cuts.filter((a,k)=>k===0||a-cuts[k-1]>1e-6);
    const monuments=[];
    const monumentAngle=(preferred,radius)=>{for(const da of [0,.13,-.13,.25,-.25,.4,-.4,.62,-.62]){const a=preferred+da;if(entrances.some(e=>inStair(a,e)!==null||Math.abs(delta(a,e.a))*RT<radius+4))continue;if(gateAngles.some(g=>Math.abs(delta(a,g))*RC<radius+3))continue;const x=cx+Math.cos(a)*(base+11.6),z=cz+Math.sin(a)*(base+11.6);if(!buried(x,z,radius,-.05)&&!avoid(x,z,radius+1)&&monuments.every(m=>Math.hypot(m.x-x,m.z-z)>m.radius+radius+1)){monuments.push({x,z,radius,a});return a;}}return null;};
    const fountainAngle=monumentAngle(toL+.25,4.2),obeliskAngles=[Math.PI/2,-Math.PI/2].map(da=>monumentAngle(toL+da+.2,2.4)).filter(a=>a!==null);

    const build = (lod) => {
      let component='architecture';
      const observe=onComponent?p=>onComponent({...p,court:{x:cx,z:cz},lod:lod?'far':'near',role:component}):null;
      const P = new Parts(observe);
      const list = [];
      if(observe)list.push=(...gs)=>{for(const geometry of gs)observe({geometry,kind:'lathe'});return Array.prototype.push.apply(list,gs);};
      // ---- the terrace: retaining wall (ashlar) with its parapet, the coping, the paved top
      component='foundation';
      let lowest=Math.min(...foot)-1;for(let r=0;r<RT-8;r+=12)for(let k=0;k<48;k++)lowest=Math.min(lowest,ground(cx+Math.cos(k/48*TAU)*r,cz+Math.sin(k/48*TAU)*r)-2);
      ringBand(P,cx,cz,0,RT-8,lowest,Y0,0,TAU,{kind:K.PAVING,seg:nW});
      for(let k=1;k<angles.length;k++){
        const a0=angles[k-1],a1=angles[k],a=(a0+a1)/2,y=stepY(a);
        ringBand(P,cx,cz,RT-8,RT,footAt,y,a0,a1,{kind:K.PAVING,seg:1});
        component='parapet';
        if(!entrances.some(e=>Math.abs(delta(a,e.a))*RT<3)){
          ringBand(P,cx,cz,RT-.5,RT,y-.04,y+1,a0,a1,{kind:K.PAVING,seg:1});
          ringBand(P,cx,cz,RT-.62,RT+.22,y+1,y+1.22,a0,a1,{kind:K.STONE,seg:1});
        }
        component='foundation';
      }
      // A terrain-level circuit links every receiving street to the deliberate
      // court entrances. Its retaining feet are closed and surveyed across width.
      component='outer-walk';
      const nWalk=Math.ceil(TAU*walkR/2.5);
      for(let k=0;k<nWalk;k++){
        const a0=k/nWalk*TAU,a1=(k+1)/nWalk*TAU,y=Math.max(walkY(a0),walkY(a1));
        let low=y-.6;for(const a of [a0,(a0+a1)/2,a1])for(const r of [walkR-walkHalf,walkR+walkHalf])low=Math.min(low,ground(cx+Math.cos(a)*r,cz+Math.sin(a)*r)-.65);
        ringBand(P,cx,cz,walkR-walkHalf,walkR+walkHalf,low,walkY,a0,a1,{kind:K.PAVING,seg:1});
        if(ground(cx+Math.cos((a0+a1)/2)*walkR,cz+Math.sin((a0+a1)/2)*walkR)<.5){
          component='walk-rail';
          for(const side of [-1,1]){
            const a=(a0+a1)/2,open=(side<0?entrances:arrivals).some(e=>Math.abs(delta(a,e.a))*walkR<2);
            if(open)continue;
            const r=walkR+side*(walkHalf-.13);
            ringBand(P,cx,cz,r-.1,r+.1,t=>walkY(t)-.04,t=>walkY(t)+.86,a0,a1,{kind:K.STONE,seg:1});
          }
          component='outer-walk';
        }
      }
      const pavedLine=(a,b,width,y0=null,y1=null)=>{
        const length=Math.hypot(b.x-a.x,b.z-a.z);
        if(length<.02)return; // the street endpoint already lies on the circuit
        const n=Math.max(1,Math.ceil(length/1.2),y0===null?1:Math.ceil(Math.abs(y1-y0)/.18)),dx=(b.x-a.x)/length,dz=(b.z-a.z)/length;
        for(let k=0;k<n;k++){
          const u=(k+.5)/n,x=a.x+(b.x-a.x)*u,z=a.z+(b.z-a.z)*u;let y=-Infinity,low=Infinity;
          for(const q of [-1,0,1])for(const side of [-1,1]){const xx=x+dx*q*length/n/2-dz*width/2*side,zz=z+dz*q*length/n/2+dx*width/2*side,h=ground(xx,zz);y=Math.max(y,h+.14);low=Math.min(low,h-.65);}
          if(y0!==null){y=y0+(y1-y0)*u;boxF(P,x,z,length/n/2+.012,width/2,Math.min(low,y-.35),y,Math.atan2(dz,dx),{kind:K.PAVING});}
          else {
            const corners=[[k/n,-1],[k/n,1],[(k+1)/n,1],[(k+1)/n,-1]].map(([t,side])=>{const x=a.x+(b.x-a.x)*t-dz*width/2*side,z=a.z+(b.z-a.z)*t+dx*width/2*side,h=ground(x,z)+.14,blend=y1===null?0:Math.min(1,Math.max(0,(t*length-Math.max(0,length-6))/Math.max(.1,Math.min(length,6)-1.5)));return{x,z,y:h+(y1-h)*blend};});
            pathSlab(P,corners,Math.min(low,...corners.map(p=>p.y-.4)));
          }
        }
      };
      for(const e of arrivals)pavedLine(e.street,e.walk,2.5,null,walkY(e.a));
      component='entrance';
      for(const e of entrances){const out={x:cx+Math.cos(e.a)*walkR,z:cz+Math.sin(e.a)*walkR},edge={x:cx+Math.cos(e.a)*(RT+.03),z:cz+Math.sin(e.a)*(RT+.03)},inside={x:cx+Math.cos(e.a)*(RT-4),z:cz+Math.sin(e.a)*(RT-4)};pavedLine(out,edge,2.5,e.arrivalY,e.bottom);pavedLine(edge,inside,2.5,e.bottom,e.bottom);}
      component='architecture';
      // ---- the colonnade: columns wherever the terrace is clear of the hill, gates on four axes
      const nCol = Math.max(24, Math.round((TAU * RC) / 6.5));
      const gate = (a) => gateAngles.some(g=>Math.abs(delta(a,g))*RC<7);
      const has = [];
      for (let k = 0; k < nCol; k++) {
        const a = (k / nCol) * TAU;
        const x = cx + Math.cos(a) * RC, z = cz + Math.sin(a) * RC;
        has.push(!gate(a) && !buried(x, z, 1.8, -0.05) && !avoid(x, z, 4));
      }
      // runs of consecutive columns (a run may wrap round past k = 0)
      const runs = [];
      const start = has.indexOf(false);
      if (start >= 0) {
        let cur = null;
        for (let j = 1; j <= nCol; j++) {
          const k = (start + j) % nCol;
          if (has[k]) { if (!cur) cur = [start + j, start + j]; else cur[1] = start + j; } else if (cur) { runs.push(cur); cur = null; }
        }
        if (cur) runs.push(cur);
      }
      for (const [k0, k1] of runs) {
        if (k1 - k0 < 2) continue;                   // a lone pair of columns carries nothing
        const a0 = (k0 / nCol) * TAU - 1.2 / RC, a1 = (k1 / nCol) * TAU + 1.2 / RC;
        // stylobate: two steps, sunk a little into the paving
        ringBand(P, cx, cz, RC - 1.7, RC + 1.7, Y0 - 0.05, Y0 + 0.2, a0 - 0.6 / RC, a1 + 0.6 / RC, { kind: K.PAVING });
        ringBand(P, cx, cz, RC - 1.25, RC + 1.25, Y0 + 0.2, Y0 + 0.42, a0 - 0.2 / RC, a1 + 0.2 / RC, { kind: K.PAVING });
        for (let k = k0; k <= k1; k++) {
          const a = (k / nCol) * TAU;
          column(list, cx + Math.cos(a) * RC, Y0 + 0.42, cz + Math.sin(a) * RC, hC, lod);
        }
        // entablature: architrave, frieze, and a cornice with a planted top
        const yE = Y0 + 0.42 + hC;
        ringBand(P, cx, cz, RC - 0.85, RC + 0.85, yE, yE + 0.85, a0, a1, { kind: K.STONE });
        ringBand(P, cx, cz, RC - 0.7, RC + 0.7, yE + 0.85, yE + 1.7, a0 + 0.1 / RC, a1 - 0.1 / RC, { kind: lod ? K.STONE : K.METAL });
        ringBand(P, cx, cz, RC - 1.2, RC + 1.2, yE + 1.7, yE + 2.15, a0 - 0.3 / RC, a1 + 0.3 / RC, { kind: K.STONE, top: K.GARDEN });
        if (!lod) {
          // dentils under the cornice, a guttae band over the architrave
          const nd = Math.floor(((a1 - a0) * (RC + 0.72)) / 0.9);
          for (let i = 0; i < nd; i++) {
            const a = a0 + ((i + 0.5) / nd) * (a1 - a0);
            for (const [rr, sg] of [[RC + 0.78, 1], [RC - 0.78, -1]]) boxF(P, cx + Math.cos(a) * rr, cz + Math.sin(a) * rr, 0.16, 0.09, yE + 1.52, yE + 1.7, a + Math.PI / 2, { bottom: true });
          }
        }
      }
      // ---- the fountain, toward the lagoon, on the terrace between the colonnade and the parapet
      const rF = base + 11.6;
      const fx = cx + Math.cos(fountainAngle??toL) * rF, fz = cz + Math.sin(fountainAngle??toL) * rF;
      if (fountainAngle!==null) {
        const basin = [
          [4.0, -0.05, K.STONE], [4.0, 0.62, K.STONE], [4.12, 0.64, K.STONE], [4.12, 0.78, K.STONE], [3.5, 0.78, K.STONE], [3.5, 0.52, K.STONE],
          [0.95, 0.52, K.POOL], [0.95, 0.52, K.STONE], [0.9, 0.9, K.STONE], [0.6, 1.3, K.STONE], [0.42, 1.6, K.STONE],
        ];
        const top = lod ? [[0.4, 2.7, K.STONE], [0.05, 3.1, K.STONE]] : [
          [0.38, 2.1, K.STONE], [0.55, 2.2, K.STONE], [1.9, 2.55, K.STONE], [2.0, 2.78, K.STONE], [1.78, 2.8, K.STONE], [1.74, 2.64, K.STONE],
          [0.34, 2.64, K.POOL], [0.34, 2.64, K.STONE], [0.26, 3.5, K.STONE], [0.42, 3.62, K.STONE], [0.3, 3.85, K.STONE], [0.06, 4.35, K.LANTERN],
        ];
        lathe(list, fx, Y0, fz, [...basin, ...top], lod ? 16 : 48);
      }
      // ---- obelisks on stepped plinths on the cross axes
      for (const a of obeliskAngles) {
        const ox = cx + Math.cos(a) * rF, oz = cz + Math.sin(a) * rF;
        if (buried(ox, oz, 2.4, -0.05) || avoid(ox, oz, 4)) continue;
        boxF(P, ox, oz, 2.1, 2.1, Y0 - 0.05, Y0 + 0.4, a, { kind: K.PAVING });
        boxF(P, ox, oz, 1.6, 1.6, Y0 + 0.4, Y0 + 0.85, a, { kind: K.PAVING });
        boxF(P, ox, oz, 1.1, 1.1, Y0 + 0.85, Y0 + 2.0, a, { kind: K.STONE });
        lathe(list, ox, Y0, oz, [[1.05, 1.95, K.STONE], [0.95, 2.2, K.STONE], [0.6, 12.2, K.STONE], [0.02, 13.2, K.LANTERN]], 4, { phase: Math.PI / 4 + a });
      }
      Array.prototype.push.call(list,P.geometry());
      return mergeClean(list);
    };
    const near = new THREE.Mesh(build(false), mat), far = new THREE.Mesh(build(true), mat);
    for (const m of [near, far]) {
      m.name = 'Rim forecourts';
      m.castShadow = true; m.receiveShadow = true;
      m.matrixAutoUpdate = false; m.updateMatrix();
      scene.add(m);
    }
    near.geometry.computeBoundingSphere(); far.geometry.computeBoundingSphere();
    sets.push({ near, far, center: new THREE.Vector3(cx, Y0, cz), radius: RT,entrances,arrivals,monuments,walkRadius:walkR,walkHalfWidth:walkHalf });
    // lamps just inside the parapet, clear of the fountain, the obelisks and the gates' axes
    const nL = Math.max(12, Math.round((TAU * RT) / 26));
    for (let k = 0; k < nL; k++) {
      const a = ((k + 0.5) / nL) * TAU;
      const rl = RT - 1.4;
      const x = cx + Math.cos(a) * rl, z = cz + Math.sin(a) * rl;
      const clearOf = monuments.every(m=>Math.hypot(x-m.x,z-m.z)>m.radius+2)&&entrances.every(e=>inStair(a,e)===null&&Math.abs(delta(a,e.a))*RT>4);
      if (!clearOf || buried(x, z, 0.6, -0.05) || avoid(x, z, 2)) continue;
      lamps.push({ x, y: Y0 - 0.05, z, yaw: a + Math.PI, cls: 0 });
    }
  }
  const api = {
    meshes: sets.flatMap((s) => [s.near, s.far]), lamps, sets,
    nearDist: 1100,
    update(camera) {
      if (!camera) return;
      const cp = camera.position;
      for (const s of sets) {
        const near = cp.distanceTo(s.center) - s.radius < this.nearDist;
        // near: detail in the main view, massing in the (cheaper) reflection pass
        s.near.visible = near;
        s.near.layers.set(near ? 1 : 0);
        s.far.layers.set(near ? 2 : 0);
      }
    },
  };
  return api;
}

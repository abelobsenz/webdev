import * as THREE from 'three';
import { createFacadeMaterial } from './facade.js';
import { latheFacade, loftSections, sweepTube, mergeClean } from './geom.js';
import { islandPrism, islandFoundation, islandRoad, footprintGround, rectangle, circleFootprint, pointSegmentDistance, smoothPath, resamplePath } from './islandPlan.js';
import { mulberry32 } from './noise.js';
import { buildOuterLOD } from './outerLod.js';
import { renderedHeight } from './outerCities.js';

// The massif terrace towns: Ridgeholm, Highgate, Cloudmere. Each is a hill town on the lower
// southern slope of its massif, within ~0.9 km of its gondola top station:
//   terraces    level streets and garden terraces cut along the contours every 10 m of height,
//               each a closed solid whose back edge meets the slope and whose front is a
//               retaining wall reaching down past the ground below
//   houses      rows seated on the terraces against the hillside, following the contour,
//               gabled or with roof gardens, a few chapels with bell towers among them
//   stairs      flights climbing between terrace levels through gaps in the rows
//   the square  a civic podium in front of the gondola top station: town hall with its dome
//               and clock tower, a chapel, a fountain, a grand stair down to the slope
//   funicular   an inclined track from the square up through the upper town
//   towers      three slim towers on their own plinths
// Everything is sampled on the terrain exactly as it is drawn (renderedHeight). The massing
// (terraces, houses, square, towers) is one mesh seen from the lagoon; stairs, parapets,
// chimneys and the funicular furniture are a near set dropped beyond 4.5 km.

const TAU = Math.PI * 2;
const DH = 10;                       // height between terrace levels (m)
const NEAR_DIST = 4500;
const TOWN_CELL = 300, MASS_TIER = 2;
const MASSIF_LOD = [{ dist: 0, cast: true }, { dist: NEAR_DIST, cast: true }, { dist: 8500, cast: false }];

// ------------------------------------------------------------ solid builder --
// Triangles are wound to face a given outward direction, so every closed part is correct
// from all sides; degenerate triangles are dropped (no zero normals).
class Solid {
  constructor() { this.pos = []; this.fac = []; this.components = []; }
  begin() { return this.pos.length / 3; }
  end(start, kind) { if(this.pos.length / 3 > start)this.components.push({ start, count:this.pos.length / 3-start, kind }); }
  tri(a, b, c, fa, fb, fc, out) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (Math.hypot(nx, ny, nz) < 1e-5) return;
    if (nx * out[0] + ny * out[1] + nz * out[2] < 0) { [b, c] = [c, b]; [fb, fc] = [fc, fb]; }
    this.pos.push(...a, ...b, ...c);
    this.fac.push(...fa, ...fb, ...fc);
  }
  quad(a, b, c, e, fa, fb, fc, fe, out) { this.tri(a, b, c, fa, fb, fc, out); this.tri(a, c, e, fa, fc, fe, out); }
  /** A vertical wall from (a, ya0..ya1) to (b, yb0..yb1). */
  wall(a, b, ya0, yb0, ya1, yb1, kind, out, u0 = 0) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    this.quad([a[0], ya0, a[1]], [b[0], yb0, b[1]], [b[0], yb1, b[1]], [a[0], ya1, a[1]],
      [u0, ya0, kind], [u0 + L, yb0, kind], [u0 + L, yb1, kind], [u0, ya1, kind], out);
    return u0 + L;
  }
  /** A horizontal-ish face over four corners (x, y, z); facade coords are plan x, z. */
  face(p, kind, out) { const f = p.map((q) => [q[0], q[2], kind]); this.quad(p[0], p[1], p[2], p[3], f[0], f[1], f[2], f[3], out); }
  /** A prism over a four-corner footprint q[i] = [x, z], from y0 to y1 (numbers or per-corner arrays). */
  prism(q, y0, y1, wallK, topK) {
    const start=this.begin();
    const Y0 = Array.isArray(y0) ? y0 : [y0, y0, y0, y0], Y1 = Array.isArray(y1) ? y1 : [y1, y1, y1, y1];
    const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cz = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
    let u = 0;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, a = q[i], b = q[j];
      u = this.wall(a, b, Y0[i], Y0[j], Y1[i], Y1[j], wallK, [(a[0] + b[0]) / 2 - cx, 0, (a[1] + b[1]) / 2 - cz], u);
    }
    this.face(q.map((p, i) => [p[0], Y1[i], p[1]]), topK, [0, 1, 0]);
    this.face(q.map((p, i) => [p[0], Y0[i], p[1]]), wallK, [0, -1, 0]);
    this.end(start,'prism');
  }
  geometry() {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aFacade', new THREE.Float32BufferAttribute(this.fac, 3));
    g.computeVertexNormals();
    return g;
  }
}

function polygonsOverlap(a,b,pad=.00001){
  for(const poly of [a,b])for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],nx=-(q[1]-p[1]),nz=q[0]-p[0],A=a.map(p=>p[0]*nx+p[1]*nz),B=b.map(p=>p[0]*nx+p[1]*nz);if(Math.max(...A)<=Math.min(...B)+pad||Math.max(...B)<=Math.min(...A)+pad)return false;}return true;
}

/** Shared surveyed arrival datum for the town square and gondola top station. */
export function massifArrival(m) {
  const C = m.town, y0 = renderedHeight(C.x, C.z);
  // downhill: the mean slope over the town centre, leaning toward the lagoon
  let gx = 0, gz = 0;
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * TAU, r = k ? 180 : 0, x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r;
    gx += renderedHeight(x + 40, z) - renderedHeight(x - 40, z);
    gz += renderedHeight(x, z + 40) - renderedHeight(x, z - 40);
  }
  let dx = -gx, dz = -gz;
  const gl = Math.hypot(dx, dz);
  if (gl < 1e-6) { dx = 0; dz = 1; } else { dx /= gl; dz /= gl; }
  dx = dx * 0.7; dz = dz * 0.7 + 0.3;
  const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
  const down = [dx, dz], side = [-dz, dx], bounds = { u0:-52, u1:52, t0:-2, t1:64 };
  const W = (u, t) => [C.x + side[0] * u + down[0] * t, C.z + side[1] * u + down[1] * t];
  const footprint = [W(bounds.u0,bounds.t0),W(bounds.u1,bounds.t0),W(bounds.u1,bounds.t1),W(bounds.u0,bounds.t1)];
  // Include the complete perimeter and interior, rather than a grid that can omit
  // the final edge. A shared datum prevents the station roof being buried in the square.
  const stationFootprint=circleFootprint(C.x,C.z,20.8,40),squareGround=footprintGround(footprint,2),stationGround=footprintGround(stationFootprint,1);
  const level = Math.max(y0,squareGround.max,stationGround.max)+.35;
  const obstructions=[{name:'arrival square',q:footprint,top:level}];
  const H=p=>renderedHeight(...p),points=[];
  let t=bounds.t1,y=level;
  points.push([...W(0,t),y]);
  for(let k=0;k<800;k++){
    const next=t+.5,g=footprintGround([W(-7,next),W(7,next),W(7,next+4),W(-7,next+4)],.75).max;
    if(y-.26<g+.1){points.push([...W(0,next),y]);t=next;break;}
    points.push([...W(0,next),y]);y-=.26;points.push([...W(0,next),y]);t=next;
  }
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];if(Math.hypot(b[0]-a[0],b[1]-a[1])<1e-6)continue;
    const q=[[a[0]+side[0]*7,a[1]+side[1]*7],[a[0]-side[0]*7,a[1]-side[1]*7],[b[0]-side[0]*7,b[1]-side[1]*7],[b[0]+side[0]*7,b[1]+side[1]*7]];
    obstructions.push({name:'grand stair',q,top:Math.max(a[2],b[2])});
  }
  const toe=[W(-7,t),W(7,t),W(7,t+4),W(-7,t+4)],exitSide=H(W(7,t+2))>=H(W(-7,t+2))?1:-1,exitA=W(exitSide*7,t+2),exitB=W(exitSide*19,t+2),exitSteps=[];
  obstructions.push({name:'grand stair toe',q:toe,top:y});
  let previous=null;
  for(let k=0;k<=24;k++){
    const f=k/24,u=exitSide*(7+f*12),edge=[W(u,t+.2),W(u,t+3.8)],ys=edge.map(p=>k===24?H(p):Math.max(H(p)+.012,y*(1-f)+H(p)*f));
    if(previous){const q=[previous.edge[0],previous.edge[1],edge[1],edge[0]],top=[previous.ys[0],previous.ys[1],ys[1],ys[0]];exitSteps.push({q,top,edge});obstructions.push({name:'grand stair grade exit',q,top:Math.max(...top)});}
    previous={edge,ys};
  }
  const grandStair={points,t,y,toe,exitA,exitB,exitSteps};
  // Highgate's downhill direction crosses the gondola approach obliquely. Its
  // shortened hall opens an arrival forecourt outside the two cabin envelopes.
  const mirror=m.id==='cloudmere'?-1:1,hall={u:-38*mirror,t0:m.id==='highgate'?21:8,t1:m.id==='highgate'?62:58,domeT:m.id==='highgate'?41:33,clockT:55},chapelPlan={u:38*mirror,t:m.id==='cloudmere'?43:22,w:16,depth:m.id==='cloudmere'?20:30},fountain={u:18*mirror,t:36},lampUs=[-20*mirror,27*mirror];
  const localRect=(u0,u1,t0,t1)=>[W(u0,t0),W(u1,t0),W(u1,t1),W(u0,t1)],round=(u,t,r)=>circleFootprint(...W(u,t),r*1.005,32);
  obstructions.push({name:'town hall',q:localRect(hall.u-12,hall.u+12,hall.t0,hall.t1),top:level+17},
    {name:'town hall dome',q:round(hall.u,hall.domeT,9),top:level+33},
    {name:'town hall clock',q:round(hall.u,hall.clockT,5.2),top:level+46},
    {name:'chapel nave and roof',q:localRect(chapelPlan.u-8,chapelPlan.u+8,chapelPlan.t,chapelPlan.t+chapelPlan.depth),top:level+19},
    {name:'chapel bell tower',q:round(chapelPlan.u+5,chapelPlan.t+1,4.3),top:level+40},
    {name:'square fountain',q:round(fountain.u,fountain.t,7),top:level+3.1});
  for(let k=0;k<6;k++)for(const u of lampUs)obstructions.push({name:'square lamp',q:round(u,10+k*10,.4),top:level+4.9});
  return { center:[C.x,C.z], terrainY:y0, down, side, bounds, footprint, stationFootprint, squareGround, stationGround, level, hall, chapel:chapelPlan, fountain, lampUs, grandStair, obstructions };
}

// --------------------------------------------------------------- one town --
function buildTown(m, rnd, lights, audit = false) {
  const C=m.town,arrivalPlan=massifArrival(m),{terrainY:y0,down:d,side:s,bounds:SQ,footprint:sq,level:yp}=arrivalPlan;
  const W = (u, t) => [C.x + s[0] * u + d[0] * t, C.z + s[1] * u + d[1] * t];
  const H = (p) => renderedHeight(p[0], p[1]);
  const base = new Solid(), near = new Solid(), lathes = [], nearLathes = [];
  const rotY = Math.atan2(-s[1], s[0]);                     // local x -> s

  // keep-outs: the gondola corridor (down toward the station), the station, the square,
  // the funicular and the towers
  const segD = (p, a, b) => {
    const vx = b[0] - a[0], vz = b[1] - a[1], L2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / L2));
    return Math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vz * t);
  };
  const gondA = [C.x, C.z], gondB = [m.station.x, m.station.z];
  const funA = W(-78, 30), funB = W(-78, -470);
  const blocked = [], civicCorridors = [];
  const local = (p) => { const x = p[0] - C.x, z = p[1] - C.z; return [x * s[0] + z * s[1], x * d[0] + z * d[1]]; };
  const free = (p, pad = 0) => {
    const [u, t] = local(p);
    if (u > SQ.u0 - 8 - pad && u < SQ.u1 + 8 + pad && t > SQ.t0 - 8 - pad && t < SQ.t1 + 8 + pad) return false;
    if (Math.hypot(p[0] - C.x, p[1] - C.z) < 30 + pad) return false;
    if (segD(p, gondA, gondB) < 13 + pad) return false;
    if (segD(p, funA, funB) < 6 + pad) return false;
    for (const b of blocked) if (Math.hypot(p[0] - b.x, p[1] - b.z) < b.r + pad) return false;
    for(const [a,b]of civicCorridors)if(segD(p,a,b)<8+pad)return false;
    return true;
  };
  const ph = rnd() * TAU;
  const Rt = (p) => { const [u, t] = local(p); const a = Math.atan2(t, u); return 880 + 150 * Math.sin(3 * a + ph) + 90 * Math.sin(5 * a); };
  const inTown = (p) => Math.hypot(p[0] - C.x, p[1] - C.z) < Rt(p);

  // ---- the square: a level podium in front of the top station, the civic centre on it
  // The upper edge meets the station at their shared surveyed arrival datum.
  base.prism(sq, arrivalPlan.squareGround.min - 3, yp, 1, 9);base.components.at(-1).terrace={kind:'station square',level:yp};
  // Grand stair and graded toe share their plan with the cable clearance survey.
  {
    const {points,t,y,toe,exitA,exitB,exitSteps}=arrivalPlan.grandStair;
    stairSolid(base,points,d,14,H);
    const toeStart=base.components.length;
    base.prism(toe,footprintGround(toe,1).min-1.5,y,1,9);base.components[toeStart].landing={q:toe,y,kind:'grand stair toe'};
    exitSteps.forEach(({q,top,edge},k)=>{const first=base.components.length;base.prism(q,q.map(H).map(y=>y-1.5),top,1,9);if(k===exitSteps.length-1)base.components[first].gradeExit={edge};});
    civicCorridors.push([W(0,SQ.t1),W(0,t+4)],[exitA,exitB]);
  }
  // town hall on the west side, a domed roof and a clock tower
  {
    const hall=arrivalPlan.hall,q = [W(hall.u-12,hall.t0),W(hall.u+12,hall.t0),W(hall.u+12,hall.t1),W(hall.u-12,hall.t1)];
    base.prism(q, yp - 1, yp + 17, 5, 1);
    const hc = W(hall.u,hall.domeT);
    lathes.push(latheFacade([{ r: 9, y: yp + 16.5, kind: 1 }, { r: 9, y: yp + 19, kind: 0 }, { r: 8.6, y: yp + 21, kind: 1 },
      { r: 7.4, y: yp + 25, kind: 7 }, { r: 4.4, y: yp + 28.5, kind: 7 }, { r: 1.2, y: yp + 30, kind: 2 }, { r: 0.01, y: yp + 33, kind: 2 }], 20).translate(hc[0], 0, hc[1]));
    const tc = W(hall.u,hall.clockT);
    lathes.push(latheFacade([{ r: 4.6, y: yp - 1, kind: 1 }, { r: 4.6, y: yp + 30, kind: 5 }, { r: 5.2, y: yp + 30, kind: 1 }, { r: 5.2, y: yp + 31.2, kind: 1 },
      { r: 4.2, y: yp + 31.2, kind: 2 }, { r: 4.2, y: yp + 36, kind: 2 }, { r: 5, y: yp + 36, kind: 1 }, { r: 0.05, y: yp + 46, kind: 11 }], 4, { phase: Math.PI / 4 }).rotateY(rotY).translate(tc[0], 0, tc[1]));
    lights.push({ x: tc[0], y: yp + 34, z: tc[1], c: [1.0, 0.85, 0.6], s: 2.2 });
  }
  // the square's chapel on the east side
  const cp=arrivalPlan.chapel;chapel(base, lathes, W, cp.u, cp.t, cp.w, cp.depth, yp, rotY, s, d, lights);
  // fountain in the middle of the square, a colonnade of lamps along its sides
  {
    const f = W(arrivalPlan.fountain.u,arrivalPlan.fountain.t);
    nearLathes.push(latheFacade([{ r: 7, y: yp - 0.3, kind: 1 }, { r: 7, y: yp + 0.8, kind: 1 }, { r: 6.4, y: yp + 0.8, kind: 1 },
      { r: 6.4, y: yp + 0.5, kind: 6 }, { r: 1.2, y: yp + 0.5, kind: 1 }, { r: 1.2, y: yp + 2.6, kind: 1 }, { r: 2.2, y: yp + 2.8, kind: 1 }, { r: 0.01, y: yp + 3.1, kind: 6 }], 24).translate(f[0], 0, f[1]));
    for (let k = 0; k < 6; k++) for (const u of arrivalPlan.lampUs) {
      const p = W(u, 10 + k * 10);
      nearLathes.push(latheFacade([{ r: 0.14, y: yp - 0.2, kind: 10 }, { r: 0.1, y: yp + 4.2, kind: 10 }, { r: 0.4, y: yp + 4.3, kind: 2 }, { r: 0.01, y: yp + 4.9, kind: 2 }], 5).translate(p[0], 0, p[1]));
    }
  }

  // ---- slim towers on their own plinths, round the upper town
  for (let k = 0, tries = 0; k < 3 && tries < 40; tries++) {
    const a = -Math.PI / 2 + (rnd() - 0.5) * 2.4, r = 260 + rnd() * 380;
    const p = W(Math.cos(a) * r, Math.sin(a) * r * 0.8);
    const R = 11 + rnd() * 5;
    if (!free(p, R + 10)) continue;
    let gmin = Infinity, gmax = -Infinity;
    for (let i = 0; i < 8; i++) { const g = H([p[0] + Math.cos(i * TAU / 8) * R * 1.6, p[1] + Math.sin(i * TAU / 8) * R * 1.6]); gmin = Math.min(gmin, g); gmax = Math.max(gmax, g); }
    if (gmax - gmin > 22) continue;
    const Ht = 80 + rnd() * 70, yb = gmax + 0.8;
    const prof = [{ r: R * 1.6, y: gmin - 3, kind: 1 }, { r: R * 1.6, y: yb, kind: 5 }, { r: R, y: yb, kind: 9 }];
    for (let j = 1; j <= 5; j++) { const v = j / 5; prof.push({ r: R * (1 - 0.28 * v), y: yb + Ht * v, kind: j === 5 ? 1 : 5 }); }
    prof.push({ r: R * 0.8, y: yb + Ht + 1.5, kind: 1 }, { r: R * 0.55, y: yb + Ht + 1.5, kind: 2 }, { r: R * 0.5, y: yb + Ht + 9, kind: 2 }, { r: 0.4, y: yb + Ht + 12, kind: 1 }, { r: 0.01, y: yb + Ht + 24, kind: 2 });
    lathes.push(latheFacade(prof, 12, { phase: rnd() * TAU }).translate(p[0], 0, p[1]));
    lights.push({ x: p[0], y: yb + Ht + 12, z: p[1], c: [1.0, 0.82, 0.6], s: 2 });
    blocked.push({ x: p[0], z: p[1], r: R * 1.6 + 6 });
    k++;
  }

  // ---- each town has a distinct civic destination beyond the gondola square.
  // Its footprint is reserved before contour streets and its approach are constructed.
  {
    let site=null;
    for(const u of [200,280,360,440,520,600])for(const t of [-300,-210,-120,-30,60]){
      const p=W(u,t);if(!free(p,88))continue;
      const q=rectangle(p[0],p[1],144,96,Math.atan2(s[1],s[0])),g=footprintGround(q,10);
      if(g.max-g.min>35)continue;
      const score=g.max-g.min+Math.hypot(u,t)*.012;if(!site||score<site.score)site={u,t,p,q,score};
    }
    if(site){
      const parts=[],top=islandFoundation(parts,site.q,{name:`${m.name} civic terrace`}),Cw=(u,t)=>W(site.u+u,site.t+t),angle=Math.atan2(s[1],s[0]);
      const box=(u,t,w,dp,h,wall=5,roof=1,yy=top)=>{const p=Cw(u,t);parts.push(islandPrism(rectangle(p[0],p[1],w,dp,angle),yy-.2,yy+h,wall,roof));};
      if(m.id==='ridgeholm'){
        // Stone craft courts: three working wings open toward the square and a sheltered
        // market arcade. The low slate roofs sit comfortably among the contour houses.
        for(const u of [-48,48])box(u,0,23,73,12,5,11);
        box(0,-34,76,18,14,5,11);
        for(let u=-30;u<=30;u+=12){const p=Cw(u,30);parts.push(latheFacade([{r:.7,y:top,kind:1},{r:.6,y:top+8,kind:1}],8).translate(p[0],0,p[1]));}
        box(0,30,70,8,1.2,8,11,top+8);
        const p=Cw(0,0);parts.push(latheFacade([{r:8,y:top,kind:1},{r:8,y:top+.9,kind:1},{r:7,y:top+.9,kind:1},{r:7,y:top+.6,kind:6},{r:.1,y:top+.6,kind:6}],24).translate(p[0],0,p[1]));
      }else if(m.id==='highgate'){
        // A literal high gate: two libraries support a stone sky arch, framing the massif.
        for(const u of [-28,28]){box(u,-12,21,30,33,5,1);box(u,-12,24,33,1.6,1,3,top+33);}
        const arc=[];for(let k=0;k<=24;k++){const f=k/24,p=Cw(-28+56*f,-12);arc.push(new THREE.Vector3(p[0],top+27+12*Math.sin(Math.PI*f),p[1]));}
        parts.push(sweepTube(arc,()=>2.4,10,{kind:1}));
        for(const u of [-48,48])box(u,29,31,14,1.1,1,3);
        const p=Cw(0,27);parts.push(latheFacade([{r:5,y:top,kind:1},{r:5,y:top+1.2,kind:1},{r:2,y:top+1.2,kind:7},{r:.08,y:top+18,kind:2}],8).translate(p[0],0,p[1]));
      }else{
        // Cloudmere's public cloud garden is a trio of closed glass winter gardens.
        for(const u of [-42,0,42]){
          const p=Cw(u,-7),sections=[{y:top,pts:rectangle(p[0],p[1],28,64,angle),kind:1},{y:top+7,pts:rectangle(p[0],p[1],28,64,angle),kind:0}];
          for(let k=1;k<=8;k++){const f=k/9;sections.push({y:top+7+12*Math.sin(f*Math.PI/2),pts:rectangle(p[0],p[1],28*Math.cos(f*Math.PI/2),64,angle),kind:k>6?2:0});}
          parts.push(loftSections(sections));
        }
        for(const u of [-30,30])box(u,35,35,10,1.1,1,3);
      }
      // The platform is an inhabited civic terrace. Stone edge ribs carry the retaining
      // face; planted walks and a clearly open arrival keep its large court legible.
      const green=(u,t,w,dp)=>box(u,t,w,dp,.85,1,3);
      const tree=(u,t)=>{const p=Cw(u,t);parts.push(latheFacade([{r:.55,y:top+.8,kind:8},{r:.4,y:top+4.7,kind:8}],8).translate(p[0],0,p[1]));parts.push(latheFacade([{r:.1,y:top+3.7,kind:3},{r:2.5,y:top+4.5,kind:3},{r:3,y:top+6.5,kind:3},{r:1.8,y:top+8.2,kind:3},{r:.1,y:top+9.3,kind:3}],12).translate(p[0],0,p[1]));};
      const canopy=(u0,t,u1,h=7)=>{
        for(let u=u0;u<=u1+.01;u+=10){const p=Cw(u,t);parts.push(latheFacade([{r:.7,y:top,kind:1},{r:.55,y:top+h,kind:1}],8).translate(p[0],0,p[1]));}
        box((u0+u1)/2,t,u1-u0+2,6,.8,1,3,top+h);
      };
      for(const u of [-65,65]){green(u,-4,7,75);for(const t of [-28,-5,18])tree(u,t);}
      for(const u of [-68,-36,36,68]){
        const p=Cw(u,49),q=rectangle(p[0],p[1],4.2,6,angle);
        islandFoundation(parts,q,{top:top+.35,name:`${m.name} retaining pier`,kind:1});
      }
      for(const u of [-73,73])for(const t of [-32,-8,16,36]){
        const p=Cw(u,t),q=rectangle(p[0],p[1],4,3.5,angle);
        const g=footprintGround(q);if(g.max<=top+.3)islandFoundation(parts,q,{top:top+.35,name:`${m.name} retaining pier`,kind:1});
      }
      for(const u of [-71,71])box(u,0,1.7,96,1,1,1,top-.5);
      box(0,-47,144,1.7,1,1,1,top-.5);
      for(const [u0,u1]of [[-71,-62],[-54,-13],[13,54],[62,71]])box((u0+u1)/2,47,u1-u0,1.7,1,1,1,top-.5);
      // Two lower garden landings receive secondary pedestrian stairs. Their corridors
      // are reserved before the surrounding contour houses are admitted.
      for(const u of [-58,58]){
        const end=Cw(u,86),q=rectangle(end[0],end[1],11,10,angle),y=islandFoundation(parts,q,{name:`${m.name} stair garden landing`,kind:9});
        const start=Cw(u,48),gate=Cw(u,81),first=parts.length;islandRoad(parts,[start,gate],6,{startY:top,endY:y,steps:true});parts[first].userData.islandEntry={from:start,to:gate,startY:top,endY:y,kind:'massif garden stair',source:'foundation'};civicCorridors.push([start,end]);
      }
      if(m.id==='ridgeholm'){
        for(const u of [-21,21]){box(u,-6,16,8,.65,1,9);box(u,-6,6,3,3.2,1,1,top+.65);box(u,-6,3.4,3.4,2,1,3,top+3.85);}
        for(const u of [-23,23]){box(u,17,20,2.8,.7,8,1);box(u,18.4,20,.7,1.2,1,1);}
        box(0,39,17,14,.12,9,9,top+.02);
      }else if(m.id==='highgate'){
        // Shaded reading walks flank the libraries. The axis divides round its obelisk
        // and returns to the two front doors, without a path running through sculpture.
        for(const u of [-51,51])for(const t of [-24,-7,10]){const p=Cw(u,t);parts.push(latheFacade([{r:.7,y:top,kind:1},{r:.55,y:top+7.5,kind:1}],8).translate(p[0],0,p[1]));}
        for(const u of [-51,51])box(u,-7,12,39,.9,1,3,top+7.5);
        canopy(-60,-40,60,7);
        for(const u of [-10,10])box(u,25,5,32,.1,9,9,top+.02);
        box(0,42,25,7,.1,9,9,top+.02);box(0,7,72,6,.1,9,9,top+.02);
        for(const u of [-51,51])for(const t of [-19,4])box(u,t,8,3,.7,8,1);
      }else{
        canopy(-60,41,-10,6.5);canopy(10,41,60,6.5);
        for(const u of [-30,30])box(u,35,31,6,.13,6,6,top+1.1);
        box(0,36,12,21,.1,9,9,top+.02);
        for(const u of [-55,55])box(u,31,8,3,.7,8,1);
      }
      const A=W(SQ.u1,40),C=W(SQ.u1+36,site.t+100),M=Cw(0,100),B=Cw(0,48);
      const approach=islandRoad(parts,[A,C,M,B],7,{startY:yp,endY:top});parts.at(-1).userData.islandCivicApproach={from:A,to:B,startY:yp,endY:top,town:m.name};
      for(let k=1;k<approach.length;k++)for(const side of ['left','right']){
        const a=approach[k-1],b=approach[k],pa=a[side],pb=b[side],dx=pb[0]-pa[0],dz=pb[1]-pa[1],len=Math.hypot(dx,dz)||1,nx=-dz/len*.28,nz=dx/len*.28;
        parts.push(islandPrism([[pa[0]+nx,pa[1]+nz],[pb[0]+nx,pb[1]+nz],[pb[0]-nx,pb[1]-nz],[pa[0]-nx,pa[1]-nz]],[a.y-.12,b.y-.12,b.y-.12,a.y-.12],[a.y+1.05,b.y+1.05,b.y+1.05,a.y+1.05],1,1));
      }
      civicCorridors.push([A,C],[C,M],[M,B]);blocked.push({x:site.p[0],z:site.p[1],r:90});
      lathes.push(...parts);lights.push({x:site.p[0],y:top+12,z:site.p[1],c:[1,.85,.65],s:2.4});
    }
  }

  // ---- funicular: an inclined track on its embankment from the square up the town
  {
    const N = 50, sec = [];
    for (let i = 0; i <= N; i++) {
      const f = i / N, p = [funA[0] + (funB[0] - funA[0]) * f, funA[1] + (funB[1] - funA[1]) * f];
      sec.push([p[0], p[1], H(p) + 1.4]);
    }
    for (let i = 1; i < N; i++) sec[i][2] = (sec[i - 1][2] + sec[i][2] * 2 + H([sec[i + 1][0], sec[i + 1][1]]) + 1.4) / 4;
    for (const q of sec) q[2] = Math.max(q[2], H([q[0], q[1]]) + 0.6);
    const fd = [funB[0] - funA[0], funB[1] - funA[1]], fl = Math.hypot(fd[0], fd[1]);
    fd[0] /= fl; fd[1] /= fl;
    trackSolid(base, sec, fd, 5, 9, H, 0);
    for (const off of [-0.8, 0.8]) trackSolid(near, sec.map((q) => [q[0] - fd[1] * off, q[1] + fd[0] * off, q[2] + 0.18]), fd, 0.16, 10, null, 0.25);
    // stations at both ends and a car on the way
    for (const [p, y] of [[funA, sec[0][2]], [funB, sec[N][2]]]) {
      const q = [[-4.5, -5], [4.5, -5], [4.5, 5], [-4.5, 5]].map(([a, b]) => [p[0] - fd[1] * a + fd[0] * b, p[1] + fd[0] * a + fd[1] * b]);
      base.prism(q, Math.min(...q.map(H)) - 2, y + 5, 0, 1);
    }
    const i0 = 20, c0 = sec[i0], c1 = sec[i0 + 1];
    const cq = [[c0[0] - fd[1] * 1.6, c0[1] + fd[0] * 1.6], [c0[0] + fd[1] * 1.6, c0[1] - fd[0] * 1.6], [c1[0] + fd[1] * 1.6, c1[1] - fd[0] * 1.6], [c1[0] - fd[1] * 1.6, c1[1] + fd[0] * 1.6]];
    near.prism(cq, [c0[2] + 0.18, c0[2] + 0.18, c1[2] + 0.18, c1[2] + 0.18], [c0[2] + 3.4, c0[2] + 3.4, c1[2] + 3.4, c1[2] + 3.4], 0, 2);
  }

  // ---- contours: marching squares on a 12 m grid round the town, chained into polylines,
  // one terrace level every DH metres, worked from the top down so each level's stairs
  // land on the terrace below and the houses there keep clear of the landings
  const G = 12, NG = 161, X0 = C.x - 960, Z0 = C.z - 960;
  const hg = new Float32Array(NG * NG);
  for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) hg[j * NG + i] = renderedHeight(X0 + i * G, Z0 + j * G);
  const grad = (p) => {
    const e = 8;
    return [(H([p[0] + e, p[1]]) - H([p[0] - e, p[1]])) / (2 * e), (H([p[0], p[1] + e]) - H([p[0], p[1] - e])) / (2 * e)];
  };
  const levels = [];
  for (let L = Math.floor((y0 + 110) / DH) * DH; L >= y0 - 130; L -= DH) if (L > 12) levels.push(L);
  const landings = [], terracePlans = [], gapPlans = [], stairCorridors = [];
  for (const L of levels) {
    const garden = rnd() < 0.3;
    for (const line of contourLines(hg, NG, G, X0, Z0, L)) {
      const pts = resample(line, 12);
      if (pts.length < 4) continue;
      // downhill normals, smoothed along the line
      const raw = pts.map((P) => { const g = grad(P), l = Math.hypot(g[0], g[1]); return { g: l, n: l > 1e-6 ? [-g[0] / l, -g[1] / l] : null }; });
      const secs = [];
      let arc = 0, nextGap = 50 + rnd() * 90;
      const gapsHere = [];
      for (let k = 0; k < pts.length; k++) {
        if (k) arc += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
        let nx = 0, nz = 0;
        for (let q = Math.max(0, k - 1); q <= Math.min(pts.length - 1, k + 1); q++) if (raw[q].n) { nx += raw[q].n[0]; nz += raw[q].n[1]; }
        const nl = Math.hypot(nx, nz), sl = raw[k].g;
        const P = pts[k];
        if (arc > nextGap) { gapsHere.push({ P, n: nl > 1e-6 ? [nx / nl, nz / nl] : null }); nextGap = arc + 110 + rnd() * 70; secs.push(null); continue; }
        if (nl < 1e-6 || sl < 0.06 || sl > 1.4) { secs.push(null); continue; }
        const n = [nx / nl, nz / nl], D = Math.max(7, Math.min(22, 0.5 * DH / sl));
        const F = [P[0] + n[0] * D, P[1] + n[1] * D], gF = H(F);
        const ok = gF < L - 1.2 && L - gF < 16 && inTown(P) && free(P) && free(F) && free([P[0] + n[0] * D * 0.5, P[1] + n[1] * D * 0.5]);
        secs.push(ok ? { u: arc, P, F, gF, D, n } : null);
      }
      // runs of continuous sections (broken where the front edge would fold over)
      let run = [];
      const flush = () => { if (run.length >= 3) terracePlans.push({run,L,garden,id:m.id+':terrace:'+terracePlans.length,seed:Math.floor(rnd()*4294967296)}); run = []; };
      for (const q of secs) {
        if (q && run.length) {
          const a = run[run.length - 1], px = q.P[0] - a.P[0], pz = q.P[1] - a.P[1];
          const poly=[a.P,q.P,q.F,a.F],cross=poly.map((p,i)=>{const b=poly[(i+1)%4],c=poly[(i+2)%4];return (b[0]-p[0])*(c[1]-b[1])-(b[1]-p[1])*(c[0]-b[0]);});
          if ((q.F[0] - a.F[0]) * px + (q.F[1] - a.F[1]) * pz < 0.3 * (px * px + pz * pz) || !(cross.every(v=>v>.01)||cross.every(v=>v<-.01))) flush();
        }
        if (q) run.push(q); else flush();
      }
      flush();
      for(const gap of gapsHere)gapPlans.push({...gap,L});
    }
  }

  // Build the route network from real terrace polygons before admitting houses. A
  // marching-squares contour is only an estimate of terrain height; it is not a
  // landing. Every accepted flight has its own founded landings and connects the
  // promenade of one surviving terrace run to the promenade of the next level.
  const insideBox=new WeakMap(),inside=(p,q,pad=0)=>{let bb=insideBox.get(q);if(bb===undefined){let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity,area=0;for(let i=0;i<q.length;i++){const a=q[i],b=q[(i+1)%q.length];x0=Math.min(x0,a[0]);x1=Math.max(x1,a[0]);z0=Math.min(z0,a[1]);z1=Math.max(z1,a[1]);area+=a[0]*b[1]-b[0]*a[1];}bb=Math.abs(area)>1e-6?[x0-1e-3,x1+1e-3,z0-1e-3,z1+1e-3]:null;insideBox.set(q,bb);}
    // a point clearly outside the bounding box of a non-degenerate polygon is outside it
    if(bb&&(p[0]<bb[0]||p[0]>bb[1]||p[1]<bb[2]||p[1]>bb[3]))return false;
    let sign=0;for(let i=0;i<q.length;i++){const a=q[i],b=q[(i+1)%q.length],v=(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);if(Math.abs(v)<pad*Math.hypot(b[0]-a[0],b[1]-a[1]))return false;if(v){if(sign&&Math.sign(v)!==sign)return false;sign=Math.sign(v);}}return true;};
  // A promenade follows the surveyed land, not just the interpolated contour.
  // Where a bend brings a local ridge through its floor, ease the walk outward
  // on a founded stone ledge and move its balustrade with it.
  const walkQuad=(a,b)=>{
    const q=[[a.F[0]+a.n[0]*((a.walkShift||0)-4.2),a.F[1]+a.n[1]*((a.walkShift||0)-4.2)],[b.F[0]+b.n[0]*((b.walkShift||0)-4.2),b.F[1]+b.n[1]*((b.walkShift||0)-4.2)],[b.F[0]+b.n[0]*((b.walkShift||0)-.65),b.F[1]+b.n[1]*((b.walkShift||0)-.65)],[a.F[0]+a.n[0]*((a.walkShift||0)-.65),a.F[1]+a.n[1]*((a.walkShift||0)-.65)]];const dx=q[1][0]-q[0][0],dz=q[1][1]-q[0][1],len=Math.hypot(dx,dz),tx=dx/len,tz=dz/len;let nx=-tz,nz=tx;
    if(((q[2][0]+q[3][0]-q[0][0]-q[1][0])*nx+(q[2][1]+q[3][1]-q[0][1]-q[1][1])*nz)<0){nx=-nx;nz=-nz;}
    const widths=[(q[3][0]-q[0][0])*nx+(q[3][1]-q[0][1])*nz,(q[2][0]-q[1][0])*nx+(q[2][1]-q[1][1])*nz],cross=q.map((p,i)=>{const r=q[(i+1)%4],s=q[(i+2)%4];return(r[0]-p[0])*(s[1]-r[1])-(r[1]-p[1])*(s[0]-r[0]);});
    if(Math.min(...widths)>=2.6&&(cross.every(v=>v>.001)||cross.every(v=>v<-.001)))return q;
    // A sharply folded contour receives a small viewing landing wide enough to
    // turn on. Its convex footprint contains both adjoining walkway caps.
    const us=q.map(p=>(p[0]-q[0][0])*tx+(p[1]-q[0][1])*tz),vs=q.map(p=>(p[0]-q[0][0])*nx+(p[1]-q[0][1])*nz),u0=Math.min(...us),u1=Math.max(...us),v0=Math.min(...vs),v1=Math.max(Math.max(...vs),v0+2.8);
    return [[u0,v0],[u1,v0],[u1,v1],[u0,v1]].map(([u,v])=>[q[0][0]+tx*u+nx*v,q[0][1]+tz*u+nz*v]);
  };
  for(const plan of terracePlans){for(const sec of plan.run)sec.walkShift=0;for(let pass=0;pass<24;pass++){let changed=false;for(let i=1;i<plan.run.length;i++){const a=plan.run[i-1],b=plan.run[i];if(footprintGround(walkQuad(a,b),1.5).max>plan.L-.06){const old=a.walkShift+b.walkShift;a.walkShift=Math.min(3,a.walkShift+.25);b.walkShift=Math.min(3,b.walkShift+.25);changed ||= a.walkShift+b.walkShift>old;}}for(let i=1;i<plan.run.length;i++)plan.run[i].walkShift=Math.max(plan.run[i].walkShift,plan.run[i-1].walkShift-3);for(let i=plan.run.length-2;i>=0;i--)plan.run[i].walkShift=Math.max(plan.run[i].walkShift,plan.run[i+1].walkShift-3);if(!changed)break;}}
  const surveyedPlans=[],acceptedTerraces=new Map(),planCell=32;
  const nearby=(q)=>{const all=new Set(),xs=q.map(p=>p[0]),zs=q.map(p=>p[1]);for(let x=Math.floor(Math.min(...xs)/planCell);x<=Math.floor(Math.max(...xs)/planCell);x++)for(let z=Math.floor(Math.min(...zs)/planCell);z<=Math.floor(Math.max(...zs)/planCell);z++)for(const p of acceptedTerraces.get(x+','+z)||[])all.add(p);return [...all];};
  const accept=(q,L)=>{const xs=q.map(p=>p[0]),zs=q.map(p=>p[1]),part={q,L};for(let x=Math.floor(Math.min(...xs)/planCell);x<=Math.floor(Math.max(...xs)/planCell);x++)for(let z=Math.floor(Math.min(...zs)/planCell);z<=Math.floor(Math.max(...zs)/planCell);z++){const k=x+','+z;if(!acceptedTerraces.has(k))acceptedTerraces.set(k,[]);acceptedTerraces.get(k).push(part);}};
  for(const plan of terracePlans){let part=[plan.run[0]],serial=0;const flush=()=>{if(part.length>=2)surveyedPlans.push({...plan,run:part,id:serial?plan.id+':segment:'+serial:plan.id,seed:plan.seed+serial*997});part=[];serial++;};
    for(let i=1;i<plan.run.length;i++){const a=plan.run[i-1],b=plan.run[i],q=walkQuad(a,b),base=[a.P,b.P,b.F,a.F],overlap=[...nearby(q),...nearby(base)].some(t=>t.L>plan.L+.1&&(polygonsOverlap(t.q,q)||polygonsOverlap(t.q,base)));
      if(footprintGround(q,1).max>plan.L-.03||overlap){flush();part=[b];}else{part.push(b);accept(q,plan.L);accept(base,plan.L);}}
    flush();
  }
  terracePlans.splice(0,terracePlans.length,...surveyedPlans);
  const terraceQuads=[];
  for(const plan of terracePlans)for(let i=1;i<plan.run.length;i++){const a=plan.run[i-1],b=plan.run[i];terraceQuads.push({q:[a.P,b.P,b.F,a.F],walkQ:walkQuad(a,b),L:plan.L,id:plan.id,a,b});}
  const quadsByLevel=new Map(),terraceGrid=new Map();
  for(const t of terraceQuads){if(!quadsByLevel.has(t.L))quadsByLevel.set(t.L,[]);quadsByLevel.get(t.L).push(t);const xs=t.q.map(p=>p[0]),zs=t.q.map(p=>p[1]);for(let x=Math.floor(Math.min(...xs)/64);x<=Math.floor(Math.max(...xs)/64);x++)for(let z=Math.floor(Math.min(...zs)/64);z<=Math.floor(Math.max(...zs)/64);z++){const key=x+','+z;if(!terraceGrid.has(key))terraceGrid.set(key,[]);terraceGrid.get(key).push(t);}}
  const promenade=(a,b)=>{const n=[a.n[0]+b.n[0],a.n[1]+b.n[1]],nl=Math.hypot(...n);n[0]/=nl;n[1]/=nl;const p=[(a.F[0]+b.F[0])/2-n[0]*2.6,(a.F[1]+b.F[1])/2-n[1]*2.6];return {p,n};};
  const founded=(q,y,kind='stair landing')=>{const ground=footprintGround(q,1);const start=base.components.length;base.prism(q,ground.min-1.5,y,1,9);base.components[start].landing={q,y,kind};};
  const corridor=(a,b,width,y)=>{const len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<.1)return;const first=base.components.length;trackSolid(base,[[...a,y],[...b,y]],[(b[0]-a[0])/len,(b[1]-a[1])/len],width,9,H,0);base.components[first].landingWalk={from:a,to:b,width,y};stairCorridors.push({a,b,width,y0:y,y1:y});};
  const used=[];
  for(const {P,n,L}of gapPlans){
    if(!n||!inTown(P)||!free(P,5))continue;
    const neighbours=terracePlans.filter(t=>t.L===L).flatMap(t=>[{a:t.run[0],b:t.run[1],id:t.id},{a:t.run.at(-1),b:t.run.at(-2),id:t.id}]).map(({a,b,id})=>({a,b,id,d:Math.hypot(a.P[0]-P[0],a.P[1]-P[1])})).filter(v=>v.d<30).sort((a,b)=>a.d-b.d);
    if(!neighbours.length)continue;
    const upper=neighbours[0].a,upperNext=neighbours[0].b,depth=upper.D-2.6,U=[P[0]+n[0]*depth,P[1]+n[1]*depth],side=[upper.F[0]+(upperNext.F[0]-upper.F[0])*.25-upper.n[0]*2.6,upper.F[1]+(upperNext.F[1]-upper.F[1])*.25-upper.n[1]*2.6],angle=Math.atan2(-n[0],n[1]),uq=rectangle(U[0],U[1],5,4,angle),A=[U[0]+n[0]*2,U[1]+n[1]*2];
    if(footprintGround(uq,1).max>L-.01||!free(U,3)||used.some(p=>Math.hypot(p[0]-U[0],p[1]-U[1])<24))continue;
    const bridgeLength=Math.hypot(side[0]-U[0],side[1]-U[1]),bridgeAngle=Math.atan2(side[1]-U[1],side[0]-U[0]),bq=rectangle((side[0]+U[0])/2,(side[1]+U[1])/2,bridgeLength,3.4,bridgeAngle);
    if(footprintGround(bq,1).max>L-.01)continue;
    const candidates=[];
    for(const t of quadsByLevel.get(L-DH)||[]){const {p:V,n:vn}=promenade(t.a,t.b),delta=[V[0]-A[0],V[1]-A[1]],along=delta[0]*n[0]+delta[1]*n[1],lateral=Math.abs(delta[0]*n[1]-delta[1]*n[0]);if(along<12||along>75||lateral>24)continue;
      const approachLength=Math.hypot(...delta),dir=[delta[0]/approachLength,delta[1]/approachLength],B=[V[0]-dir[0]*1.9,V[1]-dir[1]*1.9],len=approachLength-1.9;if(len<12)continue;
      const orientation=Math.atan2(-dir[0],dir[1]),lq=rectangle(V[0],V[1],5,3.8,orientation),actualUpper=rectangle(A[0]-dir[0]*2,A[1]-dir[1]*2,5,4,orientation);
      if((side[0]-A[0])*dir[0]+(side[1]-A[1])*dir[1]>-1.8)continue;
      if(!lq.every(p=>inside(p,t.q,.06))||!inside(U,actualUpper)||footprintGround(lq,1).max>L-DH-.01||footprintGround(actualUpper,1).max>L-.01)continue;
      const upperCentre=[A[0]-dir[0]*2,A[1]-dir[1]*2],bridgeLen=Math.hypot(upperCentre[0]-side[0],upperCentre[1]-side[1]),bridgeFoot=rectangle((upperCentre[0]+side[0])/2,(upperCentre[1]+side[1])/2,bridgeLen,3.4,Math.atan2(upperCentre[1]-side[1],upperCentre[0]-side[0]));if(footprintGround(bridgeFoot,1).max>L-.01)continue;
      let clear=true;
      for(let k=1;k<Math.ceil(len);k++){const f=k/Math.ceil(len),p=[A[0]+dir[0]*len*f,A[1]+dir[1]*len*f],yy=L-DH*f;
        if(!free(p,2.3)||[-1.6,0,1.6].some(o=>H([p[0]-dir[1]*o,p[1]+dir[0]*o])>yy-.04)||(terraceGrid.get(Math.floor(p[0]/64)+','+Math.floor(p[1]/64))||[]).some(t=>t.L>yy+.03&&inside(p,t.q))){clear=false;break;}
      }
      if(clear){const count=Math.ceil(DH/.26);for(let k=1;k<=count;k++){const f0=(k-1)/count,f1=k/count,p=[A[0]+dir[0]*len*f0,A[1]+dir[1]*len*f0],q=[A[0]+dir[0]*len*f1,A[1]+dir[1]*len*f1],foot=[[p[0]-dir[1]*1.6,p[1]+dir[0]*1.6],[p[0]+dir[1]*1.6,p[1]-dir[0]*1.6],[q[0]+dir[1]*1.6,q[1]-dir[0]*1.6],[q[0]-dir[1]*1.6,q[1]+dir[0]*1.6]],y=L-DH*f0;
        const near=new Set();for(const point of foot)for(const t of terraceGrid.get(Math.floor(point[0]/64)+','+Math.floor(point[1]/64))||[])near.add(t);
        if([...near].some(t=>Math.abs(t.L+.006-y)>.28&&polygonsOverlap(t.walkQ,foot))){clear=false;break;}
      }}
      if(clear)candidates.push({B,V,vn,lq,actualUpper,upperCentre,len,dir,target:t.id,score:len+lateral*2});
    }
    candidates.sort((a,b)=>a.score-b.score);if(!candidates.length)continue;
    const {B,V,lq,actualUpper,upperCentre,len,dir,target}=candidates[0];
    founded(actualUpper,L,'upper contour landing');founded(lq,L-DH,'lower contour landing');corridor(side,upperCentre,3.4,L);base.components.at(-1).landingWalk.runId=neighbours[0].id;
    const nst=Math.ceil(DH/.26),sp=[[...A,L]];
    for(let k=1;k<=nst;k++){const f=k/nst,p=[A[0]+dir[0]*len*f,A[1]+dir[1]*len*f];sp.push([...p,L-DH*(k-1)/nst],[...p,L-DH*f]);}
    // Add the final lower-level tread explicitly: otherwise the last emitted prism
    // ends one riser above the nominal metadata endpoint.
    const toe=[B[0]+dir[0]*.35,B[1]+dir[1]*.35];sp.push([...toe,L-DH]);
    const firstFlight=near.components.length;stairSolid(near,sp,dir,3.2,H);near.components[firstFlight].stair.network={from:neighbours[0].id,to:target,walkFrom:side};
    stairCorridors.push({a:A,b:toe,width:6.4,y0:L,y1:L-DH});landings.push(U,V);used.push(U);
  }
  // Complete the inhabited network before placing houses. Short surveyed links
  // join the interrupted contour promenades into two-sided access spines rooted
  // at the station square. The planner carries exact floor elevations through
  // every crossing and uses bounded risers over founded terrain between them.
  const nodePlans=new Map(terracePlans.map(p=>[p.id,p])),arrival=m.id+':arrival',parent=new Map([...nodePlans.keys(),arrival].map(id=>[id,id]));
  const root=id=>{while(parent.get(id)!==id){parent.set(id,parent.get(parent.get(id)));id=parent.get(id);}return id;},join=(a,b)=>{const x=root(a),y=root(b);if(x!==y)parent.set(x,y);};
  for(const part of near.components)if(part.stair?.network)join(part.stair.network.from,part.stair.network.to);
  const floors=new Map(),floorCell=32;
  const addFloor=(q,y)=>{const xs=q.map(p=>p[0]),zs=q.map(p=>p[1]),entry={q,y,minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs)};for(let x=Math.floor(Math.min(...xs)/floorCell);x<=Math.floor(Math.max(...xs)/floorCell);x++)for(let z=Math.floor(Math.min(...zs)/floorCell);z<=Math.floor(Math.max(...zs)/floorCell);z++){const key=x+','+z;if(!floors.has(key))floors.set(key,[]);floors.get(key).push(entry);}};
  const floorsAt=p=>(floors.get(Math.floor(p[0]/floorCell)+','+Math.floor(p[1]/floorCell))||[]).filter(f=>inside(p,f.q));
  terraceQuads.forEach(t=>{addFloor(t.q,t.L);addFloor(t.walkQ,t.L+.006);});addFloor(sq,yp);for(const part of base.components){if(part.landing)addFloor(part.landing.q,part.landing.y);if(part.landingWalk){const e=part.landingWalk,len=Math.hypot(e.to[0]-e.from[0],e.to[1]-e.from[1]),q=rectangle((e.from[0]+e.to[0])/2,(e.from[1]+e.to[1])/2,len,e.width,Math.atan2(e.to[1]-e.from[1],e.to[0]-e.from[0]));addFloor(q,e.y);}}
  // The existing main and contour flights are legal surfaces, too. Include their
  // actual horizontal tread footprints so new connectors can share a landing.
  for(const solid of [base,near])for(let i=0;i<solid.components.length;i++){const e=solid.components[i].stair;if(!e)continue;for(let k=0;k<e.components;k++){const part=solid.components[i+k],coords=solid.pos.slice(part.start*3,(part.start+part.count)*3),top=Math.max(...coords.filter((_,i)=>i%3===1)),q=[];for(let j=0;j<coords.length;j+=3)if(Math.abs(coords[j+1]-top)<1e-6&&!q.some(p=>Math.hypot(p[0]-coords[j],p[1]-coords[j+2])<1e-6))q.push([coords[j],coords[j+2]]);const centre=q.reduce((s,p)=>[s[0]+p[0]/q.length,s[1]+p[1]/q.length],[0,0]);q.sort((a,b)=>Math.atan2(a[1]-centre[1],a[0]-centre[0])-Math.atan2(b[1]-centre[1],b[0]-centre[0]));addFloor(q,top);}}
  const floorIntersections=q=>{
    const xs=q.map(p=>p[0]),zs=q.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs),near=new Set(),hits=[];
    for(let x=Math.floor(minX/floorCell);x<=Math.floor(maxX/floorCell);x++)for(let z=Math.floor(minZ/floorCell);z<=Math.floor(maxZ/floorCell);z++)for(const f of floors.get(x+','+z)||[])near.add(f);
    for(const f of near){if(f.maxX<=minX+.00001||f.minX>=maxX-.00001||f.maxZ<=minZ+.00001||f.minZ>=maxZ-.00001)continue;let separate=false;for(const poly of [q,f.q])for(let i=0;i<poly.length&&!separate;i++){const a=poly[i],b=poly[(i+1)%poly.length],nx=-(b[1]-a[1]),nz=b[0]-a[0],P=q.map(p=>p[0]*nx+p[1]*nz),Q=f.q.map(p=>p[0]*nx+p[1]*nz);if(Math.max(...P)<=Math.min(...Q)+.00001||Math.max(...Q)<=Math.min(...P)+.00001)separate=true;}if(!separate)hits.push(f);}
    return hits;
  };
  const ports=[];
  for(const plan of terracePlans){
    const options=[],quads=terraceQuads.filter(t=>t.id===plan.id);
    for(let i=1;i<plan.run.length;i++){const a=plan.run[i-1],b=plan.run[i],{p,n}=promenade(a,b),samples=[p];
      for(const f of [.45,.65])samples.push([(a.P[0]+b.P[0]+(a.F[0]+b.F[0]-a.P[0]-b.P[0])*f)/2,(a.P[1]+b.P[1]+(a.F[1]+b.F[1]-a.P[1]-b.P[1])*f)/2]);
      for(const p of samples)if(circleFootprint(p[0],p[1],1.72,12).every(p=>quads.some(t=>inside(p,t.q,.008)))){options.push({id:plan.id,p,y:plan.L});break;}
    }
    if(options.length)for(const i of new Set([0,Math.floor(options.length/2),options.length-1]))ports.push(options[i]);
  }
  ports.push({id:arrival,p:W(-20,62),y:yp,out:d},{id:arrival,p:W(20,62),y:yp,out:d},{id:arrival,p:W(-50,62),y:yp,out:[-s[0],-s[1]]},{id:arrival,p:W(50,62),y:yp,out:s});
  for(const part of base.components)if(part.landing?.kind==='grand stair toe'){const {q,y}=part.landing,centre=q.reduce((sum,p)=>[sum[0]+p[0]/q.length,sum[1]+p[1]/q.length],[0,0]);for(const side of [-1,1])ports.push({id:arrival,p:[centre[0]+s[0]*side*4.8,centre[1]+s[1]*side*4.8],y});}
  const links=[];
  for(let i=0;i<ports.length;i++)for(let j=i+1;j<ports.length;j++){const a=ports[i],b=ports[j];if(a.id===b.id)continue;const len=Math.hypot(b.p[0]-a.p[0],b.p[1]-a.p[1]);if(len<3||len>220||Math.abs(b.y-a.y)>.44*len)continue;if(a.out&&((b.p[0]-a.p[0])*a.out[0]+(b.p[1]-a.p[1])*a.out[1])/len<.35)continue;if(b.out&&((a.p[0]-b.p[0])*b.out[0]+(a.p[1]-b.p[1])*b.out[1])/len<.35)continue;links.push({a,b,len,cost:len+Math.abs(b.y-a.y)*1.8});}
  links.sort((a,b)=>a.cost-b.cost);
  const surveyLink=(a,b,guide=[a.p,b.p],grade=.46,spacing=.48,width=3.2)=>{
    const points=resamplePath(guide,spacing),count=points.length-1,sections=[],heights=[],fixed=[],lengths=[0];let valid=true;
    for(let i=0;i<=count;i++){
      const p=points[i],before=points[Math.max(0,i-1)],after=points[Math.min(count,i+1)],incoming=[p[0]-before[0],p[1]-before[1]],outgoing=[after[0]-p[0],after[1]-p[1]];
      if(!i){incoming[0]=outgoing[0];incoming[1]=outgoing[1];}if(i===count){outgoing[0]=incoming[0];outgoing[1]=incoming[1];}
      const il=Math.hypot(...incoming),ol=Math.hypot(...outgoing);incoming[0]/=il;incoming[1]/=il;outgoing[0]/=ol;outgoing[1]/=ol;
      let nx=-incoming[1]-outgoing[1],nz=incoming[0]+outgoing[0],nl=Math.hypot(nx,nz);nx/=nl;nz/=nl;const scale=width/2/Math.max(.8,-nx*outgoing[1]+nz*outgoing[0]),left=[p[0]+nx*scale,p[1]+nz*scale],right=[p[0]-nx*scale,p[1]-nz*scale];sections.push({left,right});
      if(i)lengths.push(lengths[i-1]+Math.hypot(p[0]-before[0],p[1]-before[1]));
      const samples=[left,p,right],on=samples.map(floorsAt),all=on.flat(),closeArrival=(a.id===arrival&&lengths[i]<24)||(b.id===arrival&&Math.hypot(p[0]-b.p[0],p[1]-b.p[1])<24),ground=Math.max(...samples.map(H));
      if((!free(p,1.8)&&!all.length&&!closeArrival)||blocked.some(o=>Math.hypot(p[0]-o.x,p[1]-o.z)<o.r+2)){valid=false;break;}
      const surface=all.length?Math.max(...all.map(v=>v.y)):null;
      if(surface!==null&&ground>surface+.035){valid=false;break;}
      const exact=i===0?a.y:i===count?b.y:surface;fixed.push(exact);heights.push(exact??ground+.12);
    }
    if(!valid)return false;
    const footprints=[];
    for(let i=1;i<=count;i++){
      const foot=[sections[i-1].left,sections[i-1].right,sections[i].right,sections[i].left],cross=foot.map((p,k)=>{const q=foot[(k+1)%4],r=foot[(k+2)%4];return(q[0]-p[0])*(r[1]-q[1])-(q[1]-p[1])*(r[0]-q[0]);});if(!(cross.every(v=>v>.00001)||cross.every(v=>v<-.00001)))return false;footprints.push(foot);
      const floors=floorIntersections(foot);if(floors.length){const high=Math.max(...floors.map(f=>f.y)),low=Math.min(...floors.map(f=>f.y));if(high-low>.275)return false;for(const j of [i-1,i]){if((j===0&&Math.abs(high-a.y)>.018)||(j===count&&Math.abs(high-b.y)>.018))return false;if(fixed[j]!==null&&Math.abs(high-fixed[j])>.275)return false;fixed[j]=Math.max(fixed[j]??-Infinity,high);heights[j]=Math.max(heights[j],high);}}
    }
    // Lipschitz envelope raises an approach early enough to reach each retaining
    // terrace. Full tread footprints, including every crossing, preserve existing
    // walking floors; no new foundation may block an older stair from the side.
    for(let i=1;i<=count;i++)heights[i]=Math.max(heights[i],heights[i-1]-(lengths[i]-lengths[i-1])*grade);
    for(let i=count-1;i>=0;i--)heights[i]=Math.max(heights[i],heights[i+1]-(lengths[i+1]-lengths[i])*grade);
    if(heights.some((y,i)=>fixed[i]!==null&&y>fixed[i]+.018))return false;
    const first=base.components.length,profile=[];
    for(let i=1;i<=count;i++){const y=Math.max(heights[i-1],heights[i]),foot=footprints[i-1],bottom=Math.min(...foot.map(H))-1.5;base.prism(foot,bottom,y,1,9);addFloor(foot,y);profile.push(y);}
    base.components[first].stair={from:a.p,to:b.p,startY:a.y,endY:b.y,width,components:base.components.length-first,network:{from:a.id,to:b.id},kind:'surveyed access spine'};
    // Reserve each smooth guide segment for doors and parapet gates, using its
    // sampled height profile rather than a nominal straight endpoint slope.
    let start=0;for(let k=1;k<guide.length;k++){const segmentLength=Math.hypot(guide[k][0]-guide[k-1][0],guide[k][1]-guide[k-1][1]),n=Math.ceil(segmentLength/spacing),part=profile.slice(start,start+n);if(part.length)stairCorridors.push({a:guide[k-1],b:guide[k],width:width+2.6,y0:part[0],y1:part.at(-1),minY:Math.min(...part),maxY:Math.max(...part),profile:part});start+=n;}
    join(a.id,b.id);return true;
  };
  for(const {a,b}of links)if(root(a.id)!==root(b.id))surveyLink(a,b);
  // A straight chord cannot negotiate every station reserve or steep hollow.
  // Survey rounded switchbacks for the remaining components instead of leaving
  // their houses stranded or forcing a retaining wall through the landform.
  for(let pass=0;pass<3;pass++){
    let progress=0;const candidates=[];
    for(const a of ports)if(root(a.id)!==root(arrival))for(const b of ports)if(root(b.id)===root(arrival)){const len=Math.hypot(b.p[0]-a.p[0],b.p[1]-a.p[1]);if(len<4||len>280)continue;candidates.push({a,b,len,cost:len+Math.abs(b.y-a.y)*1.2});}
    candidates.sort((a,b)=>a.cost-b.cost);const tried=new Map();
    for(const {a,b,len}of candidates){if(root(a.id)===root(b.id))continue;const r=root(a.id),attempts=tried.get(r)||0;if(attempts>=60)continue;tried.set(r,attempts+1);
      const n=[-(b.p[1]-a.p[1])/len,(b.p[0]-a.p[0])/len];
      for(const off of [18,-18,35,-35,65,-65,90,-90]){const raw=[a.p];if(a.out){const exit=Math.abs(off)>=65?d:a.out;raw.push([a.p[0]+exit[0]*15,a.p[1]+exit[1]*15]);}raw.push([(a.p[0]+b.p[0])/2+n[0]*off,(a.p[1]+b.p[1])/2+n[1]*off]);if(b.out){const exit=Math.abs(off)>=65?d:b.out;raw.push([b.p[0]+exit[0]*15,b.p[1]+exit[1]*15]);}raw.push(b.p);if(surveyLink(a,b,smoothPath(raw,3))||surveyLink(a,b,smoothPath(raw,3),.68,.36,2.4)){progress++;break;}}
    }
    if(!progress)break;
  }

  // Leave the two unoccupied contour fragments that cannot be reached without
  // severe cuts as natural hillside. An inaccessible paved belvedere would be a
  // false destination, even if its individual slabs were structurally sound.
  const connectedPlans=terracePlans.filter(p=>root(p.id)===root(arrival));
  const network={town:m.name,arrival,runs:connectedPlans.length,connectedRuns:connectedPlans.map(p=>p.id),omittedRuns:terracePlans.filter(p=>root(p.id)!==root(arrival)).map(p=>p.id)};
  base.components[0].network=network;
  const houseFeet=[];
  for(const plan of connectedPlans)terraceRun(base,near,plan.run,plan.L,plan.garden,mulberry32(plan.seed),landings,lights,stairCorridors,plan.id,terraceQuads.filter(t=>t.id===plan.id).map(t=>t.walkQ),terraceQuads.filter(t=>t.L===plan.L).map(t=>t.walkQ),houseFeet);
  // what the gardeners need to plant the terraces (hills/townGardens.js): the built terrace tops,
  // their walks, every house, chapel, stair and civic corridor, and the town's own reserves
  {
    const built=new Map(connectedPlans.map(p=>[p.id,p]));
    MASSIF_GARDENS.push({town:m.id,center:[C.x,C.z],free:(p,pad=0)=>free(p,pad),
      terraces:terraceQuads.filter(t=>built.has(t.id)).map(t=>({q:t.q,walkQ:t.walkQ,L:t.L,garden:built.get(t.id).garden,D:Math.min(t.a.D,t.b.D)})),
      houses:houseFeet,corridors:stairCorridors.map(c=>({a:c.a,b:c.b,width:c.width})),landings:landings.slice()});
  }

  const baseStructure=audit?base.geometry():null,nearStructure=audit?near.geometry():null;
  const auditParts=[];
  if(audit){
    for(const [solid,geo]of [[base,baseStructure],[near,nearStructure]])for(const part of solid.components){
      const g=new THREE.BufferGeometry();for(const name of ['position','normal','aFacade']){const a=geo.getAttribute(name);g.setAttribute(name,new THREE.Float32BufferAttribute(a.array.slice(part.start*3,(part.start+part.count)*3),3));}
      if(part.stair)g.userData.islandMassifStair=part.stair;if(part.landing)g.userData.islandMassifLanding=part.landing;if(part.gradeExit)g.userData.islandMassifGradeExit=part.gradeExit;if(part.landingWalk)g.userData.islandMassifLandingWalk=part.landingWalk;if(part.terrace)g.userData.islandMassifTerrace=part.terrace;if(part.house)g.userData.islandMassifHouse=part.house;if(part.network)g.userData.islandMassifNetwork=part.network;if(part.promenade)g.userData.islandMassifPromenade=part.promenade;auditParts.push({name:`${m.name} ${part.kind}`,geometry:g});
    }
    for(const geometry of [...lathes,...nearLathes])auditParts.push({name:`${m.name} lathe`,geometry});
  }
  // Distance tiers for outerLod.js: the stair flights (tens of thousands of treads)
  // and the near set are detail; terraces, houses, walls and towers are the massing.
  const items=[...solidItems(base,MASS_TIER),...solidItems(near,0)];
  // MASSIF_GARDENS keeps closures over this scope: drop the builders' plain-array streams now they are copied
  base.pos=[];base.fac=[];near.pos=[];near.fac=[];
  for(const g of lathes)items.push({geo:g,tier:MASS_TIER});
  for(const g of nearLathes)items.push({geo:g,tier:0});
  let tris=0;for(const it of items)tris+=(it.geo.index?it.geo.index.count:it.geo.attributes.position.count)/3;
  return { items, tris, auditParts, center: new THREE.Vector3(C.x, y0, C.z) };
}

/** Marching squares: the polylines where the height grid crosses level L. */
export function contourLines(hg, N, G, X0, Z0, L) {
  const pt = new Map(), adj = new Map();
  const ept = (id) => {
    let p = pt.get(id);
    if (p) return p;
    const e = id >> 1, i = e % N, j = (e - i) / N, hz = id & 1;
    const a = hg[j * N + i], b = hz ? hg[(j + 1) * N + i] : hg[j * N + i + 1];
    const f = Math.max(0.001, Math.min(0.999, (L - a) / (b - a || 1e-6)));
    p = hz ? [X0 + i * G, Z0 + (j + f) * G] : [X0 + (i + f) * G, Z0 + j * G];
    pt.set(id, p);
    return p;
  };
  const link = (a, b) => { for (const [x, y] of [[a, b], [b, a]]) { if (!adj.has(x)) adj.set(x, []); adj.get(x).push(y); } };
  const up = (i, j) => hg[j * N + i] >= L;
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const c = [];
    if (up(i, j) !== up(i + 1, j)) c.push((j * N + i) * 2);             // bottom
    if (up(i + 1, j) !== up(i + 1, j + 1)) c.push((j * N + i + 1) * 2 + 1); // right
    if (up(i, j + 1) !== up(i + 1, j + 1)) c.push(((j + 1) * N + i) * 2);   // top
    if (up(i, j) !== up(i, j + 1)) c.push((j * N + i) * 2 + 1);           // left
    if (c.length === 2) link(c[0], c[1]);
    else if (c.length === 4) { link(c[0], c[1]); link(c[2], c[3]); }
  }
  const seen = new Set(), lines = [];
  const walk = (s) => {
    const line = [];
    let prev = -1, cur = s;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      line.push(ept(cur));
      const nb = adj.get(cur).filter((x) => x !== prev && !seen.has(x));
      prev = cur; cur = nb[0];
    }
    return line;
  };
  for (const [id, nb] of adj) if (nb.length === 1 && !seen.has(id)) lines.push(walk(id));
  for (const id of adj.keys()) if (!seen.has(id)) lines.push(walk(id));
  return lines;
}

/** Points every `step` metres along a polyline. */
export function resample(line, step) {
  const out = [line[0]];
  let acc = 0;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1], b = line[k], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let s = step - acc;
    while (s <= l) { out.push([a[0] + (b[0] - a[0]) * s / l, a[1] + (b[1] - a[1]) * s / l]); s += step; }
    acc = l - (s - step);
  }
  return out;
}

/** Remaining wall intervals after cutting pedestrian gates through a parapet. */
function parapetIntervals(a,b,L,corridors,walks=[]){
  const holes=[],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),point=t=>[a[0]+dx*t,a[1]+dz*t];
  for(const c of corridors){
    if((c.minY??Math.min(c.y0,c.y1))>L+.8||(c.maxY??Math.max(c.y0,c.y1))<L-2)continue;
    const r=Math.min(c.width,4.2)/2+.55;
    if(Math.max(a[0],b[0])+r<Math.min(c.a[0],c.b[0])||Math.min(a[0],b[0])-r>Math.max(c.a[0],c.b[0])||Math.max(a[1],b[1])+r<Math.min(c.a[1],c.b[1])||Math.min(a[1],b[1])-r>Math.max(c.a[1],c.b[1]))continue;
    const distance=t=>pointSegmentDistance(...point(t),c.a,c.b);let lo=0,hi=1;
    for(let k=0;k<28;k++){const l=(2*lo+hi)/3,h=(lo+2*hi)/3;if(distance(l)<distance(h))hi=h;else lo=l;}
    const mid=(lo+hi)/2;if(distance(mid)>=r)continue;
    const p=point(mid),vx=c.b[0]-c.a[0],vz=c.b[1]-c.a[1],f=Math.max(0,Math.min(1,((p[0]-c.a[0])*vx+(p[1]-c.a[1])*vz)/(vx*vx+vz*vz||1))),y=c.profile?c.profile[Math.min(c.profile.length-1,Math.floor(f*c.profile.length))]:c.y0+(c.y1-c.y0)*f;
    if(y>L+.8||y<L-2)continue;
    lo=0;hi=mid;for(let k=0;k<28;k++){const m=(lo+hi)/2;if(distance(m)<r)hi=m;else lo=m;}const start=distance(0)<r?0:hi;
    lo=mid;hi=1;for(let k=0;k<28;k++){const m=(lo+hi)/2;if(distance(m)<r)lo=m;else hi=m;}const end=distance(1)<r?1:lo;holes.push([start,end]);
  }
  for(const q of walks){const area=q.reduce((v,p,i)=>v+p[0]*q[(i+1)%q.length][1]-q[(i+1)%q.length][0]*p[1],0),sign=Math.sign(area);let lo=0,hi=1;
    for(let i=0;i<q.length&&lo<hi;i++){const p=q[i],r=q[(i+1)%q.length],ex=r[0]-p[0],ez=r[1]-p[1],v=sign*(ex*(a[1]-p[1])-ez*(a[0]-p[0]))+.5*Math.hypot(ex,ez),slope=sign*(ex*dz-ez*dx);if(Math.abs(slope)<1e-8){if(v<0){lo=1;hi=0;}}else if(slope>0)lo=Math.max(lo,-v/slope);else hi=Math.min(hi,-v/slope);}
    if(lo<hi&&hi>0&&lo<1)holes.push([Math.max(0,lo),Math.min(1,hi)]);
  }
  holes.sort((a,b)=>a[0]-b[0]);const open=[];let start=0;for(const [lo,hi]of holes){if((lo-start)*len>.12)open.push([start,lo]);start=Math.max(start,hi);}if((1-start)*len>.12)open.push([start,1]);return open;
}

/** A terrace along a contour: level top, retaining wall in front, houses against the slope. */
function terraceRun(base, near, run, L, garden, rnd, landings, lights, corridors = [],runId=null,walks=[],levelWalks=walks,houseOut=null) {
  const topK = garden ? 3 : 9;
  for(let i=0;i<run.length-1;i++){
    const a=run[i],b=run[i+1];
    base.prism([a.P,b.P,b.F,a.F],[L-3,L-3,b.gF-2.5,a.gF-2.5],L,1,topK);base.components.at(-1).terrace={kind:'contour promenade',level:L,runId};
    const walk=walks[i];if(walk){base.prism(walk,footprintGround(walk,2).min-1.5,L+.006,1,9);base.components.at(-1).promenade={runId,level:L+.006};}
    const na=walk?[walk[3][0]-walk[0][0],walk[3][1]-walk[0][1]]:a.n.slice(),nb=walk?[walk[2][0]-walk[1][0],walk[2][1]-walk[1][1]]:b.n.slice(),la=Math.hypot(...na),lb=Math.hypot(...nb);na[0]/=la;na[1]/=la;nb[0]/=lb;nb[1]/=lb;
    const edgeA=walk?walk[3]:a.F,edgeB=walk?walk[2]:b.F,outerA=[edgeA[0]+na[0]*.65,edgeA[1]+na[1]*.65],outerB=[edgeB[0]+nb[0]*.65,edgeB[1]+nb[1]*.65],ai=[edgeA[0]+na[0]*.2,edgeA[1]+na[1]*.2],bi=[edgeB[0]+nb[0]*.2,edgeB[1]+nb[1]*.2];
    // Retaining parapets have real gates at the walking corridors. Subtract the
    // route capsule from this short wall rather than laying stair treads through it.
    for(const [from,to]of parapetIntervals(outerA,outerB,L,corridors,levelWalks)){
      const mix=(p,q,f)=>[p[0]+(q[0]-p[0])*f,p[1]+(q[1]-p[1])*f],rail=[mix(outerA,outerB,from),mix(outerA,outerB,to),mix(ai,bi,to),mix(ai,bi,from)];
      base.prism(rail,footprintGround(rail,2).min-1.5,L,1,1);
      near.prism(rail,L-.1,L+1.05,1,1);
    }
  }
  // houses: packed along the run, seated on the terrace top against the slope
  const at = (u) => {
    // contour point, downhill normal and depth at arc length u, interpolated along the run
    for (let i = 0; i < run.length - 1; i++) if (u >= run[i].u && u <= run[i + 1].u) {
      const f = (u - run[i].u) / (run[i + 1].u - run[i].u || 1), a = run[i], b = run[i + 1];
      const nx = a.n[0] + (b.n[0] - a.n[0]) * f, nz = a.n[1] + (b.n[1] - a.n[1]) * f, nl = Math.hypot(nx, nz) || 1;
      return { P: [a.P[0] + (b.P[0] - a.P[0]) * f, a.P[1] + (b.P[1] - a.P[1]) * f], n: [nx / nl, nz / nl], D: Math.min(a.D, b.D) };
    }
    return null;
  };
  let u = run[0].u + 2 + rnd() * 6;
  const uEnd = run[run.length - 1].u - 2;
  let chapelDone = rnd() > 0.12;
  while (u < uEnd) {
    const w = 9 + rnd() * 8;
    if (u + w > uEnd) break;
    const A = at(u), B = at(u + w), M = at(u + w / 2);
    if (!A || !B || !M || rnd() < (garden ? 0.55 : 0.15) || landings.some((p) => Math.hypot(p[0] - M.P[0], p[1] - M.P[1]) < w / 2 + 6)) { u += w * 0.6 + 2; continue; }
    const Dm = Math.min(A.D, B.D, M.D);let dep = Math.min(Dm - 4.5, 7 + rnd() * 6);
    if (dep < 4.6) { u += w + 2; continue; }
    // set the back off the contour so the whole footprint stays on the terrace
    const A0 = [A.P[0] + A.n[0] * .55, A.P[1] + A.n[1] * .55], B0 = [B.P[0] + B.n[0] * .55, B.P[1] + B.n[1] * .55];
    let q;while(dep>=4.6){q=[A0,B0,[B0[0]+B.n[0]*dep,B0[1]+B.n[1]*dep],[A0[0]+A.n[0]*dep,A0[1]+A.n[1]*dep]];if(!walks.some(w=>polygonsOverlap(q,w,.00001)))break;dep-=.35;}
    if(dep<4.6){u+=w+2;continue;}
    const centre=q.reduce((c,p)=>[c[0]+p[0]/4,c[1]+p[1]/4],[0,0]),radius=Math.max(...q.map(p=>Math.hypot(p[0]-centre[0],p[1]-centre[1])));
    if(corridors.some(({a,b,width})=>{const vx=b[0]-a[0],vz=b[1]-a[1],f=Math.max(0,Math.min(1,((centre[0]-a[0])*vx+(centre[1]-a[1])*vz)/(vx*vx+vz*vz||1)));return Math.hypot(centre[0]-a[0]-vx*f,centre[1]-a[1]-vz*f)<radius+width/2;})){u+=w+2;continue;}
    const d = M.n, tg = [B.P[0] - A.P[0], B.P[1] - A.P[1]], tl = Math.hypot(tg[0], tg[1]) || 1;
    const firstHouse=base.components.length;
    if (!chapelDone && dep > 8 && w > 13) {
      chapelDone = true;
      chapelAt(base, near, q, null, L, d, [tg[0] / tl, tg[1] / tl], lights);base.components[firstHouse].house={runId};
      if (houseOut) houseOut.push({ q, L, top: L + 31, chapel: true });
      u += w + 3;
      continue;
    }
    const floors = 1 + Math.floor(rnd() * rnd() * 3.2), Hh = floors * 3.6 + 0.6;
    base.prism(q, L - 1, L + Hh, 5, rnd() < 0.35 ? 3 : 1);base.components[firstHouse].house={runId};
    if (houseOut) houseOut.push({ q, L, top: L + Hh + 2.2 + dep * 0.22 + 4 });
    if (rnd() < 0.68) gable(base, q, L + Hh, 2.2 + dep * 0.22, 11, d);
    else {
      // a glazed roof pavilion on the roof garden (near)
      near.prism(shrink(q, 2.6), L + Hh - 0.2, L + Hh + 2.6, 0, 1);
    }
    if (rnd() < 0.5) {
      const c = [q[0][0] * 0.7 + q[2][0] * 0.3, q[0][1] * 0.7 + q[2][1] * 0.3];
      near.prism([[c[0] - 0.6, c[1] - 0.6], [c[0] + 0.6, c[1] - 0.6], [c[0] + 0.6, c[1] + 0.6], [c[0] - 0.6, c[1] + 0.6]], L + Hh, L + Hh + 3.6 + dep * 0.2, 1, 11);
    }
    u += w + (rnd() < 0.3 ? 4 + rnd() * 5 : 0.6);
  }
}

/** A gable roof over q (q[0..1] back along the contour, q[2..3] front), ridge along the contour. */
function gable(S, q, y, rh, k, d) {
  const start=S.begin();
  const mA = [(q[0][0] + q[3][0]) / 2, (q[0][1] + q[3][1]) / 2], mB = [(q[1][0] + q[2][0]) / 2, (q[1][1] + q[2][1]) / 2];
  const P = (p, yy) => [p[0], yy, p[1]], F = (p, yy) => [p[0], p[1], k];
  const rA = P(mA, y + rh), rB = P(mB, y + rh);
  const qa = q.map((p) => P(p, y)), fa = q.map((p) => F(p));
  S.quad(qa[0], qa[1], rB, rA, fa[0], fa[1], F(mB), F(mA), [-d[0], 1, -d[1]]);
  S.quad(qa[3], qa[2], rB, rA, fa[3], fa[2], F(mB), F(mA), [d[0], 1, d[1]]);
  const sx = q[1][0] - q[0][0], sz = q[1][1] - q[0][1];
  S.face(qa, k, [0, -1, 0]);
  // gable ends in the wall stone
  S.tri(qa[0], qa[3], rA, [0, y, 5], [1, y, 5], [0.5, y + rh, 5], [-sx, 0, -sz]);
  S.tri(qa[1], qa[2], rB, [0, y, 5], [1, y, 5], [0.5, y + rh, 5], [sx, 0, sz]);
  S.end(start,'gable');
}

function shrink(q, e) {
  const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cz = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
  // A uniform inset scale preserves convexity on narrow curved lots. Pulling every
  // corner inward by the same distance can fold the smallest roof edge inside out.
  const factor=Math.max(.12,1-e/Math.max(1,Math.min(...q.map(([x,z])=>Math.hypot(x-cx,z-cz)))));
  return q.map(([x,z])=>[cx+(x-cx)*factor,cz+(z-cz)*factor]);
}

/** A chapel on a terrace footprint: tall nave, steep roof, a square bell tower at one end. */
function chapelAt(S, near, q, c, L, d, s, lights) {
  S.prism(q, L - 1, L + 9, 5, 1);
  gable(S, q, L + 9, 6, 11, d);
  const t = [q[0][0] * 0.8 + q[2][0] * 0.2, q[0][1] * 0.8 + q[2][1] * 0.2];
  const tq = [[-2.6, -2.6], [2.6, -2.6], [2.6, 2.6], [-2.6, 2.6]].map(([a, b]) => [t[0] + s[0] * a + d[0] * b, t[1] + s[1] * a + d[1] * b]);
  S.prism(tq, L - 1, L + 19, 5, 1);
  S.prism(shrink(tq, 0.3), L + 19, L + 22, 2, 1);
  const top = [(tq[0][0] + tq[2][0]) / 2, (tq[0][1] + tq[2][1]) / 2];
  // pyramid spire
  const spireStart=S.begin();
  const Y = L + 22, apex = [top[0], Y + 9, top[1]];
  S.face(tq.map((p) => [p[0], Y, p[1]]), 1, [0, -1, 0]);
  for (let i = 0; i < 4; i++) {
    const a = tq[i], b = tq[(i + 1) % 4];
    S.tri([a[0], Y, a[1]], [b[0], Y, b[1]], apex, [0, Y, 11], [5, Y, 11], [2.5, Y + 9, 11], [(a[0] + b[0]) / 2 - top[0], 0.6, (a[1] + b[1]) / 2 - top[1]]);
  }
  S.end(spireStart,'pyramid spire');
  lights.push({ x: top[0], y: L + 20.5, z: top[1], c: [1.0, 0.8, 0.55], s: 1.6 });
}

/** The square's chapel: a nave across the east side with a round bell tower. */
function chapel(S, lathes, W, u, t, w, dp, yp, rotY, s, d, lights) {
  const q = [W(u - w / 2, t), W(u + w / 2, t), W(u + w / 2, t + dp), W(u - w / 2, t + dp)];
  S.prism(q, yp - 1, yp + 12, 5, 1);
  // ridge down the nave (toward the slope): roof built on the rotated footprint
  gable(S, [q[1], q[2], q[3], q[0]], yp + 12, 7, 11, [-s[0], -s[1]]);
  const tc = W(u + w / 2 - 3, t + 1);
  lathes.push(latheFacade([{ r: 3.8, y: yp - 1, kind: 1 }, { r: 3.8, y: yp + 24, kind: 5 }, { r: 4.3, y: yp + 24, kind: 1 }, { r: 4.3, y: yp + 25, kind: 1 },
    { r: 3.4, y: yp + 25, kind: 2 }, { r: 3.4, y: yp + 29, kind: 2 }, { r: 3.9, y: yp + 29, kind: 1 }, { r: 0.05, y: yp + 40, kind: 11 }], 8).translate(tc[0], 0, tc[1]));
  lights.push({ x: tc[0], y: yp + 27, z: tc[1], c: [1.0, 0.8, 0.55], s: 1.8 });
}

/** A straight stair or track: sections [x, z, yTop] along dir, a solid down into the ground. */
function stairSolid(S, pts, dir, w, H) { const start=S.components.length;trackSolid(S, pts, dir, w, 9, H, 0);if(S.components.length>start)S.components[start].stair={from:[pts[0][0],pts[0][1]],to:[pts.at(-1)[0],pts.at(-1)[1]],startY:pts[0][2],endY:pts.at(-1)[2],width:w,components:S.components.length-start}; }

function trackSolid(S, pts, dir, w, topK, H, depth) {
  if (pts.length < 2) return;
  const px=-dir[1]*w/2,pz=dir[0]*w/2;
  for(let i=1;i<pts.length;i++){
    const a=pts[i-1],b=pts[i];if(Math.hypot(b[0]-a[0],b[1]-a[1])<1e-6)continue;
    const q=[[a[0]+px,a[1]+pz],[a[0]-px,a[1]-pz],[b[0]-px,b[1]-pz],[b[0]+px,b[1]+pz]],top=[a[2],a[2],b[2],b[2]];
    const bottom=q.map((p,k)=>H?Math.min(H(p),top[k])-1.5:top[k]-depth);
    S.prism(q,bottom,top,1,topK);
  }
}

// ------------------------------------------------------------------ build --
/** Per town, filled by buildMassifTowns: the planted-garden survey (see buildTown). */
export const MASSIF_GARDENS = [];

export function buildMassifTowns(scene, towns, lights, {audit=false} = {}) {
  const meshes = [],auditParts=[];
  MASSIF_GARDENS.length = 0;
  let tris = 0;
  towns.forEach((m, i) => {
    const { items, tris:townTris, auditParts:townParts } = buildTown(m, mulberry32(3030 + i * 19), lights,audit);
    for(const part of townParts)auditParts.push(part);
    const mat = createFacadeMaterial('fieldstone', 950 + i, { litFrac: 0.62, band: 128 });
    tris += townTris;
    // near detail (stairs, parapets, chimneys, funicular furniture) to NEAR_DIST, the
    // massing beyond it; past the shadow range the massing stops casting
    meshes.push(...buildOuterLOD(scene, items, mat, { cell: TOWN_CELL, name: `${m.name} (massif town)`, levels: MASSIF_LOD }));
  });
  return { meshes, tris, auditParts };
}

/** Bucket a Solid's triangles by cell (triangle centroid) into geometry items; the
 *  flights of a stair (components flagged .stair and the ones they span) are tier 0. */
function solidItems(S, tier) {
  if (!S.pos.length) return [];
  const nv = S.pos.length / 3, vt = new Int8Array(nv).fill(tier);
  if (tier) for (let i = 0; i < S.components.length; i++) {
    const e = S.components[i].stair;
    if (!e) continue;
    for (let k = 0; k < e.components && i + k < S.components.length; k++) { const c = S.components[i + k]; vt.fill(0, c.start, c.start + c.count); }
  }
  const buckets = new Map();
  for (let v = 0; v < nv; v += 3) {
    const o = v * 3, x = (S.pos[o] + S.pos[o + 3] + S.pos[o + 6]) / 3, z = (S.pos[o + 2] + S.pos[o + 5] + S.pos[o + 8]) / 3;
    const cx = Math.floor(x / TOWN_CELL), cz = Math.floor(z / TOWN_CELL), t = vt[v], key = cx + ',' + cz + ',' + t;
    let b = buckets.get(key);
    if (!b) buckets.set(key, b = { pos: [], fac: [], tier: t, x: (cx + .5) * TOWN_CELL, z: (cz + .5) * TOWN_CELL });
    for (let j = o; j < o + 9; j++) { b.pos.push(S.pos[j]); b.fac.push(S.fac[j]); }
  }
  return [...buckets.values()].map((b) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('aFacade', new THREE.Float32BufferAttribute(b.fac, 3));
    g.computeVertexNormals();
    return { geo: g, tier: b.tier, x: b.x, z: b.z };
  });
}

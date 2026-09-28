import * as THREE from 'three';
import { createFacadeMaterial } from './facade.js';
import { latheFacade, loftSections, sweepTube, mergeClean } from './geom.js';
import { sweepLoop } from './platform.js';
import { mulberry32 } from './noise.js';
import { outerCities, renderedHeight } from './outerCities.js';
import { terrainHeight } from './terrain.js';
import { buildMassifTowns } from './massifTowns.js';
import { buildOuterLOD } from './outerLod.js';
import { islandPrism, islandFoundation, islandRoad, footprintGround, rectangle, circleFootprint, buildIslandPlan, pointSegmentDistance, islandRoadHeight, someCircleNear } from './islandPlan.js';
import { buildIslandLandscape } from './islandLandmarks.js';
import { ISLAND_CITY_BUILDERS, islandCityReserve, createGiltMaterial, islandCitySignals } from './islands/index.js';
import { buildIslandCountryside } from './islands/countryside.js';
import { vesperLagoon, vesperCathedral } from './islands/vesper.js';
import { australArcology } from './islands/austral.js';

/** Everything built on the island land (districts, landmarks, villas, lighthouses) as keep-out
 *  circles {x, z, r}, filled by buildSkyline(): ground cover grows only outside them. */
export const SKYLINE_KEEPOUT = [];

// The outer cities of Greater Meridian, seen from the lagoon and the wards at 20-40 km.
//   Thalassa   a white city in terraces following the contours of its island, a temple of
//              the sea on the summit
//   Anchorage  the western port: a dense skyline, twin towers joined by a sky arch over the
//              harbour head, long moles with cranes
//   Orison     needle towers with gold crowns that catch the first light
//   Vesper     low white town of domes round its harbour, a cathedral spire, a tall lighthouse
//   Austral    one great spire among a ring of towers
//   Ridgeholm, Highgate, Cloudmere: terrace towns stepping up the massif's southern slopes
//              (built in massifTowns.js)
// Every island city has a harbour built out to the 3.5 m isobath on the coast facing the
// capital: a quay with its sea wall, moles with lighthouses, a ferry pier, a waterfront row.
// Everything stands on the terrain exactly as it is drawn (renderedHeight), and is massing
// under the full facade shader, so windows light the cities at night.

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------ primitives --
function tower(rnd, x, y, z, H, R, style = rnd()) {
  const seg = 8 + Math.floor(rnd() * 5);
  const prof = [];
  const rows = 8;
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    let r = R;
    if (style < 0.3) r = R * (1 - 0.5 * Math.pow(v, 1.4));
    else if (style < 0.55) r = R * (0.86 + 0.24 * Math.sin(Math.PI * v)) * (1 - 0.3 * v);
    else r = R * (1 - 0.2 * Math.floor(v * 4) / 4);
    prof.push({ r, y: y + 8 + H * v, kind: j === rows ? 1 : 0 });
  }
  const top = y + 8 + H;
  const rt = prof[prof.length - 1].r;
  prof.push({ r: rt * 0.84, y: top + 4, kind: 2 }, { r: rt * 0.32, y: top + 11, kind: 1 }, { r: 0.6, y: top + Math.max(12,H * (0.05 + 0.07 * rnd())), kind: 2 }, { r: 0.01, y: top + H * 0.13, kind: 1 });
  const profile=[{ r: R * 1.25, y: y - 6, kind: 1 }, { r: R * 1.25, y: y + 8, kind: 5 }, ...prof],g = latheFacade(profile, seg, { phase: rnd() * TAU });
  g.userData.islandLatheProfile={rows:profile.length,segments:seg};return g.translate(x,0,z);
}

function needle(rnd, x, y, z, H, R) {
  const prof = [{ r: R * 1.6, y: y - 6, kind: 1 }, { r: R * 1.6, y: y + 10, kind: 5 }];
  for (let j = 0; j <= 6; j++) { const v = j / 6; prof.push({ r: R * (1 - 0.72 * Math.pow(v, 1.2)), y: y + 10 + H * 0.86 * v, kind: 0 }); }
  prof.push({ r: R * 0.34, y: y + 10 + H * 0.88, kind: 2 }, { r: R * 0.2, y: y + 10 + H * 0.96, kind: 2 }, { r: 0.4, y: y + 10 + H, kind: 2 });
  const g=latheFacade(prof,6,{phase:rnd()*TAU}).translate(x,0,z);g.userData.islandLatheProfile={rows:prof.length,segments:6};return g;
}

function block(x, y, z, H, w, d, rot, wall = 5, top = 1) {
  const g = latheFacade([{ r: 1, y: y - 7, kind: wall }, { r: 1, y: y + H, kind: wall }, { r: 0.001, y: y + H, kind: top }], 4, { phase: Math.PI / 4 });
  g.scale(w * 0.7071, 1, d * 0.7071);
  g.rotateY(rot);
  return g.translate(x, 0, z);
}

const prism4 = islandPrism;

/** The lowest rendered ground under a footprint. */
function groundMin(x, z, r) {
  let m = renderedHeight(x, z);
  for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; m = Math.min(m, renderedHeight(x + Math.cos(a) * r, z + Math.sin(a) * r)); }
  return m;
}

/** Closed quay/mole section, with its seabed sole and exposed ends. */
const harbourSweep=(loop,section)=>sweepLoop(loop,section,{closed:false,closeSection:true,capEnds:true,capKind:1});

// --------------------------------------------------------------- harbour --
function harbour(parts, c, rnd, lights, { moleReach = 340, cranes = 0, lighthouseH = 34 } = {}) {
  const Q = c.quayLine;
  // quay: sea wall and fender facing the sea, a 70 m quay top, its back wall into the land
  const quay=harbourSweep(Q, () => [
    { a: [2.6, -16], b: [0, 2.5], kind: 1 },
    { a: [0, 2.5], b: [0, 3.45], kind: 10 },
    { a: [0, 3.45], b: [-0.8, 3.45], kind: 1 },
    { a: [-0.8, 3.45], b: [-0.8, 3.0], kind: 1 },
    { a: [-0.8, 3.0], b: [-70, 3.0], kind: 9 },
    { a: [-70, 3.0], b: [-70, -9], kind: 1 },
  ]);quay.userData.islandPublicFloor=true;parts.push(quay);
  const d = c.d, sd = c.side;
  // moles from both quay ends, curving in to leave a mouth on the axis
  const ends = [Q[0], Q[Q.length - 1]];
  const mouth = [c.deep.x + d[0] * moleReach, c.deep.z + d[1] * moleReach];
  ends.forEach((e, i) => {
    const s = i === 0 ? -1 : 1;             // the first quay end lies on the -side of the axis
    const tip = [mouth[0] + sd[0] * s * 62, mouth[1] + sd[1] * s * 62];
    const ctrl = [[e[0], e[1]], [e[0] + d[0] * moleReach * 0.55, e[1] + d[1] * moleReach * 0.55], tip];
    const curve = new THREE.CatmullRomCurve3(ctrl.map(([x, z]) => V(x, 0, z)), false, 'centripetal');
    const pts = curve.getSpacedPoints(24).map((v) => [v.x, v.z]);
    parts.push(harbourSweep(pts, () => [
      { a: [9, -16], b: [8, 4.2], kind: 1 },
      { a: [8, 4.2], b: [-8, 4.2], kind: 9 },
      { a: [-8, 4.2], b: [-9, -16], kind: 1 },
    ], { closed: false }));
    parts.push(latheFacade([{ r: 11, y: -16, kind: 1 }, { r: 10, y: 4.2, kind: 1 }, { r: 0.1, y: 4.2, kind: 9 }], 20).translate(tip[0], 0, tip[1]));
    const h = lighthouseH;
    parts.push(latheFacade([{ r: 4.2, y: 4, kind: 1 }, { r: 3.0, y: 4 + h * 0.82, kind: 1 }, { r: 3.9, y: 4 + h * 0.84, kind: 10 }, { r: 2.6, y: 4 + h * 0.85, kind: 2 }, { r: 2.6, y: 4 + h * 0.95, kind: 2 }, { r: 0.05, y: 4 + h + 2, kind: 10 }], 12).translate(tip[0], 0, tip[1]));
    lights.push({ x: tip[0], y: 4 + h * 0.9, z: tip[1], c: i === 0 ? [1.0, 0.22, 0.12] : [0.25, 1.0, 0.45], s: 2.6 });
    if (cranes) for (let k = 0; k < cranes; k++) {
      const p = pts[6 + k * 4];
      if (!p) continue;
      const angle=Math.atan2(d[1],d[0]);
      parts.push(prism4(rectangle(p[0],p[1],16,10,angle),3.7,36.2,8,1));
      parts.push(prism4(rectangle(p[0]+d[0]*18,p[1]+d[1]*18,52,4,angle),35.5,39,1,1));
      parts.push(sweepTube([V(p[0]-d[0]*5,25,p[1]-d[1]*5),V(p[0]+d[0]*35,35.5,p[1]+d[1]*35)],()=>.7,6,{kind:10}));
      parts.push(sweepTube([V(p[0]+d[0]*39,35.5,p[1]+d[1]*39),V(p[0]+d[0]*39,14,p[1]+d[1]*39)],()=>.28,5,{kind:10}));
    }
  });
  // A level arrival square receives the existing offshore station bridge. Its central
  // axis stays open, while two supported arcades frame the first inland boulevard.
  const ax=c.deep.x-d[0]*34,az=c.deep.z-d[1]*34,angle=Math.atan2(d[1],d[0]);
  const arrival=prism4(rectangle(ax,az,58,78,angle),-16,3.75,1,9);arrival.userData.islandPublicFloor=true;parts.push(arrival);
  for(const side of [-1,1]){
    let previous;
    for(let k=0;k<5;k++){
      const x=ax+d[0]*(k*10-20)+sd[0]*side*28,z=az+d[1]*(k*10-20)+sd[1]*side*28;
      if(!c.plan.isRoadFree(x,z,1.2)){previous=undefined;continue;}
      parts.push(latheFacade([{r:.9,y:3.75,kind:1},{r:.7,y:13,kind:1},{r:1.1,y:13.5,kind:1}],8).translate(x,0,z));
      if(previous)parts.push(prism4(rectangle((x+previous[0])/2,(z+previous[1])/2,12.2,4,angle),13.3,15,1,3));
      previous=[x,z];
    }
  }
  // the ferry pier and its terminal
  // The ferry berth occupies a side bay; the centre is reserved for the Great Ring
  // station footbridge, whose landing is at deep - d*22.
  const m0 = Q[Math.min(Q.length-3,Math.floor(Q.length / 2)+3)];
  const pier = [[m0[0] - d[0] * 29, m0[1] - d[1] * 29], [m0[0] + d[0] * 95, m0[1] + d[1] * 95]];
  parts.push(harbourSweep(pier, () => [{ a: [6, -12], b: [6, 3.7], kind: 1 }, { a: [6, 3.7], b: [-6, 3.7], kind: 9 }, { a: [-6, 3.7], b: [-6, -12], kind: 1 }], { closed: false }));
  const tb = [m0[0] - d[0] * 40, m0[1] - d[1] * 40];
  parts.push(block(tb[0], 3.0, tb[1], 13, 60, 24, Math.atan2(d[0], d[1]), 0, 3));
  // the waterfront row along the back of the quay
  for (let i = 0; i < Q.length - 1; i++) {
    const a = Q[i], b = Q[i + 1];
    const tx = b[0] - a[0], tz = b[1] - a[1], L = Math.hypot(tx, tz) || 1;
    const n = [-tz / L, tx / L];         // inland (left of travel)
    const segs = Math.max(1, Math.floor(L / 46));
    for (let k = 0; k < segs; k++) {
      const t0 = (k + 0.08) / segs, t1 = (k + 0.92) / segs;
      const p0 = [a[0] + tx * t0, a[1] + tz * t0], p1 = [a[0] + tx * t1, a[1] + tz * t1];
      const dep = 18 + rnd() * 10;
      const q = [[p0[0] + n[0] * 74, p0[1] + n[1] * 74], [p1[0] + n[0] * 74, p1[1] + n[1] * 74], [p1[0] + n[0] * (74 + dep), p1[1] + n[1] * (74 + dep)], [p0[0] + n[0] * (74 + dep), p0[1] + n[1] * (74 + dep)]];
      const centre=q.reduce((a,p)=>[a[0]+p[0]/4,a[1]+p[1]/4],[0,0]);
      if(c.plan&&!c.plan.isRoadFree(centre[0],centre[1],Math.hypot(L/segs,dep)/2+3))continue;
      const g0 = Math.min(3, ...q.map(([x, z]) => renderedHeight(x, z)));
      parts.push(prism4(q, g0 - 5, Math.max(g0, 3) + 14 + rnd() * 20, 5, 3));
    }
  }
  return mouth;
}

// ---------------------------------------------------------------- styles --
function segDist(px, pz, a, b) {
  const ex = b[0] - a[0], ez = b[1] - a[1], L2 = ex * ex + ez * ez || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * ex + (pz - a[1]) * ez) / L2));
  return Math.hypot(px - a[0] - ex * t, pz - a[1] - ez * t);
}

/**
 * The urban fabric: a street grid in the city's own frame (u toward the capital, v along the
 * coast). Every city block is a paved podium cut into the slope (its downhill side a retaining
 * wall, its foot sunk below the lowest ground of the cell, its top just above the highest), so
 * the town steps up the island in terraces. The streets run on the podium tops between the lots,
 * and every building stands on its own lot of its own podium.
 * lot(Lq, lu, lv, top, t) builds on one lot; cell(P, u0, v0, u1, v1, top, t) may take a whole
 * block instead (towers, domes) and returns true when it did.
 */
function urbanGrid(parts, c, rnd, o, placed) {
  const { ox, oz, ra, rs, size, street = 14, maxSlope = 18, minG = 2.2, lot, cell } = o;
  const d = c.d, sd = c.side;
  const P = (u, v) => {
    const bend = c.id === 'thalassa' ? 65 * Math.sin(u / 480) : c.id === 'vesper' ? 34 * Math.sin(u / 420) : 0;
    return [ox + d[0] * u + sd[0] * (v + bend), oz + d[1] * u + sd[1] * (v + bend)];
  };
  const Q = c.quayLine, roads = new Map(),entrances=[];
  const nU = Math.ceil(ra / size), nV = Math.ceil(rs / size);
  const obstacle = placed.slice();
  const edge = (i0,j0,i1,j1) => {
    const key = [[i0,j0].join(','),[i1,j1].join(',')].sort().join('|');
    if (!roads.has(key)) roads.set(key, [P(i0*size,j0*size),P(i1*size,j1*size)]);
  };
  for (let i = -nU; i < nU; i++) for (let j = -nV; j < nV; j++) {
    const u0=i*size,v0=j*size,u1=u0+size,v1=v0+size,uc=(u0+u1)/2,vc=(v0+v1)/2;
    const t=Math.hypot(uc/ra,vc/rs);if(t>1-.13*rnd())continue;
    const [cx,cz]=P(uc,vc);
    if(Q.slice(1).some((q,k)=>segDist(cx,cz,Q[k],q)<115+size*.71))continue;
    if(obstacle.some(p=>Math.hypot(p.x-cx,p.z-cz)<p.r+size*.73))continue;
    if(c.plan?.reserved.some(p=>Math.hypot(p.x-cx,p.z-cz)<p.r+size*.73+street/2))continue;
    const ground=footprintGround([P(u0,v0),P(u1,v0),P(u1,v1),P(u0,v1)],20);
    if(ground.min<minG||ground.max-ground.min>maxSlope)continue;
    for(const e of [[i,j,i+1,j],[i+1,j,i+1,j+1],[i+1,j+1,i,j+1],[i,j+1,i,j]])edge(...e);
    const s=street/2+2,pad=[P(u0+s,v0+s),P(u1-s,v0+s),P(u1-s,v1-s),P(u0+s,v1-s)];
    // The regional boulevard occupies its reserved corridor; local street strips still
    // connect around it, but no building or raised plot can obstruct its passage.
    if(c.plan&&!c.plan.isRoadFree(cx,cz,size*.72))continue;
    if(rnd()<.07){const top=islandFoundation(parts,pad,{kind:3,name:`${c.id} neighbourhood garden`}),gate=[(pad[0][0]+pad[1][0])/2,(pad[0][1]+pad[1][1])/2];entrances.push({from:P(uc,v0),to:gate,top,width:4,q:pad,kind:'neighbourhood garden'});placed.push({x:cx,z:cz,r:size*.6});continue;}
    if(cell){
      const pg=footprintGround(pad,8),top=pg.max+.85,before=parts.length;
      if(cell(P,u0+s,v0+s,u1-s,v1-s,top,t)){
        const structures=parts.splice(before);islandFoundation(parts,pad,{top,kind:9,name:`${c.id} tower court`});parts.push(...structures);
        const gate=[(pad[0][0]+pad[1][0])/2,(pad[0][1]+pad[1][1])/2],streetP=P(uc,v0);entrances.push({from:streetP,to:gate,top,width:4,q:pad});
        placed.push({x:cx,z:cz,r:size*.6});continue;
      }
    }
    const nu=rnd()<.6?2:1,nv=rnd()<.6?2:1,gap=6;
    const lu=(size-2*s-gap*(nu-1))/nu,lv=(size-2*s-gap*(nv-1))/nv;
    for(let a=0;a<nu;a++)for(let b=0;b<nv;b++){
      const au=u0+s+a*(lu+gap),bv=v0+s+b*(lv+gap);
      const Lq=(iu0,iv0,iu1,iv1)=>[P(au+iu0,bv+iv0),P(au+iu1,bv+iv0),P(au+iu1,bv+iv1),P(au+iu0,bv+iv1)];
      const q=Lq(0,0,lu,lv),top=islandFoundation(parts,q,{name:`${c.id} street-front plot`,kind:9});
      lot(Lq,lu,lv,top,t);
      const vEdge=b===0?v0:v1,e=b===0?[q[0],q[1]]:[q[2],q[3]],gate=[(e[0][0]+e[1][0])/2,(e[0][1]+e[1][1])/2],streetP=P(au+lu/2,vEdge);
      entrances.push({from:streetP,to:gate,top,width:3.2,q});
      const centre=P(au+lu/2,bv+lv/2);placed.push({x:centre[0],z:centre[1],r:Math.hypot(lu,lv)/2+1});
    }
  }
  const surfaces=[],junctions=new Map();
  const junction=p=>{const key=p.join(',');if(junctions.has(key))return junctions.get(key);let y=renderedHeight(...p);for(let k=0;k<16;k++)y=Math.max(y,renderedHeight(p[0]+Math.cos(k*TAU/16)*street*.44,p[1]+Math.sin(k*TAU/16)*street*.44));y+=.28;junctions.set(key,y);return y;};
  for(const points of roads.values()){
    const sections=islandRoad(parts,points,street*.88,{startY:junction(points[0]),endY:junction(points.at(-1)),keepouts:SKYLINE_KEEPOUT});surfaces.push({sections,points});parts.at(-1).userData.islandStreet={from:points[0],to:points.at(-1)};
    const mid=[(points[0][0]+points[1][0])/2,(points[0][1]+points[1][1])/2];
    placed.push({x:mid[0],z:mid[1],r:street/2+2});
  }
  // Finalize all public road crossings before building these entrance flights.
  c.plan.coreEntrances.push(...entrances);
}

/** A building on a lot: a body, and for tall ones a set-back upper stage and a lantern crown. */
function building(parts, rnd, Lq, lu, lv, top, H, wall = 5, roof = 9) {
  const inset = Math.min(lu, lv) * (0.04 + 0.1 * rnd());
  parts.push(prism4(Lq(inset, inset, lu - inset, lv - inset), top - 1.5, top + H, wall, roof));
  if (H > 40) {
    const k = Math.min(lu, lv) * 0.2;
    const H2 = H * (0.2 + 0.35 * rnd());
    parts.push(prism4(Lq(k, k, lu - k, lv - k), top + H - 0.5, top + H + H2, rnd() < 0.5 ? 0 : wall, roof));
    if (H > 90) parts.push(prism4(Lq(k * 1.9, k * 1.9, lu - k * 1.9, lv - k * 1.9), top + H + H2 - 0.5, top + H + H2 + 6, 2, 2));
  }
}

/** The island's footprint record and its far-shore lighthouse. The farms, villas, fields
 *  and lanes of the countryside are laid after the island's roads are graded, by
 *  islands/countryside.js (see buildSkyline). */
function countryside(parts, c, rnd, lights, placed, n) {
  FOOTPRINTS.push({ c, placed });
  c.plan.holdings=[];c.plan.holdingPaths=[];
  for (const p of placed) SKYLINE_KEEPOUT.push(p);
  // the lighthouse on the far shore
  const a = c.toward + Math.PI;
  const e = [Math.cos(a), Math.sin(a)];
  for (let s = c.ir * 3; s > 0; s -= 10) {
    const x = c.ix + e[0] * s, z = c.iz + e[1] * s;
    if (renderedHeight(x, z) < 3) continue;
    const g = groundMin(x, z, 9);
    SKYLINE_KEEPOUT.push({ x, z, r: 16 });
    parts.push(latheFacade([{ r: 9, y: g - 4, kind: 1 }, { r: 9, y: g + 3, kind: 1 }, { r: 4.6, y: g + 3, kind: 1 }, { r: 3.4, y: g + 36, kind: 1 }, { r: 4.4, y: g + 37, kind: 10 }, { r: 2.8, y: g + 38, kind: 2 }, { r: 2.8, y: g + 43, kind: 2 }, { r: 0.05, y: g + 47, kind: 10 }], 12).translate(x, 0, z));
    lights.push({ x, y: g + 41, z, c: [1.0, 0.95, 0.8], s: 2.4 });
    placed.push({ x, z, r: 16 });
    break;
  }
}

function summit(c) {
  let best = { h: -1e9 };
  for (let r = 0; r < c.ir * 0.9; r += 120) for (let a = 0; a < TAU; a += 0.35) {
    const x = c.ix + Math.cos(a) * r, z = c.iz + Math.sin(a) * r;
    const h = renderedHeight(x, z);
    if (h > best.h) best = { x, z, h };
  }
  return best;
}

/** Join monumental approaches to real streets through a reserved clear corridor. */
function clearStreetArrival(parts,desired,door,width,{exclude=()=>false,accept=()=>true}={}){
  const candidates=[],obstacles=parts.filter(g=>g.userData.islandFoundation&&!exclude(g.userData.islandFoundation.name)).map(g=>{const q=g.userData.islandFoundation.q,centre=q.reduce((s,p)=>[s[0]+p[0]/q.length,s[1]+p[1]/q.length],[0,0]);return{centre,r:Math.max(...q.map(p=>Math.hypot(p[0]-centre[0],p[1]-centre[1])))};});
  for(const g of parts.filter(g=>g.userData.islandStreet)){
    const p=g.userData.islandRoad.points;for(let i=1;i<p.length;i++){
      const a=p[i-1],b=p[i],dx=b[0]-a[0],dz=b[1]-a[1],f=Math.max(0,Math.min(1,((desired[0]-a[0])*dx+(desired[1]-a[1])*dz)/(dx*dx+dz*dz))),point=[a[0]+dx*f,a[1]+dz*f];
      if(!accept(point))continue;const len=Math.hypot(point[0]-door[0],point[1]-door[1]);if(len>600||len<10)continue;
      if(obstacles.some(o=>pointSegmentDistance(...o.centre,point,door)<o.r+width/2+1))continue;
      candidates.push({point,score:Math.hypot(point[0]-desired[0],point[1]-desired[1])+len*.2});
    }
  }
  candidates.sort((a,b)=>a.score-b.score);if(!candidates.length)throw new Error(`Monument needs a clear street arrival at ${door}`);return candidates[0].point;
}

function buildThalassa(parts, c, rnd, lights) {
  harbour(parts, c, rnd, lights, { moleReach: 320 });
  const s = summit(c);
  // A measured summit foundation carries every tier, and the entire colonnade sits
  // within its upper stylobate. The dome is translated to this same island coordinate.
  const floor = islandFoundation(parts, rectangle(s.x,s.z,182,182,.3), {name:'Thalassa sea temple foundation'});
  const axis=[[Math.cos(.3),Math.sin(.3)],[-Math.sin(.3),Math.cos(.3)]],front=[...axis,...axis.map(a=>a.map(v=>-v))].sort((a,b)=>(b[0]*c.d[0]+b[1]*c.d[1])-(a[0]*c.d[0]+a[1]*c.d[1]))[0];
  const right=[front[1],-front[0]],T=(u,v)=>[s.x+right[0]*u+front[0]*v,s.z+right[1]*u+front[1]*v];
  const templeRect=(u0,v0,u1,v1)=>[T(u0,v0),T(u1,v0),T(u1,v1),T(u0,v1)];
  // Each stylobate is a closed U-shaped assembly around an actual stair opening.
  // Its central sanctuary stays solid under the complete ring of columns.
  for(let k=0;k<4;k++){
    const h=75-k*10,y0=floor+k*5-.2,y1=floor+(k+1)*5;
    for(const q of [templeRect(-h,-h,h,40),templeRect(-h,40,-9,h),templeRect(9,40,h,h)])parts.push(prism4(q,y0,y1,1,9));
    // A projecting coping course and paired urn plinths articulate every accessible step.
    for(const u of [-h+3,h-3])parts.push(prism4(templeRect(u-1,-h,u+1,h),y1-.7,y1+.3,1,1));
  }
  const stylobate=floor+20;
  for(let k=0;k<18;k++){const a=k/18*TAU;parts.push(latheFacade([{r:2.2,y:stylobate,kind:1},{r:1.8,y:stylobate+24,kind:1},{r:2.6,y:stylobate+25,kind:1}],8).translate(s.x+Math.cos(a)*36,0,s.z+Math.sin(a)*36));}
  parts.push(latheFacade([{r:40,y:stylobate+24.5,kind:1},{r:40,y:stylobate+28,kind:1},{r:34,y:stylobate+28,kind:0},{r:26,y:stylobate+46,kind:0},{r:12,y:stylobate+56,kind:0},{r:5,y:stylobate+58,kind:2},{r:3,y:stylobate+70,kind:2},{r:.1,y:stylobate+76,kind:1}],32).translate(s.x,0,s.z));
  lights.push({x:s.x,y:stylobate+70,z:s.z,c:[1,.85,.6],s:4});
  const approach=T(0,240),door=T(0,91);
  islandRoad(parts,[T(0,91),T(0,40)],16,{startY:floor,endY:stylobate,steps:true,keepouts:SKYLINE_KEEPOUT});
  // Thin continuous courses break down the white retaining faces; their intervals are
  // structural stonework, leaving the new entrance and its upper flight fully clear.
  const baseGround=footprintGround(rectangle(s.x,s.z,182,182,.3));
  for(let y=Math.ceil((baseGround.min+2)/6)*6;y<floor-1;y+=6){
    parts.push(prism4(templeRect(-92,-92,92,-90.5),y,y+.42,1,1));
    for(const u of [-91.25,91.25])parts.push(prism4(templeRect(u-.75,-91,u+.75,91),y,y+.42,1,1));
    for(const u of [-51,51])parts.push(prism4(templeRect(u-39.5,90.5,u+39.5,92),y,y+.42,1,1));
  }
  for(const side of [-1,1])for(const v of [-65,-38,-11,16,43,70]){
    const p=T(side*92,v);islandFoundation(parts,rectangle(p[0],p[1],4.2,5,.3),{top:floor+.4,name:'Thalassa temple wall pier'});
  }
  for(const u of [-65,-36,36,65]){
    const p=T(u,88),q=rectangle(p[0],p[1],13,7,Math.atan2(right[1],right[0]));parts.push(prism4(q,floor-.2,floor+.8,1,3));
    parts.push(latheFacade([{r:1.8,y:floor+.8,kind:1},{r:1.2,y:floor+2.6,kind:1},{r:2.1,y:floor+3.5,kind:2},{r:1.3,y:floor+4.5,kind:2},{r:.1,y:floor+5.8,kind:2}],12).translate(p[0],0,p[1]));
  }
  // Four grounded buttress piers articulate the retaining wall below the sanctuary.
  for(const [u,v]of [[-91,-91],[91,-91],[91,91],[-91,91]]){const cs=Math.cos(.3),sn=Math.sin(.3),x=s.x+u*cs-v*sn,z=s.z+u*sn+v*cs;islandFoundation(parts,rectangle(x,z,13,13,.3),{top:floor+1.2,name:'Thalassa temple buttress'});}
  const placed = [{ x: s.x, z: s.z, r: 150 }];
  // the white town climbs from the harbour to the temple in terraces
  const bx = c.coast.x - c.d[0] * 150, bz = c.coast.z - c.d[1] * 150;
  const L = Math.hypot(s.x - bx, s.z - bz);
  urbanGrid(parts, c, rnd, { ox: (bx + s.x) / 2, oz: (bz + s.z) / 2, ra: L / 2 + 120, rs: 850, size: 76, street: 12, maxSlope: 28,
    lot: (Lq, lu, lv, top, t) => building(parts, rnd, Lq, lu, lv, top, 7 + rnd() * 14 * (1.2 - t), 5, rnd() < 0.3 ? 3 : 9) }, placed);
  const arrival=clearStreetArrival(parts,approach,door,18,{exclude:n=>n.startsWith('Thalassa temple')||n==='Thalassa sea temple foundation',accept:p=>(p[0]-s.x)*front[0]+(p[1]-s.z)*front[1]>=140});
  c.plan.coreEntrances.push({from:arrival,to:door,top:floor,width:18,q:rectangle(s.x,s.z,182,182,.3),kind:'temple approach'});
  countryside(parts, c, rnd, lights, placed, 70 * 3);
}

function buildAnchorage(parts, c, rnd, lights) {
  harbour(parts, c, rnd, lights, { moleReach: 480, cranes: 3, lighthouseH: 40 });
  const placed = [];
  // the twin towers at the harbour head, joined by a sky arch
  const hx = c.coast.x - c.d[0] * 420, hz = c.coast.z - c.d[1] * 420;
  const tw = [];
  for (const s of [-1, 1]) {
    const x = hx + c.side[0] * s * 95, z = hz + c.side[1] * s * 95;
    const g = groundMin(x, z, 48);
    parts.push(tower(rnd, x, g - 4, z, 680, 38, 0.6));
    tw.push(V(x, g + 520, z));
    placed.push({ x, z, r: 50 });
    lights.push({ x, y: g + 680 + 8, z, c: [0.9, 0.95, 1.0], s: 3 });
  }
  const arc = [];
  for (let i = 0; i <= 20; i++) { const t = i / 20; const p = tw[0].clone().lerp(tw[1], t); p.y += 34 * Math.sin(Math.PI * t); arc.push(p); }
  parts.push(sweepTube(arc, () => 7, 10, { kind: 0 }));
  parts.push(sweepTube(arc.map((p) => p.clone().add(V(0, -7.5, 0))), () => 1.0, 5, { kind: 2 }));
  // a dense grid: towers in the centre, slabs and courts round them
  urbanGrid(parts, c, rnd, { ox: c.coast.x - c.d[0] * 1000, oz: c.coast.z - c.d[1] * 1000, ra: 1000, rs: 1700, size: 100, street: 16,
    cell: (P, u0, v0, u1, v1, top, t) => {
      if (t > 0.55 || rnd() > 0.34) return false;
      const R = Math.min(u1 - u0, v1 - v0) / 2 / 1.3;
      const [x, z] = P((u0 + u1) / 2, (v0 + v1) / 2);
      parts.push(tower(rnd, x, top, z, (160 + rnd() * 300) * (1.15 - t), R * (0.7 + 0.3 * rnd()), 0.55 + rnd() * 0.45));
      return true;
    },
    lot: (Lq, lu, lv, top, t) => building(parts, rnd, Lq, lu, lv, top, (16 + rnd() * 60) * (1.3 - t), 5, 9) }, placed);
  countryside(parts, c, rnd, lights, placed, 90 * 3);
}

function buildOrison(parts, c, rnd, lights) {
  harbour(parts, c, rnd, lights, { moleReach: 300 });
  const placed = [];
  urbanGrid(parts, c, rnd, { ox: c.coast.x - c.d[0] * 1000, oz: c.coast.z - c.d[1] * 1000, ra: 950, rs: 1300, size: 90, street: 14,
    cell: (P, u0, v0, u1, v1, top, t) => {
      if (rnd() > 0.3 * (1.2 - t)) return false;
      const R = Math.min(u1 - u0, v1 - v0) / 2 / 1.7;
      const [x, z] = P((u0 + u1) / 2, (v0 + v1) / 2);
      parts.push(needle(rnd, x, top - 3, z, (240 + rnd() * 480) * (1.2 - t), R * (0.7 + 0.3 * rnd())));
      return true;
    },
    lot: (Lq, lu, lv, top, t) => building(parts, rnd, Lq, lu, lv, top, 10 + rnd() * 26 * (1.2 - t), 5, 7) }, placed);
  countryside(parts, c, rnd, lights, placed, 60 * 3);
}

function buildVesper(parts, c, rnd, lights) {
  const placed = [];
  // the Lagoon: a round harbour basin closed by a crescent quay of domed houses, with the
  // lighthouse and the harbour light on the bastions of its mouth (islands/vesper.js)
  vesperLagoon(parts, c, rnd, lights, placed);
  // the cathedral: a basilica with a crossing dome and a campanile spire, facing the harbour
  const cathedral = vesperCathedral(parts, c, lights, [c.coast.x - c.d[0] * 520, c.coast.z - c.d[1] * 520]);
  placed.push({ x: cathedral.P0[0], z: cathedral.P0[1], r: 122 });
  // the white town of domes round the harbour
  urbanGrid(parts, c, rnd, { ox: c.coast.x - c.d[0] * 850, oz: c.coast.z - c.d[1] * 850, ra: 850, rs: 1600, size: 64, street: 10,
    cell: (P, u0, v0, u1, v1, top) => {
      if (rnd() > 0.22) return false;
      const r = Math.min(u1 - u0, v1 - v0) / 2 * 0.86;
      const [x, z] = P((u0 + u1) / 2, (v0 + v1) / 2);
      parts.push(latheFacade([{ r: r * 1.05, y: top - 2, kind: 5 }, { r: r * 1.05, y: top + r * 0.45, kind: 5 }, { r: r * 1.1, y: top + r * 0.5, kind: 1 }, { r: r * 0.9, y: top + r * 0.95, kind: rnd() < 0.3 ? 7 : 1 }, { r: r * 0.5, y: top + r * 1.3, kind: 1 }, { r: 0.1, y: top + r * 1.45, kind: 2 }], 16).translate(x, 0, z));
      return true;
    },
    lot: (Lq, lu, lv, top) => building(parts, rnd, Lq, lu, lv, top, 6 + rnd() * 12, 5, 9) }, placed);
  // the cathedral's steps meet a real street square in front of one of its stylobate's sides,
  // so the flight climbs straight to its door
  {
    const q = cathedral.q, obstacles = parts.filter((g) => g.userData.islandFoundation && !g.userData.islandFoundation.name.startsWith('Vesper cathedral')).map((g) => { const f = g.userData.islandFoundation.q, cx = f.reduce((s, p) => s + p[0] / f.length, 0), cz = f.reduce((s, p) => s + p[1] / f.length, 0); return { cx, cz, r: Math.max(...f.map((p) => Math.hypot(p[0] - cx, p[1] - cz))) }; });
    let best = null;
    for (const g of parts) {
      if (!g.userData.islandStreet) continue;
      const pts = g.userData.islandRoad.points;
      for (let i = 0; i < pts.length; i++) for (let e = 0; e < 4; e++) {
        const A = q[e], B = q[(e + 1) % 4], L = Math.hypot(B[0] - A[0], B[1] - A[1]), tx = (B[0] - A[0]) / L, tz = (B[1] - A[1]) / L;
        const cxq = q.reduce((s, p) => s + p[0] / 4, 0), czq = q.reduce((s, p) => s + p[1] / 4, 0);
        let nx = -tz, nz = tx; if (nx * (A[0] - cxq) + nz * (A[1] - czq) < 0) { nx = -nx; nz = -nz; }
        const p = pts[i], along = (p[0] - A[0]) * tx + (p[1] - A[1]) * tz, out = (p[0] - A[0]) * nx + (p[1] - A[1]) * nz;
        if (along < 16 || along > L - 16 || out < 12 || out > 140) continue;
        const door = [A[0] + tx * along, A[1] + tz * along];
        if (obstacles.some((o) => pointSegmentDistance(o.cx, o.cz, p, door) < o.r + 9)) continue;
        if (!best || out < best.out) best = { from: p, door, out };
      }
    }
    if (!best) throw new Error('Vesper cathedral needs a street square to one of its sides');
    c.plan.coreEntrances.push({ from: best.from, to: best.door, top: cathedral.top, width: 16, q, kind: 'cathedral approach' });
  }
  countryside(parts, c, rnd, lights, placed, 0);
}

function buildAustral(parts, c, rnd, lights) {
  harbour(parts, c, rnd, lights, { moleReach: 360 });
  const placed = [];
  // the great spire: a five-lobed section turning as it rises
  const sx = c.coast.x - c.d[0] * 950, sz = c.coast.z - c.d[1] * 950;
  const g = islandFoundation(parts,circleFootprint(sx,sz,264,48),{name:'Austral spire foundation',kind:3});
  const H = 1400, R = 110;
  const secs = [];
  for (let j = 0; j <= 60; j++) {
    const v = j / 60, y = g - 4 + v * H * 0.93;
    let s = (1 + 0.5 * Math.exp(-v * 12)) * (1 - 0.55 * Math.pow(v, 1.5));
    if (v > 0.88) s *= Math.pow(1 - (v - 0.88) / 0.12, 0.5) * 0.9 + 0.1;
    const pts = [];
    for (let i = 0; i < 60; i++) { const th = (i / 60) * TAU; const r = R * s * (1 + 0.2 * Math.cos(5 * (th - v * 3.8))) / 1.2; pts.push([sx + Math.cos(th) * r, sz + Math.sin(th) * r]); }
    secs.push({ y, pts, kind: v > 0.86 ? 2 : 0 });
  }
  parts.push(loftSections(secs, { capTop: true, kindTop: 2 }));
  parts.push(latheFacade([{ r: R * 0.1, y: g + H * 0.9, kind: 1 }, { r: 0.6, y: g + H * 1.06, kind: 2 }], 10).translate(sx, 0, sz));
  parts.push(latheFacade([{r:R*2.4,y:g-.1,kind:1},{r:R*2.4,y:g+.7,kind:1},{r:R*2.1,y:g+1.2,kind:3},{r:.1,y:g+1.2,kind:3}],48).translate(sx,0,sz));
  lights.push({ x: sx, y: g + H * 1.06, z: sz, c: [0.8, 1.0, 0.9], s: 4 });
  placed.push({ x: sx, z: sz, r: R * 2.6 });
  parts.push(latheFacade([{r:220,y:g+1.15,kind:9},{r:238,y:g+1.15,kind:9},{r:238,y:g+1.5,kind:9},{r:220,y:g+1.5,kind:9}],64,{closedProfile:true}).translate(sx,0,sz));
  const spireApproaches=[];
  for(let k=0;k<5;k++){
    const a=k*TAU/5+c.toward,dx=Math.cos(a),dz=Math.sin(a),A=[sx+dx*355,sz+dz*355],B=[sx+dx*254,sz+dz*254];
    const threshold=rectangle(B[0],B[1],18,6,a+Math.PI/2);
    islandFoundation(parts,threshold,{top:g+1.5,kind:9,name:'Austral spire entrance threshold'});
    spireApproaches.push({A,B,threshold,dx,dz});
    islandRoad(parts,[B,[sx+dx*169,sz+dz*169]],12,{startY:g+1.5,endY:g+1.5,flat:true});
    for(let r=280;r<=355;r+=20)placed.push({x:sx+dx*r,z:sz+dz*r,r:12});
    const pa=a+Math.PI/5,x=sx+Math.cos(pa)*194,z=sz+Math.sin(pa)*194;
    parts.push(latheFacade([{r:1.2,y:g+1.2,kind:1},{r:1,y:g+12,kind:1},{r:12,y:g+13,kind:3},{r:12,y:g+14,kind:1},{r:.1,y:g+17,kind:3}],20).translate(x,0,z));
  }

  // the arcology round the spire: five terraced Petals with sky bridges into the spire, and
  // the ring of tower-gardens carrying the Sky Ring (islands/austral.js)
  australArcology(parts, c, rnd, lights, placed, [sx, sz], g, tower);
  // the arcology's garden-roofed quarters round the spire
  urbanGrid(parts, c, rnd, { ox: sx, oz: sz, ra: 1050, rs: 1400, size: 96, street: 16,
    lot: (Lq, lu, lv, top, t) => building(parts, rnd, Lq, lu, lv, top, (14 + rnd() * 40) * (1.3 - t), rnd() < 0.4 ? 0 : 5, 3) }, placed);
  for(const e of spireApproaches){
    // prefer a street on the avenue's own axis, so the flight climbs straight to its threshold
    const lateral=p=>Math.abs(-(p[0]-sx)*e.dz+(p[1]-sz)*e.dx);let from;
    try{from=clearStreetArrival(parts,e.A,e.B,14,{exclude:n=>n.startsWith('Austral spire'),accept:p=>(p[0]-sx)*e.dx+(p[1]-sz)*e.dz>300&&lateral(p)<3});}
    catch{from=clearStreetArrival(parts,e.A,e.B,14,{exclude:n=>n.startsWith('Austral spire'),accept:p=>(p[0]-sx)*e.dx+(p[1]-sz)*e.dz>300});}
    c.plan.coreEntrances.push({from,to:e.B,top:g+1.5,width:14,q:e.threshold,kind:'spire approach'});
  }
  countryside(parts, c, rnd, lights, placed, 70 * 3);
}

// ------------------------------------------------------------------ build --
// every island city's footprint (districts, landmarks, villas, farms, lighthouse) for
// whatever grows or is built round them later (the island woods)
const FOOTPRINTS = [];
// the cultivated countryside of every island (islands/countryside.js)
const COUNTRYSIDE = [];
const ROAD_CLEARANCE = new Map(), ROAD_CELL=128;
function reserveRoad(points,width){
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],seg={a,b,r:width/2};
    for(let x=Math.floor((Math.min(a[0],b[0])-seg.r)/ROAD_CELL);x<=Math.floor((Math.max(a[0],b[0])+seg.r)/ROAD_CELL);x++)for(let z=Math.floor((Math.min(a[1],b[1])-seg.r)/ROAD_CELL);z<=Math.floor((Math.max(a[1],b[1])+seg.r)/ROAD_CELL);z++){const key=x+','+z;if(!ROAD_CLEARANCE.has(key))ROAD_CLEARANCE.set(key,[]);ROAD_CLEARANCE.get(key).push(seg);}
  }
}
const circleGridHit = (list, x, z, r) => someCircleNear(list, x - r, z - r, x + r, z + r, (p) => Math.hypot(p.x - x, p.z - z) < p.r + r);
/** Is a circle (x, z, r) clear of the island cities, their harbours and countryside? */
export function islandCityFree(x, z, r = 0) {
  for (const cs of COUNTRYSIDE) if (!cs.free(x, z, r)) return false;
  for(let ix=Math.floor((x-r)/ROAD_CELL);ix<=Math.floor((x+r)/ROAD_CELL);ix++)for(let iz=Math.floor((z-r)/ROAD_CELL);iz<=Math.floor((z+r)/ROAD_CELL);iz++)for(const s of ROAD_CLEARANCE.get(ix+','+iz)||[])if(pointSegmentDistance(x,z,s.a,s.b)<r+s.r+1)return false;
  for (const { c, placed, plan } of FOOTPRINTS) {
    if (Math.hypot(x - c.ix, z - c.iz) > c.coast.s * 1.3 + 2000) continue;
    if (circleGridHit(placed, x, z, r)) return false;
    if(plan && (!plan.isRoadFree(x,z,r) || circleGridHit(plan.circles, x, z, r)))return false;
    const Q = c.quayLine;
    for (let k = 0; k < Q.length - 1; k++) if (segDist(x, z, Q[k], Q[k + 1]) < 200 + r) return false;
    if (Math.hypot(x - c.station.x, z - c.station.z) < 220 + r) return false;
  }
  return true;
}

const ISLAND_LOD = [{ dist: 0, cast: true }, { dist: 2000, cast: true }, { dist: 4500, cast: true }, { dist: 8500, cast: false }];
export function buildSkyline(scene, { audit = false } = {}) {
  FOOTPRINTS.length = 0;
  COUNTRYSIDE.length = 0;
  ROAD_CLEARANCE.clear();
  SKYLINE_KEEPOUT.length = 0;
  const auditParts = [], plans = [], cityTrees = [], citySignals = [];
  const oc = outerCities();
  const meshes = [];
  const lights = [];
  let tris = 0, countrysideTris = 0;
  const builders = { terraced: buildThalassa, port: buildAnchorage, needles: buildOrison, domes: buildVesper, spire: buildAustral };
  const add = (parts, pal, seed, name, light) => {
    if(audit)for(const geometry of parts)auditParts.push({name,geometry});
    const mat = createFacadeMaterial(pal, seed, { litFrac: 0.62, band: 128, lampTint: light ? light.map((v) => v / Math.max(...light)) : undefined });
    // Distance tiers (see outerLod.js): stairs, entries and small furniture only up
    // close; the street ribbons to a few km; the connecting and regional roads to the
    // edge of the shadow range; buildings, terraces and landmarks everywhere.
    // Parts built with islands/cityKit.js name their own tier, LOD cell and material.
    const items = [], gilt = [];
    for (const g of parts) {
      if (!g || !g.attributes.position.count) continue;
      const u = g.userData;
      let tier = 3;
      if (u.islandTier !== undefined) {
        (u.islandMaterial === 'gilt' ? gilt : items).push({ geo: g, tier: u.islandTier, x: u.islandAnchor[0], z: u.islandAnchor[1] });
        tris += g.index.count / 3;
        continue;
      }
      if (u.islandStair || u.islandEntry) tier = 0;
      else if (u.islandRole || u.islandAccess) tier = 2;
      else if (u.islandRoad) tier = 1;
      else {
        g.computeBoundingBox();
        const b = g.boundingBox;
        if (Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) < 10) tier = 0;
      }
      items.push({ geo: g, tier });
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
    meshes.push(...buildOuterLOD(scene, items, mat, { cell: 700, name, levels: ISLAND_LOD }));
    if (gilt.length) meshes.push(...buildOuterLOD(scene, gilt, createGiltMaterial(pal, seed), { cell: 700, name: `${name} gilt`, levels: ISLAND_LOD }));
  };
  oc.islands.forEach((c, i) => {
    const parts = [];
    const obstacles=[];
    // Thalassa, Anchorage and Orison (islands/): their cores reserve their own ground
    const island = ISLAND_CITY_BUILDERS[c.id], reserve = island ? islandCityReserve(c) : null;
    if(reserve)obstacles.push(...reserve.obstacles);
    else if(c.id==='thalassa'){const s=summit(c);obstacles.push({x:s.x,z:s.z,r:180});}
    if(c.id==='austral')obstacles.push({x:c.coast.x-c.d[0]*950,z:c.coast.z-c.d[1]*950,r:300});
    if(c.id==='vesper')obstacles.push({x:c.coast.x-c.d[0]*520,z:c.coast.z-c.d[1]*520,r:125});
    if(!island&&c.id==='anchorage')for(const sign of [-1,1])obstacles.push({x:c.coast.x-c.d[0]*420+c.side[0]*sign*95,z:c.coast.z-c.d[1]*420+c.side[1]*sign*95,r:60});
    const plan=buildIslandPlan(reserve?.gate?{...c,gate:reserve.gate}:c,obstacles), city={...c,plan};
    if(island){const placed=island(parts,city,mulberry32(2026 + i * 17),lights);cityTrees.push(...placed.trees);citySignals.push(...placed.signals);for(const k of placed.keepout)SKYLINE_KEEPOUT.push(k);countryside(parts,city,mulberry32(3026 + i * 17),lights,placed.placed,{thalassa:70,anchorage:90,orison:60}[c.id]*3);}
    else builders[c.style](parts, city, mulberry32(2026 + i * 17), lights);
    const footprint=FOOTPRINTS.find(f=>f.c.id===c.id);
    plan.circles.push(...footprint.placed);
    buildIslandLandscape(parts,city,plan,lights,SKYLINE_KEEPOUT);
    for(const g of parts){const road=g.userData.islandClearance;if(road)reserveRoad(road.points,road.width);}
    // farms, villas, fields, lanes, shrines and the observatory over the rest of the island
    const cs=buildIslandCountryside(scene,city,plan,parts,{audit:audit?auditParts:null,keepouts:SKYLINE_KEEPOUT,palette:c.palette,seed:1900+i});
    meshes.push(...cs.meshes);countrysideTris+=cs.tris;COUNTRYSIDE.push(cs);plan.countryside={stats:cs.stats,records:cs.records};
    footprint.plan=plan;plans.push(plan);
    add(parts, c.palette, 900 + i, `${c.name} (island city)`, c.light);
  });
  // the island cities' harbour lights and tower beacons
  const signals = islandCitySignals(citySignals);
  if (signals) scene.add(signals);
  // the massif terrace towns live in massifTowns.js
  const mt = buildMassifTowns(scene, oc.massif, lights,{audit});
  for(const part of mt.auditParts)auditParts.push(part);
  meshes.push(...mt.meshes);
  tris += mt.tris;
  return { meshes, tris, countrysideTris, lights, cities: oc, isFree: islandCityFree, plans, auditParts, cityTrees };
}

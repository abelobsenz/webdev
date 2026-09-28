import * as THREE from 'three';
import { renderedHeight } from './outerCities.js';
import { mulberry32 } from './noise.js';

const TAU = Math.PI * 2;
export const pointSegmentDistance = (x, z, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], f = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a[0] - dx * f, z - a[1] - dz * f);
};

export function islandPolygonsOverlap(a,b){
  for(const q of [a,b])for(let i=0;i<q.length;i++){const p=q[i],r=q[(i+1)%q.length],nx=-(r[1]-p[1]),nz=r[0]-p[0],A=a.map(p=>p[0]*nx+p[1]*nz),B=b.map(p=>p[0]*nx+p[1]*nz);if(Math.max(...A)<=Math.min(...B)+.00001||Math.max(...B)<=Math.min(...A)+.00001)return false;}return true;
}

/** Footprint sampling includes all boundary edges and a regular interior grid. */
export function footprintGround(q, step = 8) {
  let min = Infinity, max = -Infinity;
  const sample = (x, z) => { const y = renderedHeight(x, z); min = Math.min(min, y); max = Math.max(max, y); };
  const cx = q.reduce((s, p) => s + p[0], 0) / q.length, cz = q.reduce((s, p) => s + p[1], 0) / q.length;
  sample(cx, cz);
  for (let k = 0; k < q.length; k++) {
    const a = q[k], b = q[(k + 1) % q.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let i = 0; i <= n; i++) {
      const x = a[0] + (b[0] - a[0]) * i / n, z = a[1] + (b[1] - a[1]) * i / n;
      const nr = Math.max(1, Math.ceil(Math.hypot(x - cx, z - cz) / (step * 1.5)));
      for (let j = 1; j <= nr; j++) sample(cx + (x - cx) * j / nr, cz + (z - cz) * j / nr);
    }
  }
  return { min, max };
}
export function circleFootprint(x, z, r, n = 32, phase = 0) {
  return Array.from({ length: n }, (_, k) => [x + Math.cos(k * TAU / n + phase) * r, z + Math.sin(k * TAU / n + phase) * r]);
}
export function rectangle(x, z, w, d, angle = 0) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([u, v]) => [x + u * c - v * s, z + u * s + v * c]);
}

/** Closed convex prism with separate face vertices for architectural shading. */
export function islandPrism(q, y0, y1, wall = 1, roof = 9) {
  const pos = [], fac = [], idx = [], n = q.length;
  const Y0 = Array.isArray(y0) ? y0 : q.map(() => y0), Y1 = Array.isArray(y1) ? y1 : q.map(() => y1);
  const area = q.reduce((s, a, i) => { const b = q[(i + 1) % n]; return s + a[0] * b[1] - b[0] * a[1]; }, 0);
  const face = (points, kind, top) => {
    const base = pos.length / 3;
    for (const p of points) { pos.push(...p); fac.push(p[0], p[1], kind); }
    for (let j = 1; j < points.length - 1; j++) {
      if (top) idx.push(base, base + j + 1, base + j); else idx.push(base, base + j, base + j + 1);
    }
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = q[i], b = q[j];
    face([[a[0], Y0[i], a[1]], [b[0], Y0[j], b[1]], [b[0], Y1[j], b[1]], [a[0], Y1[i], a[1]]], wall, area > 0);
  }
  face(q.map((p, i) => [p[0], Y1[i], p[1]]), roof, area > 0);
  face(q.map((p, i) => [p[0], Y0[i], p[1]]), wall, area < 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx); g.computeVertexNormals();
  g.userData.islandSolid = true;
  return g;
}

export function islandFoundation(parts, q, { top, kind = 9, wall = 1, name = 'foundation' } = {}) {
  const ground = footprintGround(q), y = top ?? ground.max + 0.85;
  const geo = islandPrism(q, ground.min - 2.5, y, wall, kind);
  geo.userData.islandFoundation = { q, ground, top: y, bottom: ground.min - 2.5, name };
  parts.push(geo);
  return y;
}

/** Intersect the actual Float32 triangulated ribbon top in plan. */
export function islandRoadHeight(sections,point){
  const [x,z]=point;let highest=-Infinity;
  for(let k=1;k<sections.length;k++){
    const a=sections[k-1],b=sections[k],P=[a.left,a.right,b.right,b.left].map(p=>p.map(Math.fround)),Y=[a.y,a.y,b.y,b.y].map(Math.fround);
    if(x<Math.min(...P.map(p=>p[0]))-.006||x>Math.max(...P.map(p=>p[0]))+.006||z<Math.min(...P.map(p=>p[1]))-.006||z>Math.max(...P.map(p=>p[1]))+.006)continue;
    for(const [i,j,k]of [[0,1,2],[0,2,3]]){
      const [a,b,c]=[P[i],P[j],P[k]],det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
      const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(z-c[1]))/det,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(z-c[1]))/det,w=1-u-v;
      if(Math.min(u,v,w)>=-.002)highest=Math.max(highest,u*Y[i]+v*Y[j]+w*Y[k]);
    }
  }
  return Number.isFinite(highest)?highest:undefined;
}

/** Rounded road corners keep a switchback wider than its carriageway. */
export function smoothPath(points, passes = 2) {
  let p=points;
  for(let k=0;k<passes;k++){
    const q=[p[0]];
    for(let i=0;i<p.length-1;i++){
      const a=p[i],b=p[i+1];
      q.push([a[0]*.75+b[0]*.25,a[1]*.75+b[1]*.25],[a[0]*.25+b[0]*.75,a[1]*.25+b[1]*.75]);
    }
    q.push(p.at(-1));p=q;
  }
  return p;
}

export function resamplePath(points, spacing = 12) {
  const out = [points[0]];
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1], b = points[k], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / spacing));
    for (let i = 1; i <= n; i++) out.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
  }
  return out;
}

function filletPath(points,radius){
  const out=[points[0]];
  for(let i=1;i<points.length-1;i++){
    const A=points[i-1],B=points[i],C=points[i+1],la=Math.hypot(B[0]-A[0],B[1]-A[1]),lb=Math.hypot(C[0]-B[0],C[1]-B[1]),u=[(B[0]-A[0])/la,(B[1]-A[1])/la],v=[(C[0]-B[0])/lb,(C[1]-B[1])/lb],angle=Math.acos(Math.max(-1,Math.min(1,u[0]*v[0]+u[1]*v[1]))),sign=Math.sign(u[0]*v[1]-u[1]*v[0]);
    if(angle<.03||!sign){out.push(B);continue;}
    const trim=Math.min(radius*Math.tan(angle/2),la*.45,lb*.45),R=trim/Math.tan(angle/2),T=[B[0]-u[0]*trim,B[1]-u[1]*trim],centre=[T[0]-u[1]*sign*R,T[1]+u[0]*sign*R],start=Math.atan2(T[1]-centre[1],T[0]-centre[0]),count=Math.max(2,Math.ceil(angle/.09));
    for(let k=0;k<=count;k++){const a=start+sign*angle*k/count;out.push([centre[0]+Math.cos(a)*R,centre[1]+Math.sin(a)*R]);}
  }
  out.push(points.at(-1));return out.filter((p,i)=>!i||Math.hypot(p[0]-out[i-1][0],p[1]-out[i-1][1])>.00001);
}

/** One closed road solid. Its two side rails follow the exact rendered ground. */
export function islandRoad(parts, points, width = 10, { startY, endY, startRadius = 0, endRadius = 0, kind = 9, steps = false, surveyed = false, flat = false, supports = [], surfaceFloor, keepouts, platforms = [] } = {}) {
  const length=points.slice(1).reduce((s,p,i)=>s+Math.hypot(p[0]-points[i][0],p[1]-points[i][1]),0);
  const stepSize=steps?1.2:surveyed?2:10;
  const guide=steps&&points.length>2?filletPath(points,width*1.6):points,p = resamplePath(guide, stepSize), sections = [];
  for (let i = 0; i < p.length; i++) {
    const closed = Math.hypot(p[0][0]-p.at(-1)[0],p[0][1]-p.at(-1)[1]) < .01;
    const a = p[closed && (i===0 || i===p.length-1) ? p.length-2 : Math.max(0, i - 1)], b = p[closed && (i===0 || i===p.length-1) ? 1 : Math.min(p.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / l * width / 2, nz = (b[0] - a[0]) / l * width / 2;
    const groundY=Math.max(renderedHeight(p[i][0] + nx, p[i][1] + nz), renderedHeight(p[i][0] - nx, p[i][1] - nz), renderedHeight(...p[i])) + 0.28;
    let y=groundY;
    const f = i / (p.length - 1);
    if ((steps || flat) && startY !== undefined && endY !== undefined) y = startY + (endY - startY) * f;
    else {
      if (startY !== undefined) { const w=startRadius?Math.max(0,Math.min(1,1-(Math.hypot(p[i][0]-p[0][0],p[i][1]-p[0][1])-startRadius)/90)):Math.max(0,1-Math.hypot(p[i][0]-p[0][0],p[i][1]-p[0][1])/Math.max(.01,Math.min(90,length/2)));y+=w*(startY-y); }
      if (endY !== undefined) { const w=endRadius?Math.max(0,Math.min(1,1-(Math.hypot(p[i][0]-p.at(-1)[0],p[i][1]-p.at(-1)[1])-endRadius)/90)):Math.max(0,1-Math.hypot(p[i][0]-p.at(-1)[0],p[i][1]-p.at(-1)[1])/Math.max(.01,Math.min(90,length/2)));y+=w*(endY-y); }
    }
    // Local lanes meet the full height of the civic arrival square, including lanes
    // that enter its side instead of terminating at its centre.
    if(!steps&&!flat)for(const pad of platforms){
      const r=Math.hypot(p[i][0]-pad.x,p[i][1]-pad.z),w=Math.max(0,Math.min(1,1-(r-pad.r)/45));
      y+=w*(pad.y-y);
    }
    if(!steps&&!flat)y=Math.max(y,groundY);
    const left = [p[i][0] + nx, p[i][1] + nz], right = [p[i][0] - nx, p[i][1] - nz];
    sections.push({ left, right, y, bottom: Math.min(renderedHeight(...left), renderedHeight(...right), y) - 1.4 });
    if (keepouts && i % 3 === 0) keepouts.push({ x: p[i][0], z: p[i][1], r: width / 2 + 16 });
  }
  if(steps && startY!==undefined && endY!==undefined){
    // Survey each complete tread footprint. A chord between valid endpoints can
    // otherwise disappear below an intervening hill even when both doors meet.
    const distance=[0];for(let i=1;i<p.length;i++)distance.push(distance.at(-1)+Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1]));
    const pathLength=distance.at(-1),floor=sections.map((s,i)=>startY+(endY-startY)*distance[i]/pathLength);
    for(let i=1;i<sections.length;i++){
      const a=sections[i-1],b=sections[i],q=[a.left,a.right,b.right,b.left],ground=footprintGround(q,1.5),receiving=Math.max(surfaceFloor?.(q)??-Infinity,...supports.filter(s=>islandPolygonsOverlap(q,s.q)).map(s=>s.top));
      floor[i-1]=Math.max(floor[i-1],ground.max+.12,receiving);floor[i]=Math.max(floor[i],ground.max+.12,receiving);
      a.bottom=Math.min(a.bottom,ground.min-1.4);b.bottom=Math.min(b.bottom,ground.min-1.4);
    }
    const grade=Math.max(.5,Math.abs(endY-startY)/pathLength);
    for(let i=1;i<floor.length;i++)floor[i]=Math.max(floor[i],floor[i-1]-grade*(distance[i]-distance[i-1]));
    for(let i=floor.length-2;i>=0;i--)floor[i]=Math.max(floor[i],floor[i+1]-grade*(distance[i+1]-distance[i]));
    // Receiving street and terrace datums are immutable. Their full-width caps
    // were surveyed by the public-road and plot planners before this flight.
    floor[0]=startY;floor[floor.length-1]=endY;
    const flightSections=[],flightPoints=[];let previousY=startY,maxRiser=0;
    for(let i=1;i<sections.length;i++){
      const a=sections[i-1],b=sections[i],ya=floor[i-1],yb=floor[i],count=Math.max(1,Math.ceil((Math.abs(yb-ya)-1e-7)/.26));
      const at=t=>({left:a.left.map((v,k)=>v+(b.left[k]-v)*t),right:a.right.map((v,k)=>v+(b.right[k]-v)*t),bottom:a.bottom+(b.bottom-a.bottom)*t});
      for(let j=0;j<count;j++){
        const A=at(j/count),B=at((j+1)/count),rawY=Math.max(ya+(yb-ya)*j/count,ya+(yb-ya)*(j+1)/count),y=Math.abs(rawY-previousY)<.002?previousY:rawY,from=p[i-1].map((v,k)=>v+(p[i][k]-v)*j/count),to=p[i-1].map((v,k)=>v+(p[i][k]-v)*(j+1)/count);
        if(!flightSections.length){flightSections.push({...A,y});flightPoints.push(from);}
        else if(Math.abs(previousY-y)>1e-8){flightSections.push({...A,y});flightPoints.push(from);}
        flightSections.push({...B,y});flightPoints.push(to);maxRiser=Math.max(maxRiser,Math.abs(y-previousY));previousY=y;
      }
    }
    const g=roadRibbon(flightSections,flightPoints,width,kind,points.length===2);
    g.userData.islandStair={riser:maxRiser,from:points[0],to:points.at(-1)};g.userData.islandRoad.steps=true;g.userData.islandClearance={points,width};parts.push(g);
    return flightSections;
  }
  if(surveyed)for(let i=1;i<sections.length;i++){
    const a=sections[i-1],b=sections[i],ground=footprintGround([a.left,a.right,b.right,b.left],1.5);
    a.y=Math.max(a.y,ground.max+.12);b.y=Math.max(b.y,ground.max+.12);
    a.bottom=Math.min(a.bottom,ground.min-1.4);b.bottom=Math.min(b.bottom,ground.min-1.4);
  }
  if(surveyed){if(startY!==undefined)sections[0].y=startY;if(endY!==undefined)sections.at(-1).y=endY;}
  if(surveyed){const route=walkableSections(sections,p),g=roadRibbon(route.sections,route.points,width,kind);parts.push(g);return route.sections;}
  const g=roadRibbon(sections,p,width,kind);parts.push(g);return sections;
}

function walkableSections(inputSections,inputPoints){
  const sections=[inputSections[0]],points=[inputPoints[0]];let flights=0;
    for(let i=1;i<inputSections.length;i++){const a=inputSections[i-1],b=inputSections[i],A=inputPoints[i-1],B=inputPoints[i],length=Math.hypot(B[0]-A[0],B[1]-A[1]),dy=b.y-a.y;
      const run=(edge0,edge1,point)=>Math.abs((point[0]-edge0[0])*(edge1[1]-edge0[1])-(point[1]-edge0[1])*(edge1[0]-edge0[0]))/Math.hypot(edge1[0]-edge0[0],edge1[1]-edge0[1]),surfaceRun=Math.min(run(a.left,a.right,b.right),run(b.left,b.right,a.left));
      if(Math.abs(dy)<=surfaceRun*.219+1e-8){sections.push(b);points.push(B);continue;}
      flights++;const n=Math.ceil(Math.abs(dy)/.26),at=(f,y)=>{const lerp=(a,b)=>a+(b-a)*f;sections.push({left:a.left.map((v,k)=>lerp(v,b.left[k])),right:a.right.map((v,k)=>lerp(v,b.right[k])),y,bottom:lerp(a.bottom,b.bottom)});points.push(A.map((v,k)=>lerp(v,B[k])));};
      for(let j=0;j<=n;j++){const y=a.y+dy*j/n;if(j)at((j-.5)/n,y);at(j===n?1:(j+.5)/n,y);}
    }
  return {sections,points,flights};
}

function roadRibbon(sections,p,width,kind,compactSides=false){
  if(compactSides){const bottom=Math.min(...sections.map(s=>s.bottom));for(const s of sections)s.bottom=bottom;}
  if(Math.hypot(p[0][0]-p.at(-1)[0],p[0][1]-p.at(-1)[1])<.01){const a=sections[0],b=sections.at(-1);a.bottom=b.bottom=Math.min(a.bottom,b.bottom);}
  // Continuous ribbons omit the hidden internal end faces of adjacent pieces while
  // keeping their real underside and end caps. No corridor is an open decal.
  const pos=[],fac=[],idx=[];
  const face=(input,k,out)=>{
    const P=input.filter((p,i)=>!i||Math.hypot(...p.map((v,k)=>v-input[i-1][k]))>1e-7);
    if(P.length>2&&Math.hypot(...P[0].map((v,k)=>v-P.at(-1)[k]))<1e-7)P.pop();
    if(P.length<3)return;let cross;
    for(let j=1;j<P.length-1;j++){const u=P[j].map((v,i)=>v-P[0][i]),v=P[j+1].map((v,i)=>v-P[0][i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];if(Math.hypot(...n)>1e-7){cross=n;break;}}
    if(!cross)return;const reverse=cross.reduce((s,x,i)=>s+x*out[i],0)<0,base=pos.length/3;
    for(const v of P){pos.push(...v);fac.push(v[0],v[1],k);}
    const tri=(a,b,c)=>reverse?idx.push(a,c,b):idx.push(a,b,c);
    if(P.length<=4)for(let j=1;j<P.length-1;j++)tri(base,base+j,base+j+1);
    else{
      // Side walls retain every stair-edge vertex without a redundant centre fan.
      // Strict ears preserve collinear boundary splits and therefore watertight seams.
      const axes=Math.abs(out[0])>Math.abs(out[2])?[2,1]:[0,1],Q=P.map(p=>axes.map(i=>p[i])),area=Q.reduce((s,p,i)=>s+p[0]*Q[(i+1)%Q.length][1]-p[1]*Q[(i+1)%Q.length][0],0),sign=Math.sign(area),cross=(a,b,c)=>sign*((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])),active=P.map((_,i)=>i);
      while(active.length>3){let found=false;for(let i=0;i<active.length;i++){const a=active[(i+active.length-1)%active.length],b=active[i],c=active[(i+1)%active.length];if(cross(Q[a],Q[b],Q[c])<=1e-8)continue;if(active.some(j=>j!==a&&j!==b&&j!==c&&cross(Q[a],Q[b],Q[j])>=-1e-8&&cross(Q[b],Q[c],Q[j])>=-1e-8&&cross(Q[c],Q[a],Q[j])>=-1e-8))continue;tri(base+a,base+b,base+c);active.splice(i,1);found=true;break;}if(!found)throw new Error('Road stair wall cannot be triangulated');}
      tri(...active.map(i=>base+i));
    }
  };
  const same=(i,j)=>i>=0&&j<p.length&&Math.hypot(p[i][0]-p[j][0],p[i][1]-p[j][1])<1e-7;
  for(let i=1;i<sections.length;i++){
    const a=sections[i-1],b=sections[i],P=(s,p,y)=>[s[p][0],y,s[p][1]],L=[a.left[0]-a.right[0],0,a.left[1]-a.right[1]],R=L.map(v=>-v);
    if(same(i-1,i)){
      let j=i-2,k=i+1;while(j>=0&&same(j,i))j--;while(k<p.length&&same(i,k))k++;const from=p[Math.max(0,j)],to=p[Math.min(p.length-1,k)],dy=b.y-a.y;
      face([P(a,'left',a.y),P(a,'right',a.y),P(b,'right',b.y),P(b,'left',b.y)],kind,[-dy*(to[0]-from[0]),0,-dy*(to[1]-from[1])]);continue;
    }
    face([P(a,'left',a.y),P(a,'right',a.y),P(b,'right',b.y),P(b,'left',b.y)],kind,[0,1,0]);
    if(compactSides)continue;
    face([P(a,'left',a.bottom),P(a,'right',a.bottom),P(b,'right',b.bottom),P(b,'left',b.bottom)],1,[0,-1,0]);
    const splitA=same(i-2,i-1)&&sections[i-2].y>a.bottom+1e-7&&sections[i-2].y<a.y-1e-7?sections[i-2].y:undefined;
    const splitB=same(i,i+1)&&sections[i+1].y>b.bottom+1e-7&&sections[i+1].y<b.y-1e-7?sections[i+1].y:undefined;
    for(const [side,out]of [['left',L],['right',R]])face([P(a,side,a.bottom),P(b,side,b.bottom),...(splitB===undefined?[]:[P(b,side,splitB)]),P(b,side,b.y),P(a,side,a.y),...(splitA===undefined?[]:[P(a,side,splitA)])],1,out);
  }
  if(compactSides){
    const a=sections[0],b=sections.at(-1),P=(s,k,y)=>[s[k][0],y,s[k][1]],normal=[a.left[0]-a.right[0],0,a.left[1]-a.right[1]];
    face([P(a,'left',a.bottom),P(a,'right',a.bottom),P(b,'right',b.bottom),P(b,'left',b.bottom)],1,[0,-1,0]);
    for(const [side,out]of [['left',normal],['right',normal.map(v=>-v)]])face([P(a,side,a.bottom),P(b,side,b.bottom),...sections.slice().reverse().map(s=>P(s,side,s.y))],1,out);
  }
  for(const i of (Math.hypot(p[0][0]-p.at(-1)[0],p[0][1]-p.at(-1)[1]) < .01 ? [] : [0,sections.length-1])){
    const a=sections[i],j=i===0?1:i-1,sg=i===0?-1:1,out=[(p[Math.max(1,i)][0]-p[Math.max(0,i-1)][0])*sg,0,(p[Math.max(1,i)][1]-p[Math.max(0,i-1)][1])*sg];
    face([[a.left[0],a.bottom,a.left[1]],[a.right[0],a.bottom,a.right[1]],[a.right[0],a.y,a.right[1]],[a.left[0],a.y,a.left[1]]],1,out);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('aFacade',new THREE.Float32BufferAttribute(fac,3));g.setIndex(idx);g.computeVertexNormals();
  g.userData.islandClearance={points:p,width};g.userData.islandSolid=true;g.userData.islandRoad={points:p,sections,width,kind,steps:false};
  return g;
}

/** Grade actual intersecting road ribbons into shared, founded junction surfaces. */
export function gradeIslandRoadNetwork(parts,refined=false,entries=[]){
  const roads=parts.filter(g=>g.userData.islandRoad&&(g.userData.islandRole||g.userData.islandStreet)),nodes=[],segments=[],grid=new Map(),cell=64;
  const publicFloors=new Map();
  for(const g of parts){
    if(!g.userData.islandPublicFloor&&!g.userData.islandFoundation?.name.endsWith('arrival square'))continue;
    const p=g.attributes.position,idx=g.index,f=g.attributes.aFacade,n=idx?.count??p.count;
    for(let i=0;i<n;i+=3){const ids=[0,1,2].map(k=>idx?idx.getX(i+k):i+k);if(f.getZ(ids[0])!==9)continue;const q=ids.map(k=>[p.getX(k),p.getZ(k)]),cross=(q[1][0]-q[0][0])*(q[2][1]-q[0][1])-(q[1][1]-q[0][1])*(q[2][0]-q[0][0]);if(cross>=-.00001)continue;const entry={q,y:Math.max(...ids.map(k=>p.getY(k)))};
      for(let x=Math.floor(Math.min(...q.map(p=>p[0]))/cell);x<=Math.floor(Math.max(...q.map(p=>p[0]))/cell);x++)for(let z=Math.floor(Math.min(...q.map(p=>p[1]))/cell);z<=Math.floor(Math.max(...q.map(p=>p[1]))/cell);z++){const key=x+','+z;if(!publicFloors.has(key))publicFloors.set(key,[]);publicFloors.get(key).push(entry);}
    }
  }
  const shared=new Map();
  roads.forEach((g,road)=>{const r=g.userData.islandRoad;g.userData.islandGradeNodes=[];
    r.sections.forEach((section,index)=>{const id=nodes.length;nodes.push({id,road,index,y:section.y,bottom:section.bottom});g.userData.islandGradeNodes.push(id);});
    for(let i=1;i<r.sections.length;i++){
      const a=r.sections[i-1],b=r.sections[i],q=[a.left,a.right,b.right,b.left],ground=footprintGround(q,4),ids=[g.userData.islandGradeNodes[i-1],g.userData.islandGradeNodes[i]];
      for(const id of ids){nodes[id].y=Math.max(nodes[id].y,ground.max+.28);nodes[id].bottom=Math.min(nodes[id].bottom,ground.min-1.4);}
      const receiving=new Set();for(let x=Math.floor(Math.min(...q.map(p=>p[0]))/cell);x<=Math.floor(Math.max(...q.map(p=>p[0]))/cell);x++)for(let z=Math.floor(Math.min(...q.map(p=>p[1]))/cell);z<=Math.floor(Math.max(...q.map(p=>p[1]))/cell);z++)for(const f of publicFloors.get(x+','+z)||[])receiving.add(f);
      for(const f of receiving)if(islandPolygonsOverlap(q,f.q))for(const id of ids)nodes[id].y=Math.max(nodes[id].y,f.y);
      const xs=q.map(p=>p[0]),zs=q.map(p=>p[1]),s={id:segments.length,road,index:i,q,ids,x0:Math.min(...xs),x1:Math.max(...xs),z0:Math.min(...zs),z1:Math.max(...zs)};segments.push(s);
      for(let x=Math.floor(s.x0/cell);x<=Math.floor(s.x1/cell);x++)for(let z=Math.floor(s.z0/cell);z<=Math.floor(s.z1/cell);z++){const key=x+','+z;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(s);}
    }
  });
  const parent=nodes.map(n=>n.id),root=id=>{while(parent[id]!==id){parent[id]=parent[parent[id]];id=parent[id];}return id;},join=(a,b)=>{a=root(a);b=root(b);if(a!==b)parent[a]=b;};
  roads.forEach(g=>{const r=g.userData.islandRoad;r.points.forEach((p,i)=>{const key=p.map(v=>v.toFixed(4)).join(','),id=g.userData.islandGradeNodes[i];if(shared.has(key))join(id,shared.get(key));else shared.set(key,id);});});
  const overlaps=(a,b)=>{if(a.x1<=b.x0+.0001||b.x1<=a.x0+.0001||a.z1<=b.z0+.0001||b.z1<=a.z0+.0001)return false;for(const q of[a.q,b.q])for(let i=0;i<q.length;i++){const p=q[i],r=q[(i+1)%q.length],nx=-(r[1]-p[1]),nz=r[0]-p[0],A=a.q.map(p=>p[0]*nx+p[1]*nz),B=b.q.map(p=>p[0]*nx+p[1]*nz);if(Math.max(...A)<=Math.min(...B)+.0001||Math.max(...B)<=Math.min(...A)+.0001)return false;}return true;};
  const entryGrid=new Map(),entryNodes=new Map(),entrySegments=new Set();
  entries.forEach((e,i)=>{const reach=Math.max(4,(e.width??3.8)/2+1.5);for(let x=Math.floor((e.from[0]-reach)/cell);x<=Math.floor((e.from[0]+reach)/cell);x++)for(let z=Math.floor((e.from[1]-reach)/cell);z<=Math.floor((e.from[1]+reach)/cell);z++){const key=x+','+z;if(!entryGrid.has(key))entryGrid.set(key,[]);entryGrid.get(key).push({e,i});}});
  for(const seg of segments){const r=roads[seg.road].userData.islandRoad,A=r.points[seg.index-1],B=r.points[seg.index],near=new Map();for(let x=Math.floor((seg.x0-4)/cell);x<=Math.floor((seg.x1+4)/cell);x++)for(let z=Math.floor((seg.z0-4)/cell);z<=Math.floor((seg.z1+4)/cell);z++)for(const item of entryGrid.get(x+','+z)||[])near.set(item.i,item.e);
    for(const [i,e]of near){if(pointSegmentDistance(...e.from,A,B)>Math.max(3.1,(e.width??3.8)/2+1.1))continue;entrySegments.add(seg.id);if(refined){const key=i+','+seg.road;if(!entryNodes.has(key))entryNodes.set(key,[]);entryNodes.get(key).push(...seg.ids);}}
  }
  for(const [key,ids]of entryNodes){const e=entries[Number(key.split(',')[0])],ground=footprintGround(circleFootprint(...e.from,Math.max(3.4,(e.width??3.8)/2+1.4),32),1);for(const id of ids)nodes[id].y=Math.max(nodes[id].y,ground.max+.28);for(let i=1;i<ids.length;i++)join(ids[0],ids[i]);}
  const pairs=new Set(),crossings=[];
  for(const entries of grid.values())for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
    const a=entries[i],b=entries[j];if(a.road===b.road)continue;const key=Math.min(a.id,b.id)+','+Math.max(a.id,b.id);if(pairs.has(key))continue;pairs.add(key);if(!overlaps(a,b))continue;
    const ids=[...a.ids,...b.ids];for(let k=1;k<ids.length;k++)join(ids[0],ids[k]);crossings.push([a.id,b.id]);
  }
  if(!refined){
    // Join small surviving street clusters through a surveyed clear corridor. The
    // graph comes from ribbon intersections, so a paper route cannot hide a gap.
    const roadParent=roads.map((_,i)=>i),roadRoot=i=>{while(roadParent[i]!==i){roadParent[i]=roadParent[roadParent[i]];i=roadParent[i];}return i;},byNode=new Map();
    for(const n of nodes){const key=root(n.id);if(byNode.has(key)){const a=roadRoot(n.road),b=roadRoot(byNode.get(key));if(a!==b)roadParent[a]=b;}else byNode.set(key,n.road);}
    const clusters=new Map();roads.forEach((g,i)=>{const key=roadRoot(i);if(!clusters.has(key))clusters.set(key,[]);clusters.get(key).push(g);});
    if(clusters.size>1){
      const groups=[...clusters.values()].sort((a,b)=>b.length-a.length),main=groups[0],small=groups.at(-1),unique=gs=>{const m=new Map();for(const g of gs)for(const p of g.userData.islandRoad.points)m.set(p.map(v=>v.toFixed(3)).join(','),p);return [...m.values()];},A=unique(small),B=unique(main),candidates=[];
      for(const a of A){let nearest=[];for(const b of B){const d=Math.hypot(b[0]-a[0],b[1]-a[1]);if(d<800){nearest.push({a,b,d});if(nearest.length>8){nearest.sort((a,b)=>a.d-b.d);nearest.length=4;}}}candidates.push(...nearest);}
      candidates.sort((a,b)=>a.d-b.d);
      const boxes=parts.filter(g=>g.userData.islandFoundation).map(g=>{const q=g.userData.islandFoundation.q;return{q,x0:Math.min(...q.map(p=>p[0])),x1:Math.max(...q.map(p=>p[0])),z0:Math.min(...q.map(p=>p[1])),z1:Math.max(...q.map(p=>p[1]))};});
      let chosen;
      for(const {a,b,d}of candidates){if(d<1)continue;const nx=-(b[1]-a[1])/d*3.3,nz=(b[0]-a[0])/d*3.3,q=[[a[0]+nx,a[1]+nz],[a[0]-nx,a[1]-nz],[b[0]-nx,b[1]-nz],[b[0]+nx,b[1]+nz]],box={q,x0:Math.min(...q.map(p=>p[0])),x1:Math.max(...q.map(p=>p[0])),z0:Math.min(...q.map(p=>p[1])),z1:Math.max(...q.map(p=>p[1]))};if(boxes.some(p=>overlaps(box,p)))continue;chosen=[a,b];break;}
      if(!chosen)throw new Error(`No clear island street connection for ${A[0]}`);
      islandRoad(parts,chosen,6);parts.at(-1).userData.islandRole='connection';
      return gradeIslandRoadNetwork(parts,false,entries);
    }
    const selected=new Map();for(const pair of [...crossings,...[...entrySegments].map(id=>[id])])for(const id of pair){const seg=segments[id];if(!selected.has(seg.road))selected.set(seg.road,new Set());selected.get(seg.road).add(seg.index);}
    roads.forEach((g,road)=>{const selectedSegments=selected.get(road);if(!selectedSegments)return;const r=g.userData.islandRoad,sections=[r.sections[0]],points=[r.points[0]];
      for(let i=1;i<r.sections.length;i++){const a=r.sections[i-1],b=r.sections[i],n=selectedSegments.has(i)?Math.ceil(Math.hypot(r.points[i][0]-r.points[i-1][0],r.points[i][1]-r.points[i-1][1])/2):1;
        for(let j=1;j<=n;j++){const f=j/n,lerp=(a,b)=>a+(b-a)*f;sections.push({left:a.left.map((v,k)=>lerp(v,b.left[k])),right:a.right.map((v,k)=>lerp(v,b.right[k])),y:lerp(a.y,b.y),bottom:lerp(a.bottom,b.bottom)});points.push(r.points[i-1].map((v,k)=>lerp(v,r.points[i][k])));}}
      r.sections=sections;r.points=points;});
    return gradeIslandRoadNetwork(parts,true,entries);
  }
  const levels=new Map();for(const n of nodes){const key=root(n.id);levels.set(key,Math.max(levels.get(key)??-Infinity,n.y));}
  // A minimal raising envelope limits every approach to a usable road gradient.
  // Junction nodes are one shared datum, so smoothing cannot reopen a crossing seam.
  const links=new Map(),connect=(a,b,cost)=>{if(a===b)return;if(!links.has(a))links.set(a,new Map());const m=links.get(a);m.set(b,Math.min(m.get(b)??Infinity,cost));};
  for(const g of roads){const r=g.userData.islandRoad,ids=g.userData.islandGradeNodes;for(let i=1;i<ids.length;i++){const a=root(ids[i-1]),b=root(ids[i]),length=Math.hypot(r.points[i][0]-r.points[i-1][0],r.points[i][1]-r.points[i-1][1]),cost=length*.5;connect(a,b,cost);connect(b,a,cost);}}
  const heap=[],push=(id,y)=>{const item={id,y};heap.push(item);let i=heap.length-1;while(i){const j=(i-1)>>1;if(heap[j].y>=y)break;heap[i]=heap[j];i=j;}heap[i]=item;},pop=()=>{const item=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1].y>heap[j].y)j++;if(heap[j].y<=last.y)break;heap[i]=heap[j];i=j;}heap[i]=last;}return item;};
  for(const [id,y]of levels)push(id,y);
  while(heap.length){const {id,y}=pop();if(y<levels.get(id)-1e-8)continue;for(const [other,cost]of links.get(id)||[]){const h=y-cost;if(h>levels.get(other)+1e-8){levels.set(other,h);push(other,h);}}}
  const groups=new Map();for(const n of nodes){const key=root(n.id);n.y=levels.get(key);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(n.id);}
  for(const g of roads){const data=g.userData,r=data.islandRoad;let raised=0;
    r.sections.forEach((section,i)=>{const n=nodes[data.islandGradeNodes[i]];raised=Math.max(raised,n.y-section.y);section.y=n.y;section.bottom=n.bottom;});
    // Short terrain climbs are pedestrian stairs with ordinary risers, founded
    // continuously below each tread. Flat half-treads keep both receiving ends level.
    const {sections,points,flights}=walkableSections(r.sections,r.points);
    const fresh=roadRibbon(sections,points,r.width,r.kind??9);g.copy(fresh);g.userData={...data,...fresh.userData,islandClearance:data.islandClearance,islandGraded:{maxRaise:raised,stairFlights:flights}};delete g.userData.islandGradeNodes;
  }
  return {roads:roads.length,intersectionPairs:crossings.length,junctionGroups:[...groups.values()].filter(ids=>ids.length>1).length,maxRaise:Math.max(0,...roads.map(g=>g.userData.islandGraded.maxRaise))};
}

/** The district streets are reserved before any core block or country estate is placed. */
export function islandDistrictRoads(c,s){
  const cs=Math.cos(s.angle),sn=Math.sin(s.angle),W=(u,v)=>[s.x+u*cs-v*sn,s.z+u*sn+v*cs],roads=[],line=pts=>roads.push(pts.map(p=>W(...p)));
  if(c.id==='thalassa'){
    for(const v of [-210,135,315])line([[-460,v],[0,v+18],[465,v-10]]);
    for(const u of [-395,110,410])line([[u,-210],[u,135],[u,315]]);line([[0,64],[0,153]]);
  }else if(c.id==='anchorage'){
    line([[-530,-245],[540,-245],[540,245],[-530,245],[-530,-245]]);
    for(const v of [-125,125])line([[-530,v],[540,v]]);for(const u of [-380,130,365])line([[u,-245],[u,245]]);line([[0,64],[0,125]]);
  }else if(c.id==='orison'){
    for(const r of [220,355,485]){const path=[];for(let k=0;k<=40;k++){const a=-2.25+k/40*4.5;path.push(W(Math.cos(a)*r,Math.sin(a)*r));}roads.push(path);}
    for(const a of [-2.1,0,2.1])line([[Math.cos(a)*64,Math.sin(a)*64],[Math.cos(a)*485,Math.sin(a)*485]]);
  }else if(c.id==='vesper'){
    for(const v of [-310,-165,160,340])roads.push(smoothPath([[-450,v+25],[-230,v-18],[0,v+25],[250,v-25],[450,v+40]].map(p=>W(...p))));
    for(const u of [-350,115,370])roads.push(smoothPath([[u,-345],[u-32,-50],[u+35,170],[u,380]].map(p=>W(...p))));line([[0,64],[20,184]]);
  }else{
    const connector=[];for(let k=0;k<=64;k++){const a=k/64*TAU;connector.push(W(-150+Math.cos(a)*145,Math.sin(a)*145));}roads.push(connector);
    for(let k=0;k<5;k++){const a=k*TAU/5+.12,rotate=(u,v)=>W(-150+Math.cos(a)*u-Math.sin(a)*v,Math.sin(a)*u+Math.cos(a)*v);roads.push(smoothPath([[145,0],[235,-64],[450,-54],[540,0],[450,54],[235,64],[145,0]].map(p=>rotate(...p)),2));}
  }
  return roads;
}

/** A conservative occupancy plan, shared by site builders, farming and island woods. */
export function buildIslandPlan(c, obstacles = []) {
  const rnd = mulberry32(8271 + c.island * 197), sites = [], routes = [], circles = [], start = [c.deep.x - c.d[0] * 22, c.deep.z - c.d[1] * 22];
  const W = (u, v) => [c.ix + c.d[0] * u + c.side[0] * v, c.iz + c.d[1] * u + c.side[1] * v];
  const R = c.coast.s;
  const desires = {
    thalassa:[[.5,.28],[.22,-.28],[-.1,.34],[-.39,-.3],[-.57,.19]],
    anchorage:[[.61,.3],[.58,-.36],[.28,.52],[-.04,-.56],[-.38,-.38],[-.55,.25]],
    orison:[[.46,.37],[.39,-.42],[-.05,.51],[-.34,-.38],[-.59,.08]],
    vesper:[[.57,.32],[.36,-.42],[.06,.39],[-.25,-.34],[-.53,.24]],
    austral:Array.from({length:5},(_,k)=>[Math.cos(k*TAU/5+.2)*.57,Math.sin(k*TAU/5+.2)*.57]),
  }[c.id];
  for (let k = 0; k < desires.length; k++) {
    const target = W(desires[k][0] * R, desires[k][1] * R);
    let best = null;
    for (let j = 0; j < 110; j++) {
      const a = rnd() * TAU, r = Math.sqrt(rnd()) * 660;
      const x = target[0] + Math.cos(a) * r, z = target[1] + Math.sin(a) * r;
      const h = renderedHeight(x, z), range = footprintGround(rectangle(x,z,150,150),36);
      if (range.min < 12 || range.max - range.min > 33 || sites.some(s => Math.hypot(s.x-x,s.z-z) < 980)) continue;
      const score = (range.max-range.min)*16 + r * 0.09 + Math.max(0,h-330)*0.2;
      if (!best || score < best.score) best = { x,z,y:h,score };
    }
    if (best) sites.push({ ...best, id: `${c.id}-${k}`, index:k, radius:440 + (k < 2 ? 90 : 0), angle:Math.atan2(c.d[1],c.d[0]), type:k % 3 });
  }
  const civicObstacles=sites.map(s=>({x:s.x-c.d[0]*(c.id==='austral'?150:175),z:s.z-c.d[1]*(c.id==='austral'?150:175),r:c.id==='austral'?125:c.id==='vesper'?116:105}));
  // A* on the island's height field: roads prefer gentle contours and join an existing
  // destination, so the whole landscape has a continuous route back to the ferry quay.
  const CELL=90, extent=Math.min(R*1.08,9000), N=Math.ceil(extent*2/CELL)+1, X0=c.ix-extent,Z0=c.iz-extent;
  const H=new Float32Array(N*N), G=new Float32Array(N*N), FROM=new Int32Array(N*N), seen=new Uint32Array(N*N); let stamp=0;
  for(let j=0;j<N;j++)for(let i=0;i<N;i++)H[j*N+i]=renderedHeight(X0+i*CELL,Z0+j*CELL);
  const cell=p=>Math.max(0,Math.min(N-1,Math.round((p[1]-Z0)/CELL)))*N+Math.max(0,Math.min(N-1,Math.round((p[0]-X0)/CELL)));
  const point=k=>[X0+(k%N)*CELL,Z0+Math.floor(k/N)*CELL];
  const route=(a,b)=>{
    const S=cell(a),T=cell(b),heap=[],cost=[];stamp++;
    const push=(n,cost0)=>{let i=heap.length;heap.push(n);cost.push(cost0);while(i){const p=(i-1)>>1;if(cost[p]<=cost[i])break;[heap[i],heap[p]]=[heap[p],heap[i]];[cost[i],cost[p]]=[cost[p],cost[i]];i=p;}};
    const pop=()=>{const n=heap[0],end=heap.pop(),v=cost.pop();if(heap.length){heap[0]=end;cost[0]=v;let i=0;for(;;){let m=i,l=i*2+1,r=l+1;if(l<heap.length&&cost[l]<cost[m])m=l;if(r<heap.length&&cost[r]<cost[m])m=r;if(m===i)break;[heap[i],heap[m]]=[heap[m],heap[i]];[cost[i],cost[m]]=[cost[m],cost[i]];i=m;}}return n;};
    seen[S]=stamp;G[S]=0;FROM[S]=-1;push(S,0);let found=false;
    while(heap.length){const u=pop();if(u===T){found=true;break;}const ix=u%N,iz=Math.floor(u/N);for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dz)continue;const xx=ix+dx,zz=iz+dz;if(xx<0||zz<0||xx>=N||zz>=N)continue;const v=zz*N+xx;if(H[v]<1.5&&v!==T)continue;const vp=point(v);if(obstacles.some(o=>Math.hypot(vp[0]-o.x,vp[1]-o.z)<o.r+60)||civicObstacles.some(o=>Math.hypot(vp[0]-o.x,vp[1]-o.z)<o.r+18)&&v!==T)continue;
      const dist=CELL*(dx&&dz?Math.SQRT2:1),grade=Math.abs(H[v]-H[u])/dist;
      const next=G[u]+dist*(1+grade*grade*65+Math.max(0,grade-.12)*14);
      if(seen[v]!==stamp||next<G[v]){seen[v]=stamp;G[v]=next;FROM[v]=u;const pp=point(v);push(v,next+Math.hypot(pp[0]-b[0],pp[1]-b[1])*.95);}
    }}
    if(!found)return null;const line=[];for(let u=T;u!==-1;u=FROM[u])line.push(point(u));line.reverse();line[0]=a;line[line.length-1]=b;return line;
  };
  const reached=[{x:start[0],z:start[1],id:'harbour'}];
  for(const s of sites){const parent=reached.reduce((a,b)=>Math.hypot(a.x-s.x,a.z-s.z)<Math.hypot(b.x-s.x,b.z-s.z)?a:b);const points=route([parent.x,parent.z],[s.x,s.z]);if(!points)continue;routes.push({id:s.id,from:parent.id,to:s.id,points:smoothPath(points),width:parent.id==='harbour'?16:10});reached.push(s);}
  const active=sites.filter(s=>reached.includes(s));
  const localStreets=active.flatMap(s=>islandDistrictRoads(c,s).map(points=>({points,width:c.id==='anchorage'?11:7})));
  const isRoadFree=(x,z,r=0)=>![...routes,...localStreets].some(route=>route.points.slice(1).some((p,i)=>pointSegmentDistance(x,z,route.points[i],p)<r+route.width/2+8));
  const free=(x,z,r=0)=>!circles.some(p=>Math.hypot(p.x-x,p.z-z)<p.r+r)&&isRoadFree(x,z,r);
  return {city:c.id,sites:active,routes,localStreets,circles,start,free,isRoadFree,W,civicObstacles,reserved:[...civicObstacles,...active.map(s=>({x:s.x,z:s.z,r:64}))],coreEntrances:[]};
}

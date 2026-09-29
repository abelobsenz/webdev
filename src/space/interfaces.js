import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { buildCourier, sphere } from '../craft/craftClasses.js';
import { placeMerge } from './craftMesh.js';
import { LAMP } from './lamps.js';
import { DK } from './craftMesh.js';
import { PK, bakeOcclusion, rectDist } from './portMaterial.js';

const V=(x,y,z)=>new THREE.Vector3(x,y,z),TO_Y=new THREE.Matrix4().makeRotationX(-Math.PI/2),TAU=Math.PI*2;
// While the Harbour terrace is built its rooms take the port finishes (portMaterial.js: stone,
// glasshouse, planted beds); the lunar court keeps the plain craft kinds its material draws.
let PORT=false;

// All dimensions here are ordinary metres: doors, waiting rooms and pressure walks,
// sitting on the much larger kilometre-scale structures around them.
function door(B,x,y,z,w=6,h=7,dir=1) {
  B.box(x-w/2-.45,y+h/2+.1,z,.8,h+.2,.9,CK.BRONZE);
  B.box(x+w/2+.45,y+h/2+.1,z,.8,h+.2,.9,CK.BRONZE);
  B.box(x,y+h+.35,z,w+1.7,.7,.9,CK.BRONZE);
  B.box(x,y+h/2,z+dir*.12,w,h,.35,CK.GLASS);
  B.box(x,y+.12,z+dir*.6,w+2,.24,2,CK.HULL);
}
function sideDoor(B,x,y,z,dir=1) {
  B.at(x,y,z,0,Math.PI/2,0);door(B,0,0,0,6,7,dir);B.pop();
}
function hall(B,x,y,z,w,d,h,{garden=false,plinth=PORT?PK.STONE:CK.HULL,rooms=null}={}) {
  // a stone plinth with a sill proud of the paving, the vault seated on it
  B.box(x,y-.8+(plinth===PK.STONE?0:.14),z,w+3,1.6,d+3,plinth);
  if(plinth===PK.STONE)B.box(x,y+.12,z,w+3.6,.24,d+3.6,PK.STONE);
  if(rooms)rooms.push({x,z,w:w+3.6,d:d+3.6,h});
  const pts=[[-w/2,0],[w/2,0],[w/2,h*.55]];
  for(let k=1;k<=12;k++){const a=k/12*Math.PI;pts.push([Math.cos(a)*w/2,h*.55+Math.sin(a)*h*.45]);}
  B.at(x,y,z);
  const kind=garden?(PORT?PK.GLASSHOUSE:CK.CONSERVATORY):CK.GLASS;
  B.loft([{z:-d/2,pts},{z:d/2,pts}],kind,{capStart:kind,capEnd:kind});
  const bays=Math.max(6,Math.ceil(d/18));
  for(let k=0;k<=bays;k++) {
    const zz=-d/2+d*k/bays;
    B.tube(pts.slice(2).map(([xx,yy])=>V(xx,yy,zz)),.55,6,CK.BRONZE);
  }
  for(const xx of [-w/2,w/2])B.tube([V(xx,h*.55,-d/2),V(xx,h*.55,d/2)],.65,8,CK.HULL);
  B.pop();
  for(const sd of [-1,1])door(B,x,y,z+sd*d/2,6,7,sd);
}
function planter(B,x,y,z,w=6,d=6) {
  if(!PORT) {
    B.box(x,y+.55,z,w,1.1,d,CK.BRONZE);
    B.box(x,y+1.08,z,w-.5,.24,d-.5,CK.GARDEN);
    B.tube([V(x,y+1.1,z),V(x,y+4.6,z)],.23,7,CK.DARK);
    B.at(x,y+4.8,z,0,0,0,1);sphere(B,2.3,CK.GARDEN,10,8);B.pop();
    return;
  }
  // a stone planter with a bronze lip, a shrub bed and a small multi-stem tree
  B.box(x,y+.55,z,w,1.1,d,PK.STONE);
  B.box(x,y+1.13,z,w+.2,.1,d+.2,CK.BRONZE);
  B.box(x,y+1.3,z,w-.6,.5,d-.6,PK.BEDS);
  for(let k=0;k<3;k++) {
    const a=k*2.1+x*.13,top=V(x+Math.cos(a)*.9,y+4.3+.3*k,z+Math.sin(a)*.9);
    B.tube([V(x+Math.cos(a)*.2,y+1.3,z+Math.sin(a)*.2),top],.12,5,CK.DARK);
    B.at(top.x,top.y+.9,top.z,0,a,0,1);sphere(B,1.5+.25*k,PK.BEDS,8,6);B.pop();
  }
}
function floorSlab(B,x,y,z,w,h,d) {
  const pts=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]];
  B.at(x,y,z);B.push(TO_Y);
  B.loft([{z:-h/2,pts},{z:h/2,pts}],CK.HULL,{capStart:CK.DARK,capEnd:CK.DECK});
  B.pop();B.pop();
}
function bench(B,x,y,z,ry=0) {
  B.at(x,y,z,0,ry,0);
  B.box(0,.52,0,3.6,.24,.9,CK.HULL);
  B.box(0,1.05,-.39,3.6,.9,.18,CK.BRONZE);
  for(const xx of [-1.35,1.35])B.box(xx,.22,0,.25,.45,.68,CK.DARK);
  B.pop();
}
function serviceBot(B,x,y,z) {
  B.at(x,y,z);
  for(const xx of [-.65,.65])B.box(xx,.35,0,.32,.7,1.2,CK.DARK);
  B.box(0,1.05,0,1.4,1.2,1,CK.HULL);B.box(0,1.4,.53,.85,.24,.16,CK.CONDUIT);
  B.tube([V(-.55,1.5,0),V(-1,1.05,.3)],.14,6,CK.BRONZE);
  B.pop();
}
function closedWalk(B,pts,r=7) {
  // Broad fillets keep the inner wall from folding over at a sharp elbow. Frequent
  // straight sections confine frame changes to that elbow instead of the whole hall.
  const rounded=[pts[0]];
  for(let k=1;k<pts.length-1;k++) {
    const p=pts[k],before=p.clone().sub(pts[k-1]),after=pts[k+1].clone().sub(p);
    const d=Math.min(r*2,before.length()*.45,after.length()*.45);
    const a=p.clone().addScaledVector(before.normalize(),-d),b=p.clone().addScaledVector(after.normalize(),d);
    rounded.push(a);
    for(let j=1;j<=8;j++){const t=j/8;rounded.push(a.clone().multiplyScalar((1-t)**2).addScaledVector(p,2*(1-t)*t).addScaledVector(b,t*t));}
  }
  rounded.push(pts[pts.length-1]);
  const sections=[rounded[0]];
  for(let k=1;k<rounded.length;k++) {
    const n=Math.max(1,Math.ceil(rounded[k-1].distanceTo(rounded[k])/8));
    for(let j=1;j<=n;j++)sections.push(rounded[k-1].clone().lerp(rounded[k],j/n));
  }
  B.tube(sections,r,12,CK.GLASS);
  for(let k=0;k<pts.length-1;k++) {
    const a=pts[k],b=pts[k+1],n=Math.max(1,Math.floor(a.distanceTo(b)/12));
    const direction=b.clone().sub(a).normalize(),q=new THREE.Quaternion().setFromUnitVectors(V(0,0,1),direction);
    for(let j=0;j<n;j++) {
      const p=a.clone().lerp(b,j/n);
      B.push(new THREE.Matrix4().compose(p,q,V(1,1,1)));B.torus(r+.08,.24,20,6,CK.BRONZE);B.pop();
    }
  }
}
function parkedCourier(B,x,floor,z) {
  const ship=buildCourier(44),g=ship.geo;g.computeBoundingBox();
  const matrix=new THREE.Matrix4().compose(V(x,floor+1.5-g.boundingBox.min.y,z),new THREE.Quaternion().setFromAxisAngle(V(0,1,0),Math.PI/2),V(1,1,1));
  const probe=new THREE.Mesh(g,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));probe.updateMatrixWorld();
  const feet=[];
  for(const [xx,zz] of [[-2.5,-7],[2.5,-7],[0,9]]) {
    const ray=new THREE.Raycaster(V(xx,-100,zz),V(0,1,0));const hit=ray.intersectObject(probe,false)[0];
    if(!hit)throw new Error('Courier landing strut missed its hull');
    const anchor=hit.point.clone().applyMatrix4(matrix),foot=anchor.clone().setY(floor+.16);
    B.tube([anchor.clone().add(V(0,.12,0)),foot],.24,8,CK.BRONZE);
    B.box(foot.x,floor+.1,foot.z,1.35,.2,1.6,CK.DARK);
    feet.push({anchor,foot});
  }
  probe.material.dispose();return {geo:g,matrix,feet};
}


// ------------------------------------------------------------ terrace landscape --
/**
 * A paved sheet of deck, closed: a regular grid on top (so the baked contact shade has vertices
 * to live on), a skirt t deep round its subdivided edge and a fan beneath.
 */
function deckPatch(B,x0,x1,z0,z1,y,cell,kind,t=.3) {
  const nx=Math.max(1,Math.round((x1-x0)/cell)),nz=Math.max(1,Math.round((z1-z0)/cell)),base=B.pos.length/3,up=V(0,1,0);
  for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){const x=x0+(x1-x0)*i/nx,z=z0+(z1-z0)*j/nz;B.v(x,y,z,x,z,kind);}
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++) {
    const a=base+j*(nx+1)+i,b=a+1,c=a+nx+1,d=c+1;
    B.tri(a,b,d,up);B.tri(a,d,c,up);
  }
  // the edge ring (top grid indices) walked round once, its skirt and the fan under it
  const ring=[];
  for(let i=0;i<nx;i++)ring.push([i,0]);
  for(let j=0;j<nz;j++)ring.push([nx,j]);
  for(let i=nx;i>0;i--)ring.push([i,nz]);
  for(let j=nz;j>0;j--)ring.push([0,j]);
  const cx=(x0+x1)/2,cz=(z0+z1)/2,low=[];
  for(const [i,j] of ring){const x=x0+(x1-x0)*i/nx,z=z0+(z1-z0)*j/nz;low.push(B.v(x,y-t,z,x+z,y-t,CK.DARK));}
  const hub=B.v(cx,y-t,cz,cx,cz,CK.DARK),down=V(0,-1,0);
  for(let k=0;k<ring.length;k++) {
    const k2=(k+1)%ring.length,[i0,j0]=ring[k],[i1,j1]=ring[k2];
    const a=base+j0*(nx+1)+i0,b=base+j1*(nx+1)+i1,out=V((i0+i1)/2-nx/2,0,(j0+j1)/2-nz/2);
    const o=Math.abs(out.x)/nx>Math.abs(out.z)/nz?V(Math.sign(out.x),0,0):V(0,0,Math.sign(out.z));
    B.tri(a,b,low[k2],o);B.tri(a,low[k2],low[k],o);
    B.tri(hub,low[k],low[k2],down);
  }
}
/** A kerbed stone frame of four low walls round a plan rectangle (inside w x d). */
function kerb(B,x,y,z,w,d,t,h,k) {
  for(const s of [-1,1]) {
    B.box(x,y+h/2,z+s*(d/2+t/2),w+2*t,h,t,k);
    B.box(x+s*(w/2+t/2),y+h/2,z,t,h,d+2*t-.2,k);   // (run into the long walls' ends: no shared edges)
  }
}
/** A reflecting pool: stone coping, still water a hand below it, jets of light along its floor. */
function pool(B,x,y,z,w,d,lamps) {
  kerb(B,x,y,z,w,d,1.4,.75,PK.STONE);
  B.box(x,y+.25,z,w,.5,d,PK.WATER);
  for(let k=0;k<3;k++)lamps.push({p:V(x-w/2+w*(k+.5)/3,y+.62,z),r:.55,color:LAMP.TEAL,i:.9,breathe:.2,phase:k/3});
}
/** A lawn parterre: mown grass raised in a stone kerb, a shrub border at its ends. */
function lawn(B,x,y,z,w,d) {
  kerb(B,x,y,z,w,d,.8,.55,PK.STONE);
  B.box(x,y+.22,z,w,.44,d,PK.LAWN);
  for(const s of [-1,1])B.box(x,y+.9,z+s*(d/2-2.6),w-3,1.5,3.6,PK.BEDS);
}
/** A street tree in a grated pit: a leaning trunk and a crown of three overlapping masses. */
function tree(B,x,y,z,s,seed) {
  const h=(8+3.5*((seed*.618)%1))*s,lean=((seed*.37)%1-.5)*1.2*s,a=seed*2.4;
  B.box(x,y+.06,z,3.2*s,.12,3.2*s,CK.DARK);
  const top=V(x+Math.cos(a)*lean,y+h*.72,z+Math.sin(a)*lean);
  B.tube([V(x,y,z),V(x,y+h*.4,z),top],.34*s,6,CK.DARK);
  for(let c=0;c<3;c++) {
    const ca=a+c*2.1,r=(2.6+.8*((seed*(c+1)*.29)%1))*s;
    B.at(top.x+Math.cos(ca)*1.4*s,top.y+(c?.4:1.6)*s+r*.5,top.z+Math.sin(ca)*1.4*s,0,ca,0,1);
    sphere(B,r,PK.BEDS,9,6);B.pop();
  }
  return top;
}
/** A lamp standard: a slim bronze post and a lantern head over the paving. */
function lampPost(B,x,y,z,lamps) {
  B.box(x,y+.15,z,.9,.3,.9,PK.STONE);
  B.tube([V(x,y,z),V(x,y+6.2,z)],.13,6,CK.BRONZE);
  B.box(x,y+6.55,z,.7,.7,.7,CK.LANTERN);B.box(x,y+7,z,1,.14,1,CK.BRONZE);
  lamps.push({p:V(x,y+6.55,z),r:.55,color:LAMP.AMBER,i:1.4});
}
/**
 * An ETFE canopy over the concourse: a cushion roof on branching bronze columns, lit from
 * beneath. Columns stand clear of the glazed walk it shelters.
 */
function canopy(B,x0,x1,y,zHalf,h,lamps) {
  const cx=(x0+x1)/2,L=x1-x0;
  B.box(cx,y+h,0,L,.7,zHalf*2,PK.CANOPY);
  for(const s of [-1,1])B.box(cx,y+h-.55,s*zHalf,L+1,1.1,1.1,CK.BRONZE);
  const n=Math.max(2,Math.round(L/24));
  for(let i=0;i<=n;i++) {
    const x=x0+L*i/n;
    for(const s of [-1,1]) {
      const z=s*(zHalf-2),fork=V(x,y+h*.62,z);
      B.box(x,y+.3,z,2.2,.6,2.2,PK.STONE);
      B.tube([V(x,y,z),fork],.5,8,CK.BRONZE);
      // the branches spring from inside the column head (their own start caps, never a shared one)
      for(const [dx,dz] of [[-5,0],[5,0],[0,-s*5]]){const end=V(x+dx,y+h-.35,z+dz);B.tube([fork.clone().lerp(end,.04),end],.24,6,CK.BRONZE);}
      if(i%2===0)lamps.push({p:V(x,y+h-1.3,z-s*4),r:.8,color:LAMP.WHITE,i:1.2,dir:V(0,-1,0)});
    }
  }
}

/** Concord embarkation terrace. Local +X runs along the pier; +Z is away from the liner. */
export function buildEmbarkationTerrace() {
  PORT=true;
  try { return embarkationTerrace(); } finally { PORT=false; }
}
function embarkationTerrace() {
  const B=new CB(),lamps=[],passengerPaths=[],gardens=[],attachmentJoints=[],rooms=[],walks=[],trees=[];
  const floor=11;
  // The deck: 22 m of stone-faced slab, its long faces a lit gallery of public rooms looking out
  // over the ring; granite paving on top (a grid, so the baked contact shade has vertices to
  // sit on) and a band of non-slip service plate along the railed maintenance rims.
  {
    const pts=[[-500,-240],[500,-240],[500,240],[-500,240]];
    B.at(0,0,0);B.push(TO_Y);B.loft([{z:-11,pts},{z:10.8,pts}],PK.STONE,{capStart:CK.DARK,capEnd:CK.DARK});B.pop();B.pop();
    deckPatch(B,-500,500,-221.95,221.95,floor,5,PK.PAVING);
    for(const s of [-1,1])deckPatch(B,-500,500,s<0?-240:222,s<0?-222:240,floor,5,CK.DECK);
    for(const s of [-1,1]) {
      B.box(0,-1.5,s*240.25,968,9,.5,DK.CONCOURSE);
      B.box(0,3.6,s*240.45,972,1.2,.9,CK.BRONZE);B.box(0,-6.6,s*240.45,972,1.2,.9,CK.BRONZE);
      B.box(s*500.25,-1.5,0,.5,9,448,DK.CONCOURSE);
      B.box(0,10.1,s*240.3,1000,1.8,.6,PK.STONE);   // coping under the rim railing
    }
  }
  // Twin edge girders, a lower keel and six supports physically seat this deck on arm 4.
  for(const z of [-225,225])B.box(0,-15,z,990,30,18,CK.BRONZE);
  B.box(0,-22,0,980,32,32,CK.DARK);
  const supports=[];
  for(const x of [-420,0,420])for(const z of [-195,195]) {
    const root=V(x+Math.sign(z)*25,-190,-320),end=V(x,-10,z);
    B.tube([root,end],15,10,CK.HULL);supports.push({root,end,radius:15});
  }
  // An inhabited lift core rises out of the old gallery, with two separate enclosed walks.
  B.at(0,-190,-320);B.push(TO_Y);
  B.lathe([[22,0,CK.HULL],[24,18,CK.BRONZE],[21,200,CK.GLASS],[26,212,CK.BRONZE],[0,222,CK.HULL]],24);B.pop();B.pop();
  closedWalk(B,[V(0,17,-320),V(0,17,-101)],7);
  B.box(0,8.995,-287.45,20,4,95.1,CK.HULL);
  passengerPaths.push({min:V(-2,11.1,-291),max:V(2,14,-155)});
  hall(B,0,floor,-85,92,75,24,{rooms});
  // The longitudinal concourse is kept straight; garden rooms branch to either side.
  closedWalk(B,[V(-348,17,0),V(385,17,0),V(385,17,-58)],7);
  closedWalk(B,[V(0,17,-54),V(0,17,67)],7);
  passengerPaths.push({min:V(-2,11.1,-40),max:V(2,14,-9)});
  for(const x of [-230,230]) {
    hall(B,x,floor,0,72,56,26,{rooms});
    for(const sd of [-1,1])sideDoor(B,x+sd*36,floor,0,sd);
    hall(B,x,floor,135,116,106,44,{garden:true,rooms});
    closedWalk(B,[V(x,17,26),V(x,17,84)],7);
    passengerPaths.push({min:V(x-2,11.1,36),max:V(x+2,14,74)});
    for(const dx of [-32,32])for(const zz of [112,152]){planter(B,x+dx,floor,zz);bench(B,x+dx,floor,zz-8);}
    for(const dx of [-27,27]){B.box(x+dx,floor+1.1,0,12,2.2,6,CK.BRONZE);B.box(x+dx,floor+2.3,0,10,.2,5,CK.GARDEN);}
    lamps.push({p:V(x,34,32),r:1.2,color:LAMP.AMBER,i:1.3});
  }
  passengerPaths.push({min:V(-179,11.1,-2),max:V(-50,14,2)},{min:V(50,11.1,-2),max:V(179,14,2)});
  // Three arrival-side garden courts and a long conservatory make a deliberate
  // sequence of rooms around the straight concourse, each with its own planted order.
  for(const [x,z,w,d,h] of [[-410,10,130,360,48],[-230,-150,170,104,42],[230,-150,225,104,42],[0,135,150,140,50]]) {
    hall(B,x,floor,z,w,d,h,{garden:true,rooms});
    const plants=[];
    for(const dx of [-w*.27,w*.27])for(let j=0;j<Math.max(2,Math.floor(d/40));j++) {
      const zz=z-d*.34+j*d*.68/(Math.max(2,Math.floor(d/40))-1);
      planter(B,x+dx,floor,zz,9,7);bench(B,x+dx,floor,zz-10);plants.push(V(x+dx,floor,zz));
    }
    gardens.push({center:V(x,floor,z),w,d,h,plants});
  }
  sideDoor(B,-345,floor,0,1);
  for(const x of [-230,230])closedWalk(B,[V(x,17,-26),V(x,17,-100)],7);
  passengerPaths.push({min:V(-336,11.1,-2),max:V(-275,14,2)},{min:V(-232,11.1,-91),max:V(-228,14,-36)},{min:V(228,11.1,-91),max:V(232,14,-36)},{min:V(-2,11.1,10),max:V(2,14,56)});
  // A small courier and its surveyed landing gear show how large the berth really is.
  B.box(365,floor+.2,120,146,.4,120,CK.DARK);
  for(const dx of [-58,58])B.box(365+dx,floor+.47,120,1.2,.15,96,CK.BRONZE);
  const courier=parkedCourier(B,365,floor+.4,120);
  hall(B,385,floor,-80,60,45,19,{rooms});
  passengerPaths.push({min:V(309,11.1,-2),max:V(377,14,2)},{min:V(383,11.1,-49),max:V(387,14,-9)});
  // Baggage and courier servicing stay on the eastern margin, outside the gardens.
  for(const z of [-170,-135,-100]) {B.box(455,floor+2.8,z,16,5.6,10,CK.HULL);B.box(455,floor+5.7,z,17,.25,11,CK.BRONZE);}
  for(const x of [441,473])B.tube([V(x,floor+.3,-193),V(x,floor+.3,55)],.32,8,CK.BRONZE);
  B.box(456,floor+1.3,-35,22,2.6,34,CK.DARK);B.box(456,floor+4.5,-35,16,3.8,22,CK.HULL);
  const baggageBraces=[];
  for(const x of [434,481])for(const z of [-61,-9]) {
    const legStart=B.idx.length;B.box(x,floor+9,z,1.8,18,2.4,CK.HULL);
    const root=V(x,floor+2,z),head=V(x+(x<450?6:-6),floor+18,z);
    attachmentJoints.push({point:root,range:[legStart,B.idx.length],label:'baggage brace foot'});
    B.tube([root,head],.36,8,CK.BRONZE);baggageBraces.push({head,z});
  }
  for(const z of [-61,-9]) {
    const headStart=B.idx.length;B.box(457.5,floor+18.4,z,51,1.6,2.6,CK.BRONZE);
    for(const brace of baggageBraces.filter(b=>b.z===z))attachmentJoints.push({point:brace.head,range:[headStart,B.idx.length],label:'baggage brace head',oldOffset:V(0,-1,0)});
  }
  for(const x of [441,474])B.box(x,floor+19,-35,2,1.2,59,CK.HULL);
  B.box(456,floor+17.7,-35,18,2,9,CK.DARK);
  for(const x of [450,462])B.tube([V(x,floor+17,-35),V(x,floor+8,-35)],.12,6,CK.BRONZE);
  // Low service sill and sectional deck bands distinguish the baggage court from gardens.
  for(const x of [428,487])B.box(x,floor+.12,-86,1.2,.24,235,CK.BRONZE);
  for(const [x,z,raise] of [[333,170,.4],[390,171,.4],[-372,-130,0]])serviceBot(B,x,floor+raise,z);
  // A protected maintenance rim, separate from the sealed passenger network.
  for(const z of [-234,234]) {
    for(const [x0,x1] of z<0?[[-490,-15],[15,490]]:[[-490,490]])B.tube([V(x0,floor+1.3,z),V(x1,floor+1.3,z)],.15,6,CK.BRONZE);
    for(let x=-480;x<=480;x+=24)if(z>0||Math.abs(x)>15)B.tube([V(x,floor,z),V(x,floor+1.4,z)],.1,6,CK.HULL);
  }
  for(const x of [-470,470])for(const z of [-215,215])lamps.push({p:V(x,floor+3,z),r:.8,color:LAMP.TEAL,i:1.5});
  // ---- the open deck between the rooms: a civic landscape, not bare plate ----
  // Where the concourse runs in the open it is sheltered by ETFE canopies on branching columns;
  // lawns lie between the concourse and the garden vaults, reflecting pools on the forecourt
  // before the liner, an avenue of trees along the northern rim and lamp standards throughout.
  const cover=[],footprints=rooms.slice();
  for(const [x0,x1] of [[-190,-42],[42,190],[-336,-272]]) {
    canopy(B,x0,x1,floor,16,24,lamps);cover.push({x:(x0+x1)/2,z:0,w:x1-x0+10,d:32,h:24});
  }
  for(const s of [-1,1]) {
    lawn(B,s*114,floor,44,118,24);footprints.push({x:s*114,z:44,w:120,d:26,h:1.4});
    for(let k=0;k<4;k++){const x=s*(95+k*22);tree(B,x,floor,64,.8,k*7+(s>0?3:11));trees.push(V(x,floor,64));footprints.push({x,z:64,w:3,d:3,h:9});}
  }
  for(const [x,z,w,d] of [[-102,-156,52,84],[84,-156,36,84]]) {
    pool(B,x,floor,z,w,d,lamps);footprints.push({x,z,w:w+2.8,d:d+2.8,h:.8});
    for(const s of [-1,1])for(let k=0;k<4;k++){const lz=z-d/2+d*(k+.5)/4;lampPost(B,x+s*(w/2+6),floor,lz,lamps);}
  }
  for(let x=-330;x<=280;x+=22) {
    if(Math.abs(x)<88)continue;
    const seed=Math.round(x*.37+500);
    tree(B,x,floor,213,1,seed);trees.push(V(x,floor,213));footprints.push({x,z:213,w:3.2,d:3.2,h:10});
    if(((x+330)/22)%2===1)lampPost(B,x+11,floor,207,lamps);
  }
  for(const [x0,x1] of [[-190,-42],[42,190]])for(let x=x0+12;x<x1;x+=24)for(const z of [-24,24])lampPost(B,x,floor,z,lamps);
  const geo=placeMerge([{geo:B.geometry(),m:new THREE.Matrix4()},{geo:courier.geo,m:courier.matrix}]);
  // Baked contact shading: walls dusky toward the deck, the paving darkened round every room,
  // planter, kerb and tree pit and under the canopies, undersides in their own shade.
  footprints.push({x:365,z:120,w:146,d:120,h:.5},{x:455,z:-135,w:17,d:80,h:6},{x:456,z:-35,w:22,d:34,h:4});
  bakeOcclusion(geo,(x,y,z,nx,ny,nz)=>{
    const h=y-floor;
    if(ny<-.6)return h<-.5?.35:.6;
    let o=0;
    for(const c of cover)if(rectDist(c,x,z)===0&&h<c.h-1)o=Math.max(o,.34);
    if(h<-.3||h>30)return o;
    if(ny<=.6)return Math.max(o,.5*Math.exp(-Math.max(h,0)/2.6));
    for(const r of footprints) {
      if(Math.abs(x-r.x)>r.w/2+12||Math.abs(z-r.z)>r.d/2+12)continue;
      const d=rectDist(r,x,z);
      o=Math.max(o,(d>0?.62:.2)*Math.exp(-d/(1.2+Math.min(r.h,24)*.18)));
    }
    return o;
  });
  const courierApproach={min:V(292,floor+60,60),max:V(438,floor+400,180)};
  return {geo,lamps,supports,passengerPaths,feet:courier.feet,courier,gardens,attachmentJoints,courierApproach,floor,radius:.63};
}

/** A inhabited local rail stop and traction workshop beside Tranquillity's orbital road. */
export function buildLunarServiceCourt() {
  const B=new CB(),lamps=[],passengerPaths=[],attachmentJoints=[],floor=23;
  floorSlab(B,0,6.5,0,920,33,620); // ten metres seated into the ring's curved structural slab
  for(const z of [-295,295])B.box(0,7,z,900,36,14,CK.BRONZE);
  // The service siding branches from the north traction spine; the main route stays clear above it.
  const siding=[];
  for(let i=0;i<=18;i++) {
    const x=-1300+i/18*2600,a=Math.min(1,Math.max(0,(Math.abs(x)-330)/850));
    const blend=a*a*(3-2*a);siding.push(V(x,25,-240-810*blend));
  }
  B.tube(siding,45,12,CK.DARK);
  for(let i=1;i<siding.length-1;i++) {
    const p=siding[i];B.box(p.x,28,p.z,45,88,110,CK.HULL);
    B.box(p.x,74,p.z,48,8,112,CK.BRONZE);
  }
  // Protected passenger platform, carried on piers rather than suspended above the deck.
  B.box(0,85,-155,740,10,80,CK.HULL);
  for(const x of [-330,-220,-110,0,110,220,330]) {
    B.box(x,52,-155,12,66,64,CK.HULL);
    B.box(x,20,-155,38,6,76,CK.BRONZE);
  }
  B.box(0,90.1,-188,730,.4,2.4,CK.CONDUIT);
  B.box(0,90.1,-119,730,.4,2.4,CK.BRONZE);
  // The barrel vault spans the platform's 62 m width, carried along its 704 m length.
  B.at(0,0,-155,0,Math.PI/2,0);hall(B,0,90,0,62,704,24);B.pop();
  // A three-car service train is physically captured by its magnetic shoes on the siding.
  for(const cx of [-68,0,68]) {
    B.box(cx,79,-240,55,20,15,CK.DARK);
    B.at(cx,88,-240,0,Math.PI/2,0);
    const section=[];for(let k=0;k<20;k++){const a=k/20*TAU;section.push([Math.sign(Math.cos(a))*Math.pow(Math.abs(Math.cos(a)),.56)*6.5,6+Math.sign(Math.sin(a))*Math.pow(Math.abs(Math.sin(a)),.56)*6]);}
    B.loft([{z:-31,pts:section},{z:31,pts:section}],i=>i<10?CK.GLASS:CK.HULL,{capStart:CK.BRONZE,capEnd:CK.BRONZE});B.pop();
    B.box(cx,101,-240,35,3,5,CK.PANEL);
    door(B,cx,90,-233.5,4,4,1);
    closedWalk(B,[V(cx,92,-235),V(cx,92,-185)],3);
    B.box(cx,89.7,-215.95,4,.6,42.1,CK.HULL);
    door(B,cx,90,-186,4,4,-1);
    passengerPaths.push({min:V(cx-1,90.1,-223),max:V(cx+1,93,-201)});
    lamps.push({p:V(cx+28,98,-233),r:.65,color:LAMP.TEAL,i:1.3});
  }
  for(const cx of [-34,34])B.tube([V(cx-7,94,-240),V(cx+7,94,-240)],3.8,10,CK.DARK);
  // Two lifts and pressure walks connect the upper platform to the local town hall.
  hall(B,0,floor,35,160,105,35);
  hall(B,-250,floor,20,80,70,25);
  sideDoor(B,-80,floor,20,-1);sideDoor(B,-210,floor,20,1);sideDoor(B,80,floor,35,1);
  for(const x of [0,-250]) {
    B.at(x,floor,-70);B.push(TO_Y);
    B.lathe([[18,0,CK.HULL],[19,8,CK.BRONZE],[16,72,CK.GLASS],[20,78,CK.BRONZE],[0,85,CK.HULL]],24);B.pop();B.pop();
    closedWalk(B,[V(x,29,-5),V(x,29,-70)],7);
    closedWalk(B,[V(x,96,-70),V(x,96,-127)],7);
    B.box(x,88,-92.55,18,4,45.1,CK.HULL);
    door(B,x,90,-124,6,7,1);
    passengerPaths.push({min:V(x-2,23.1,-44),max:V(x+2,26,-25)},{min:V(x-2,90.1,-116),max:V(x+2,93,-96)});
  }
  closedWalk(B,[V(-250,29,20),V(-79,29,20)],7);
  passengerPaths.push({min:V(-202,23.1,18),max:V(-88,26,22)});
  for(const x of [-265,265]) {
    hall(B,x,floor,180,105,100,37,{garden:true});
    for(const dx of [-27,27])for(const zz of [155,192]){planter(B,x+dx,floor,zz);bench(B,x+dx,floor,zz-7);}
  }
  sideDoor(B,212.5,floor,180,-1);
  // The gardens join the town through distinct side walks, clear of the service landing court.
  closedWalk(B,[V(-250,29,53),V(-265,29,132)],7);
  closedWalk(B,[V(79,29,35),V(165,29,35),V(165,29,180),V(213,29,180)],7);
  for(let j=0;j<6;j++) {
    const p=V(-250,0,53).lerp(V(-265,0,132),.2+j*.12);
    passengerPaths.push({min:V(p.x-1.7,23.1,p.z-2),max:V(p.x+1.7,26,p.z+2)});
  }
  passengerPaths.push({min:V(89,23.1,33),max:V(156,26,37)},{min:V(163,23.1,44),max:V(167,26,171)},{min:V(174,23.1,178),max:V(204,26,182)});
  B.box(330,floor+.2,15,150,.4,110,CK.DARK);
  const courier=parkedCourier(B,330,floor+.4,15);
  for(const x of [245,270,295]) {B.box(x,floor+3,-89,15,6,9,CK.HULL);B.box(x,floor+6.1,-89,16,.3,10,CK.BRONZE);}
  for(const x of [240,390])serviceBot(B,x,floor,86);
  // Traction cabinets, coolant manifolds and their closed service platform.
  const workshopStart=B.idx.length;
  B.box(-375,floor+3,-30,105,6,220,CK.DARK);
  for(let k=0;k<5;k++) {
    const z=-110+k*40;B.box(-375,floor+12,z,70,14,22,CK.HULL);B.box(-375,floor+20,z,73,2,24,CK.BRONZE);
    B.tube([V(-400,floor+10,z),V(-420,floor+10,z),V(-420,floor-6,z)],1.8,8,CK.BRONZE);
  }
  B.tube([V(-420,floor-6,-115),V(-420,floor-6,60)],3,8,CK.DARK);
  // Thirty ordinary 200 mm risers connect the machinery platform to the deck.
  for(let k=0;k<30;k++)B.box(-304.8-k*.6,floor+(k+1)*.1,65,.62,(k+1)*.2,8,CK.HULL);
  for(const z of [60.8,69.2])B.tube([V(-304.5,floor+1.2,z),V(-322.6,floor+7.2,z)],.09,6,CK.BRONZE);
  const workshopRange=[workshopStart,B.idx.length];
  // A separate EVA airlock serves two exterior working courts. Passenger gardens stay
  // behind their pressure shells; the open bays contain only machines and serviced stock.
  hall(B,-125,floor,210,90,86,26);sideDoor(B,-80,floor,210,1);
  closedWalk(B,[V(-50,29,86),V(-50,29,210),V(-82,29,210)],7);
  passengerPaths.push({min:V(-52,23.1,98),max:V(-48,26,188)});
  const stockPadStart=B.idx.length;B.box(-385,floor+.13,200,112,.26,124,CK.DARK);
  const stockPadRange=[stockPadStart,B.idx.length],evaBraces=[];
  for(const x of [-430,-340])for(const z of [143,257]) {
    const legStart=B.idx.length;B.box(x,floor+17,z,2.4,34,3.2,CK.HULL);
    const root=V(x,floor+3,z),head=V(x+(x<-380?10:-10),floor+33,z);
    attachmentJoints.push({point:root,range:[legStart,B.idx.length],label:'EVA brace foot'});
    B.box(x,floor+.45,z,8,.9,10,CK.BRONZE);
    B.tube([root,head],.6,8,CK.BRONZE);evaBraces.push({head,z});
  }
  for(const z of [143,257]) {
    const headStart=B.idx.length;B.box(-385,floor+34,z,96,2.8,3.6,CK.HULL);
    for(const brace of evaBraces.filter(b=>b.z===z))attachmentJoints.push({point:brace.head,range:[headStart,B.idx.length],label:'EVA brace head',oldOffset:V(0,-1,0)});
  }
  for(const x of [-430,-340])B.box(x,floor+34,200,3.6,2.8,118,CK.HULL);
  B.box(-385,floor+33,200,91,2,9,CK.BRONZE);B.box(-385,floor+31.5,200,14,2,14,CK.DARK);
  for(const x of [-390,-380])B.tube([V(x,floor+30.5,200),V(x,floor+23,200)],.16,6,CK.BRONZE);
  const stockCradles=[];
  for(const x of [-395,-375])for(const z of [190,210]) {
    B.box(x,floor+.65,z,7,.9,7,CK.HULL);stockCradles.push(V(x,floor+1.05,z));
    attachmentJoints.push({point:V(x,floor+.23,z),range:stockPadRange,label:'guide collar cradle foot'});
  }
  const collarStart=B.idx.length;B.at(-385,floor+1,200);B.push(TO_Y);
  B.lathe([[12,0,CK.DARK],[17,0,CK.BRONZE],[17,18,CK.BRONZE],[12,18,CK.HULL]],48,0,{closedProfile:true});B.pop();B.pop();
  for(const point of stockCradles)attachmentJoints.push({point,range:[collarStart,B.idx.length],label:'guide collar cradle head'});
  // Fin calibration tables, supply carts, and clear paths between working stations.
  B.box(60,floor+.1,215,116,.2,116,CK.DARK);
  for(const z of [181,215,249]) {
    for(const x of [21,99]){B.box(x,floor+4,z,2,8,12,CK.HULL);B.box(x,floor+.3,z,6,.6,16,CK.BRONZE);}
    B.tube([V(21,floor+1,z),V(45,floor+7.9,z)],.3,8,CK.BRONZE);B.tube([V(99,floor+1,z),V(75,floor+7.9,z)],.3,8,CK.BRONZE);
    B.box(60,floor+8.2,z,83,.8,14,CK.HULL);B.box(60,floor+9.3,z,72,1.5,10,CK.RADIATOR);
    for(const x of [28,44,60,76,92])B.box(x,floor+10.1,z,.5,.2,10.5,CK.BRONZE);
  }
  for(const [x,z] of [[-367,105],[96,139]]) {
    B.box(x,floor+1,z,12,2,18,CK.DARK);B.box(x,floor+3.5,z,10,3,14,CK.HULL);serviceBot(B,x+9,floor,z);
  }
  for(const [x,z,w,d] of [[-385,200,118,130],[60,215,124,124]])for(const sd of [-1,1])B.box(x+sd*w/2,floor+.15,z,1.2,.3,d,CK.BRONZE);
  for(const x of [-440,440])for(const z of [-275,275])lamps.push({p:V(x,floor+3,z),r:.8,color:LAMP.AMBER,i:1.4});
  const geo=placeMerge([{geo:B.geometry(),m:new THREE.Matrix4()},{geo:courier.geo,m:courier.matrix}]);
  const courierApproach={min:V(255,floor+60,-40),max:V(405,floor+400,70)};
  return {geo,lamps,passengerPaths,feet:courier.feet,courier,siding,floor,workshopRange,attachmentJoints,courierApproach,radius:1.8};
}

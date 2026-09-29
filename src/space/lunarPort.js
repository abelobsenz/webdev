import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { LAMP } from './lamps.js';
import { placeMerge } from './craftMesh.js';
import { LK } from './lunarMaterial.js';

const V=(x,y,z)=>new THREE.Vector3(x,y,z), TAU=Math.PI*2;

/** Tranquillity Exchange: lunar ring customs, gardens and the Selene material line. Metres. */
export function buildLunarPort({receiving=true}={}) {
  const B=new CB(), toY=new THREE.Matrix4().makeRotationX(-Math.PI/2), lamps=[];
  B.push(toY);
  B.lathe([[1350,-900,CK.DARK],[1500,-650,CK.HULL],[1550,-160,CK.BRONZE],[1480,0,CK.HULL],[1200,350,CK.GLASS],[1080,850,CK.GLASS],[1200,960,CK.BRONZE],[1000,1220,CK.ROOF],[550,1720,CK.ROOF],[0,1950,CK.BRONZE]],48);
  B.pop();
  // The six commons share a structural ring and enclosed radial galleries.
  B.push(new THREE.Matrix4().makeTranslation(0,1080,0).multiply(new THREE.Matrix4().makeRotationX(Math.PI/2)));
  B.torus(3600,300,120,16,CK.HULL);B.pop();
  B.push(new THREE.Matrix4().makeTranslation(0,1240,0).multiply(new THREE.Matrix4().makeRotationX(Math.PI/2)));
  B.torus(3700,170,120,12,CK.GLASS);B.pop();
  for(let k=0;k<30;k++) {
    const a=k/30*TAU,pts=[];
    for(let j=0;j<=12;j++) {const t=j/12*TAU;pts.push(V(Math.cos(a)*(3600+310*Math.cos(t)),1080+310*Math.sin(t),Math.sin(a)*(3600+310*Math.cos(t))));}
    B.tube(pts,24,6,CK.BRONZE);
  }
  for(let k=0;k<16;k++) {
    const a=k/16*TAU,d=V(Math.cos(a),0,Math.sin(a));
    B.tube([[1500,0],[1210,350],[1090,850],[1000,1220],[550,1720],[150,1870]].map(([r,y])=>d.clone().multiplyScalar(r).setY(y)),32,6,CK.BRONZE);
  }
  for(let k=0;k<6;k++) {
    const a=k/6*TAU,d=V(Math.cos(a),0,Math.sin(a));
    B.tube([d.clone().multiplyScalar(1050).setY(1080),d.clone().multiplyScalar(3580).setY(1080)],115,12,CK.HULL);
    B.tube([d.clone().multiplyScalar(3600).setY(-100),d.clone().multiplyScalar(3600).setY(1080)],110,10,CK.BRONZE);
    B.at(d.x*3600,1080,d.z*3600,0,-a,0);
    // (the commons' halls in lit stone storeys under a walled roof garden, not blank hull)
    B.box(0,-250,0,850,220,650,LK.STONE);
    B.box(0,-115,0,650,45,450,LK.ROOFG);
    B.pop();
    lamps.push({p:d.clone().multiplyScalar(3600).setY(1480),r:22,color:LAMP.AMBER,i:1.8});
  }
  // Lantern galleries: a lit promenade along the crown of every radial gallery, and a lit
  // walk round the commons ring above its glazed hall, so the Exchange reads at night.
  for(let k=0;k<6;k++) {
    const a=k/6*TAU,d=V(Math.cos(a),0,Math.sin(a));
    B.tube([d.clone().multiplyScalar(1200).setY(1080+135),d.clone().multiplyScalar(3420).setY(1080+135)],32,8,CK.LANTERN);
    for(let j=0;j<4;j++)lamps.push({p:d.clone().multiplyScalar(1500+j*620).setY(1080+150),r:14,color:LAMP.AMBER,i:1.6,breathe:.25,phase:(k+j)/10});
  }
  // (a lit belt round the commons ring's outer equator, clear of the glazed hall above it)
  B.push(new THREE.Matrix4().makeTranslation(0,1080,0).multiply(new THREE.Matrix4().makeRotationX(Math.PI/2)));
  B.torus(3915,40,160,8,CK.LANTERN);B.pop();
  for(let k=0;k<24;k++){const a=(k+.5)/24*TAU;lamps.push({p:V(Math.cos(a)*3600,1080+380,Math.sin(a)*3600),r:16,color:LAMP.WHITE,i:1.4});}
  // Through concourse along the orbital ring, with mounted passenger halls and shelters.
  for(const sd of [-1,1]) {
    B.tube([V(sd*1300,-120,0),V(sd*6800,-120,0)],260,14,CK.HULL);
    // its lit promenade: a lantern strip along the crown, lamps at the passenger halls' doors
    B.tube([V(sd*1350,-120+260+30,0),V(sd*6750,-120+260+30,0)],42,8,CK.LANTERN);
    for(let x=1700;x<6800;x+=700)for(const zz of [-280,280])lamps.push({p:V(sd*x,-120,zz),r:12,color:LAMP.AMBER,i:1.5,breathe:.2,phase:x/7000});
    for(let j=0;j<3;j++) {
      const x=sd*(4400+j*900);
      B.box(x,20,0,740,240,1150,LK.STONE);
      B.at(x,120,0);B.push(toY);
      B.lathe([[500,0,CK.BRONZE],[500,90,CK.GLASS],[370,350,CK.ROOF],[0,450,CK.ROOF]],24);B.pop();B.pop();
    }
    // Outboard cargo piers pass beneath the ring's full closed 280 m service slab.
    B.tube([V(0,-700,sd*850),V(0,-1050,sd*4200),V(0,-1050,sd*9300)],160,12,CK.HULL);
    B.tube([V(-1700,-1050,sd*7800),V(1700,-1050,sd*7800)],90,8,CK.HULL);
    for(const x of [-1700,1700]) {
      B.box(x,-1050,sd*7800,1500,220,2400,CK.HULL);
      if(!receiving||sd<0)for(let j=0;j<4;j++) B.box(x,-740,sd*(7050+j*500),1050,400,350,j%2?CK.BRONZE:CK.HULL);
      B.box(x,-1650,sd*8100,2000,28,2800,CK.PANEL);
      B.tube([V(x,-1050,sd*7800),V(x,-1650,sd*7800)],75,8,CK.DARK);
    }
    B.at(0,-1050,sd*9500);B.push(toY);
    B.lathe([[480,-260,CK.HULL],[680,0,CK.GLASS],[540,380,CK.ROOF],[0,600,CK.BRONZE]],32);B.pop();B.pop();
    lamps.push({p:V(0,-350,sd*9500),r:35,color:LAMP.TEAL,i:2.2,breathe:.25});
  }
  const baseGeo=B.geometry(),court=receiving?buildReceivingCourt():null;
  const geo=court?placeMerge([{geo:baseGeo,m:new THREE.Matrix4()},...court.parts.map(p=>({geo:p.geo,m:new THREE.Matrix4()}))]):baseGeo;
  if(court)lamps.push(...court.lamps);
  return {geo,baseGeo,lamps,receiving:court,radius:11.2};
}

// Positive-z receiving court. The entire dock is stationary; its ferry can lift
// radially from flat belly seats and transfer flanges with no overhead service arm.
function buildReceivingCourt() {
  const parts=[],lamps=[],toY=new THREE.Matrix4().makeRotationX(-Math.PI/2);
  const part=(name,draw)=>{const b=new CB();draw(b);const geo=b.geometry();parts.push({name,geo});return geo;};
  const upright=(b,x,y,z,profile,n=32)=>{b.at(x,y,z);b.push(toY);b.lathe(profile,n);b.pop();b.pop();};
  const floor=-940;
  // A true cross-pier floor sits above the original pressure crossbar. Its
  // founded stanchions, edge rails and both landing overlaps remain visible.
  const crossing=[[-1110,floor],[-1100,floor],[-240,-880],[240,-880],[1100,floor],[1110,floor]];
  const crossingY=x=>Math.abs(x)<=240?-880:Math.abs(x)>=1100?floor:-880-(Math.abs(x)-240)*60/860;
  part('crew-crossing-floor',b=>{
    b.push(new THREE.Matrix4().makeBasis(V(0,0,-1),V(0,1,0),V(1,0,0)).setPosition(0,0,7800));
    b.loft(crossing.map(([x,y])=>({z:x,pts:[[-18,y-6],[18,y-6],[18,y],[-18,y]]})),CK.DECK);b.pop();
  });
  part('crew-crossing-supports',b=>{
    for(let x=-1050;x<=1050;x+=150){const top=crossingY(x)-3;b.box(x,(-974+top)/2,7800,14,top+974,18,CK.BRONZE);}
    for(const z of [7783,7817]) {
      b.tube(crossing.map(([x,y])=>V(x,y+1.6,z)),.8,6,CK.BRONZE);
      for(let x=-1040;x<=1040;x+=80){const y=crossingY(x);b.tube([V(x,y-1,z),V(x,y+1.6,z)],.65,6,CK.HULL);}
    }
  });
  for(const side of [-1,1]) {
    const x=side*1120;
    part(`crew-airlock-${side}`,b=>{
      b.box(x,-938,6900,92,4,140,CK.BRONZE);
      b.box(x,-925,6900,80,26,118,CK.HULL);
      b.box(x,-910,6900,90,6,128,CK.BRONZE);
      b.box(x,-935.7,6959,5,8.6,1.1,CK.DARK);
      b.box(x,-936.5,6959.65,3.4,7,.3,CK.GLASS);
      // A founded short pressure vestibule brings the door threshold to the
      // actual EVA floor; the larger control room remains behind it.
      b.box(x,-934.5,6980,24,11,44,CK.HULL);
      b.box(x,-928,6980,29,3,48,CK.BRONZE);
      b.box(x,-936.4,7002.3,5.5,7,.8,CK.DARK);
      b.box(x,-936.65,7002.76,3.5,6.5,.2,CK.GLASS);
      for(const dx of [-4.5,4.5])b.box(x+dx,-935.9,7003,1,8.2,2,CK.BRONZE);
      b.box(x,-931.6,7003,10,1,2,CK.BRONZE);
      b.at(x,0,0);
      b.loft([[7002.5,-939.9],[7007,-940]].map(([z,y])=>({z,pts:[[-5.5,y-.15],[5.5,y-.15],[5.5,y],[-5.5,y]]})),CK.DECK);b.pop();
      b.box(x+side*40.3,-920,6890,1.2,9,67,CK.GLASS);
      // A small protected control gallery overlooks the process court.
      b.box(x,-904,6880,68,9,70,CK.GLASS);
      b.box(x,-898.5,6880,76,3,78,CK.BRONZE);
    });
    part(`crew-lane-${side}`,b=>{
      for(const dx of [-11,11])b.box(x+dx,floor+.0075,7800,.35,.015,1640,CK.BRONZE);
      for(const z of [7110,7430,8130,8460])b.box(x,floor+.0075,z,18,.015,.55,CK.BRONZE);
      for(const z of [7060,8550]) {
        b.box(x-side*35,-937,z,6,6,8,CK.HULL);
        b.box(x-side*35,-932.55,z,6,3.1,8,CK.CONDUIT);
      }
    });
    lamps.push({p:V(x,-930.7,7003),r:.55,color:LAMP.AMBER,i:.7});
  }
  // Water drums are broad, oxygen vessels taller and more heavily insulated.
  // All four sit on load skirts; mounted bands and header pipes touch real hull.
  for(const [j,z]of [7270,8320].entries())for(const [k,x]of [-2010,-1480].entries()) {
    const oxygen=k===1,R=oxygen?170:220,H=oxygen?510:350;
    part(`${oxygen?'oxygen':'water'}-vessel-${j}`,b=>{
      upright(b,x,floor,z,[[R*.76,0,CK.BRONZE],[R*.82,30,CK.HULL],[R*.78,66,CK.HULL]],32);
      upright(b,x,floor+62,z,[[R*.78,0,CK.HULL],[R*.98,48,CK.HULL],[R,95,CK.HULL],[R,H-80,CK.HULL],[R*.85,H-28,CK.HULL],[R*.5,H,CK.BRONZE],[0,H+20,CK.BRONZE]],40);
      for(const y of [floor+147,floor+H-21]) {
        b.at(x,y,z,Math.PI/2);b.torus(R+2,9,40,8,CK.BRONZE);b.pop();
      }
      for(const dx of [-R*.64,R*.64])b.tube([V(x+dx,floor+28,z),V(x+dx,floor+102,z)],13,8,CK.DARK);
      if(oxygen) {
        const sd=j?-1:1,zz=z+sd*330;
        b.tube([V(x,floor+170,z+sd*(R-4)),V(x,floor+170,zz),V(-2260,floor+170,zz),V(-2260,-868,zz)],10,10,CK.BRONZE);
      } else b.tube([V(x-R+4,floor+170,z),V(-2340,floor+170,z),V(-2340,-904,z)],15,10,CK.HULL);
      b.box(x,floor+H+83,z,48,5,48,CK.BRONZE);
      b.tube([V(x,floor+H+72,z),V(x,floor+H+84,z)],8,8,CK.HULL);
    });
  }
  part('water-process-header',b=>{
    for(const z of [7270,8320]) {
      b.box(-2320,-937,z,120,6,180,CK.DECK);
      b.box(-2340,-905,z,58,64,72,CK.HULL);
      b.box(-2340,-870,z,66,6,82,CK.BRONZE);
    }
    b.tube([V(-2340,-906,7270),V(-2340,-906,8320)],17,12,CK.HULL);
    for(const z of [7550,8060]) {
      b.box(-2340,-918,z,70,44,72,CK.DARK);
      b.box(-2340,-892,z,82,12,82,CK.BRONZE);
    }
    // Process cooling stays beside the fluid equipment, away from the EVA lane.
    for(const z of [7570,8040]) {
      for(const x of [-2120,-1910])b.box(x,-841,z,18,198,30,CK.BRONZE);
      b.box(-2015,-760,z,244,170,15,CK.RADIATOR);
      b.box(-2015,-677,z,252,10,24,CK.BRONZE);
    }
  });
  part('oxygen-process-header',b=>{
    b.tube([V(-2260,-868,7600),V(-2260,-868,7990)],10,10,CK.BRONZE);
    for(const z of [7630,7950]) {
      b.box(-2260,-916,z,38,48,40,CK.HULL);
      b.tube([V(-2260,-900,z),V(-2260,-870,z)],12,8,CK.DARK);
      b.box(-2260,-868,z,32,24,32,CK.BRONZE);
    }
  });
  // Dock deck and triangular haunches carry the ferry beyond the process apron.
  part('ferry-dock',b=>{
    b.box(-2880,-962.5,7800,860,45,1060,CK.DECK);
    b.box(-2445,-999,7800,190,118,940,CK.HULL);
    for(const z of [7370,8230]) {
      b.tube([V(-2350,-1120,z),V(-3260,-977,z)],28,10,CK.BRONZE);
      b.tube([V(-2350,-1100,z),V(-2830,-979,z)],20,10,CK.HULL);
      b.box(-3260,-968,z,54,40,92,CK.BRONZE);
    }
    for(const z of [7284,8316])b.box(-2880,-945,z,840,18,14,CK.BRONZE);
  });
  const ferryCenter=V(-2880,0,7800),belly=-840,seatTop=belly+.05,seats=[];
  for(const dx of [-75,75])for(const dz of [-240,240]) {
    const x=ferryCenter.x+dx,z=ferryCenter.z+dz,name=`ferry-seat-${dx}-${dz}`;
    part(name,b=>{
      b.box(x,-937,z,66,6,76,CK.BRONZE);
      b.tube([V(x,-938,z),V(x,belly-2,z)],16,10,CK.HULL);
      b.box(x,seatTop-2,z,38,4,44,CK.BRONZE);
    });
    seats.push({name,point:V(x,belly,z)});
  }
  for(const dz of [-125,125])part(`transfer-coupling-${dz}`,b=>{
    const z=7800+dz,oxygen=dz>0,feedX=oxygen?-2260:-2340,feedY=oxygen?-868:-906;
    b.tube([V(feedX,feedY,z),V(-2880,feedY,z)],12,12,oxygen?CK.BRONZE:CK.HULL);
    b.tube([V(-2880,feedY-6,z),V(-2880,belly-3,z)],12,12,CK.HULL);
    b.box(-2880,feedY,z,32,32,32,CK.BRONZE);
    upright(b,-2880,belly-3,z,[[18,0,CK.BRONZE],[18,3.05,CK.BRONZE]],24);
    b.box(-2620,(floor+feedY-8)/2,z,36,feedY-8-floor,36,CK.DARK);
  });
  // A Selene fluid ferry: paired pressure drums, a continuous flat keel, engine
  // sleeves and a compact fore control tower. No exhaust burns while berthed.
  part('receiving-ferry',b=>{
    const x=-2880,z=7800;
    b.box(x,-826,z,210,28,640,CK.HULL);
    for(const dx of [-75,75]) {
      for(const dz of [-165,165])b.box(x+dx,-797,z+dz,58,42,48,CK.BRONZE);
      b.at(x+dx,-700,z);
      b.lathe([[0,-260,CK.BRONZE],[45,-252,CK.HULL],[73,-222,CK.HULL],[80,-190,CK.HULL],[80,190,CK.HULL],[73,222,CK.HULL],[45,252,CK.HULL],[0,260,CK.BRONZE]],32);
      for(const zz of [-172,172]) {b.at(0,0,zz);b.torus(81,5,32,8,CK.BRONZE);b.pop();}
      b.lathe([[40,-327,CK.BRONZE],[48,-316,CK.HULL],[30,-265,CK.HULL],[28,-235,CK.HULL],[15,-235,CK.DARK],[15,-265,CK.DARK],[30,-316,CK.DARK],[40,-327,CK.BRONZE]],24);
      b.pop();
    }
    b.box(x,-745,z+287,64,154,72,CK.HULL);
    b.box(x,-660,z+287,77,24,86,CK.GLASS);
    b.box(x,-645,z+287,84,8,94,CK.BRONZE);
    b.box(x,-807,z-220,172,18,62,CK.DARK);
    for(const dx of [-96,96])b.tube([V(x+dx,-814,z-288),V(x+Math.sign(dx)*75,-740,z-305)],6,8,CK.BRONZE);
    // Visible mating faces are flush with the keel, so every fixed transfer
    // head still separates along the same vertical plane as the cradle seats.
    for(const dz of [-125,125])upright(b,x,belly,z+dz,[[25,0,CK.BRONZE],[25,8,CK.BRONZE]],24);
    // Segmented load frame and independent aft drives give the carrier a
    // vehicle silhouette while leaving both insulated drums unobstructed.
    for(const dx of [-106,106])for(const dz of [-240,-120,0,120,240])b.box(x+dx,-824,z+dz,8,20,94,CK.BRONZE);
    for(const sd of [-1,1]) {
      const ex=x+sd*190;
      for(const dz of [-270,-310])b.tube([V(x+sd*92,-817,z+dz),V(ex,-743,z+dz)],12,10,CK.BRONZE);
      b.at(ex,-720,z);
      b.lathe([[25,-258,CK.HULL],[42,-277,CK.HULL],[45,-333,CK.DARK],[38,-367,CK.BRONZE]],28);
      b.lathe([[38,-361,CK.BRONZE],[53,-400,CK.HULL],[48,-425,CK.BRONZE],[34,-425,CK.DARK],[35,-400,CK.DARK],[24,-367,CK.DARK],[38,-361,CK.BRONZE]],28,0,{closedProfile:true});
      b.at(0,0,-300);b.torus(46,4,28,8,CK.BRONZE);b.pop();b.pop();
      for(const dz of [-175,175]) {
        b.box(x+sd*148,-700,z+dz,48,12,32,CK.BRONZE);
        b.box(x+sd*170,-680,z+dz,34,32,60,CK.HULL);
        upright(b,x+sd*170,-665,z+dz,[[8,0,CK.BRONZE],[10,10,CK.HULL],[7,14,CK.BRONZE],[4,14,CK.DARK],[4,7,CK.DARK],[6,0,CK.DARK],[8,0,CK.BRONZE]],16);
        b.box(x+sd*170,-679,z+dz+30.5,22,16,3,CK.DARK);
      }
    }
    // The carrier is uncrewed. Its forward stack houses transfer control,
    // access equipment and optical ranging heads, not a passenger bridge.
    b.box(x,-658,z+331,56,15,6,CK.DARK);
    for(const dx of [-20,20]) {
      b.at(x+dx,-658,z+335);
      b.lathe([[7,-3,CK.BRONZE],[9,2,CK.HULL],[7,7,CK.DARK]],16);b.pop();
    }
    b.tube([V(x,-642,z+287),V(x,-614,z+287)],3,8,CK.BRONZE);
    b.box(x,-612,z+287,38,6,12,CK.HULL);
    b.box(x,-612,z+294,29,3,3,CK.GLASS);
  });
  // The stock court has two receiving tracks, founded cradles and a gantry
  // carrying one restrained assay cassette. The central floor is kept legible.
  part('stock-receiving-floor',b=>{
    b.box(1695,-939.7,7830,1050,.6,1640,CK.DECK);
    for(const x of [1210,2180]) {
      b.box(x,-934,7830,34,12,1620,CK.DARK);
      b.box(x,-926,7830,12,6,1620,CK.BRONZE);
    }
    for(const z of [7040,8620])b.box(1695,-938.9,z,975,1,12,CK.BRONZE);
  });
  for(const [j,z]of [7170,8450].entries())for(const [k,x]of [1430,1770,2110].entries())part(`stock-cradle-${j}-${k}`,b=>{
    b.box(x,-933,z,260,14,290,CK.BRONZE);
    for(const zz of [-92,92]) {
      b.box(x,-899,z+zz,250,58,28,CK.HULL);
      b.box(x,-867,z+zz,266,8,40,CK.DARK);
    }
    // Standard metal extrusions rest on both saddles, not on the empty apron.
    for(const xx of [-75,0,75])for(let h=0;h<2;h++)b.box(x+xx,-838+h*48,z,56,50,246,j?CK.HULL:CK.BRONZE);
    for(const xx of [-127,127])b.box(x+xx,-852,z,12,156,275,CK.HULL);
  });
  part('stock-gantry',b=>{
    for(const x of [1210,2180]) {
      b.box(x,-908,7900,84,30,390,CK.BRONZE);
      for(const z of [7750,8050]) {
        b.box(x,-712,z,48,390,48,CK.HULL);
        b.tube([V(x,-905,z-65),V(x,-530,z+65)],13,8,CK.BRONZE);
      }
      b.box(x,-515,7900,80,30,395,CK.BRONZE);
    }
    for(const z of [7750,8050])b.box(1695,-505,z,1055,44,52,CK.HULL);
    b.box(1695,-477,7900,320,20,370,CK.BRONZE);
    b.box(1695,-504,7900,260,48,280,CK.HULL);
    for(const x of [1595,1795])for(const z of [7805,7995])b.tube([V(x,-526,z),V(x,-725,z)],4,8,CK.DARK);
    b.box(1695,-729,7900,244,12,244,CK.BRONZE);
    b.box(1695,-770,7900,210,80,210,CK.HULL);
    b.box(1695,-812,7900,226,6,226,CK.BRONZE);
    // Corner grippers and a central inspection head stay attached to the
    // handling carriage; the suspended stock cassette has a visible load path.
    for(const x of [1580,1810])for(const z of [7785,8015]) {
      b.box(x,-731,z,16,22,18,CK.HULL);
      b.box(x,-754,z,10,38,12,CK.BRONZE);
      b.box(x+(x<1695?7:-7),-774,z,23,9,18,CK.DARK);
    }
    b.box(1695,-536,7900,92,16,96,CK.BRONZE);
    b.box(1695,-549,7900,58,12,62,CK.HULL);
    for(const x of [1674,1716])b.box(x,-557,7900,18,7,28,CK.GLASS);
  });
  part('stock-assay',b=>{
    b.box(2310,-936,7630,180,8,340,CK.DECK);
    b.box(2310,-916,7520,146,40,106,CK.HULL);
    b.box(2310,-892,7520,154,8,114,CK.BRONZE);
    for(const z of [7510,7750])b.box(2310,-886,z,28,100,26,CK.BRONZE);
    b.box(2310,-836,7630,44,16,280,CK.HULL);
    b.box(2310,-858,7630,66,42,108,CK.GLASS);
  });
  const crewRoutes=[
    ...[[-1130,-1100,floor,0],[-1100,-240,floor,60/860],[-240,240,-880,0],[240,1100,-880,-60/860],[1100,1130,floor,0]].map(([x0,x1,y,grade],i)=>({name:`cross-pier-EVA-${i}`,min:V(x0,y+.03,7793),max:V(x1,y+4,7807),gradeX:grade})),
    ...[-1,1].map(side=>({name:`crew-lane-${side}`,min:V(side*1120-8,-939.97,7007),max:V(side*1120+8,-936,8580)})),
    ...[-1,1].map(side=>({name:`airlock-threshold-${side}`,min:V(side*1120-1.5,-939.9-.5/45+.03,7003),max:V(side*1120+1.5,-935.9-.5/45,7007),gradeZ:-1/45})),
  ];
  return {parts,lamps,seats,crewRoutes,releaseDistance:10000};
}

/**
 * A neighbourhood hall on the ring deck (metres; x along the ring, y up from the deck, z across
 * it, the entrance toward -z). near: a stepped podium of lit storeys with a roof-garden
 * terrace, an arcade along its front and flanks, glasshouses on the terrace, four corner
 * towers under tiled caps, a ribbed conservatory dome with a lantern cupola and a spire, and a
 * glazed portico toward the walk. far: the same masses inset a few metres (hidden inside the
 * near hall where both draw), so the whole ring keeps its halls for a sixth of the triangles.
 */
export function buildRingHall(far=false) {
  const B=new CB(), toY=new THREE.Matrix4().makeRotationX(-Math.PI/2);
  const ins=far?4:0;
  const dome=(r0,y0,seg)=>{B.at(0,y0,0);B.push(toY);B.lathe([[r0-ins,0,CK.BRONZE],[r0+30-ins,110,CK.HULL],[r0+30-ins,150,CK.LANTERN],[r0-ins,220,CK.GLASS],[r0-70-ins,460,CK.GLASS],[r0-170-ins,550,CK.BRONZE],[0,760-ins,CK.ROOF]],seg);B.pop();B.pop();};
  if(far) {
    B.box(0,30,0,1500-2*ins,80-ins,1550-2*ins,LK.STONE);
    B.box(0,100,0,1200-2*ins,60,1250-2*ins,LK.STONE);
    dome(560,130,12);
    return B.geometry();
  }
  // podium: 80 m of lit storeys, its roof a garden terrace inside a parapet
  B.box(0,30,0,1500,80,1550,LK.STONE);
  B.box(0,70.6,0,1496,1.2,1546,LK.ROOFG);
  for(const s of [-1,1]) {B.box(s*748,73,0,4,6,1558,LK.WALL);B.box(0,73,s*773,1492,6,4,LK.WALL);}
  // the arcade: a colonnade 30 m out from the podium's front and flanks under a tiled roof
  for(let x=-725;x<=725;x+=50)B.box(x,19,-790,10,58,10,LK.WALL);
  B.box(0,50.5,-790,1500,3,34,LK.TILE);
  for(const s of [-1,1]) {
    for(let z=-725;z<=725;z+=50)B.box(s*765,19,z,10,58,10,LK.WALL);
    B.box(s*765,50.5,0,34,3,1550,LK.TILE);
  }
  // upper storeys set back, their roof garden round the dome's drum
  B.box(0,100,0,1200,60,1250,LK.STONE);
  B.box(0,130.6,0,1196,1.2,1246,LK.ROOFG);
  // glasshouses along the terrace's flanks
  for(const s of [-1,1]) {
    B.box(s*672,96,0,112,50,1080,LK.CONSERVATORY);
    B.box(s*672,122,0,116,3,1084,LK.BRONZE);
  }
  // corner towers: slender, lit, under tiled pyramid caps with a lamp gallery
  for(const sx of [-1,1])for(const sz of [-1,1]) {
    const x=sx*660,z=sz*690;
    B.box(x,170,z,110,360,110,LK.STONE);
    B.box(x,352,z,122,6,122,LK.BRONZE);
    B.box(x,360,z,100,10,100,LK.LIGHT);
    B.at(x,365,z,0,Math.PI/4,0);B.push(toY);B.lathe([[80,0,LK.TILE],[0,110,LK.TILE]],4);B.pop();B.pop();
  }
  // the conservatory dome: glazed on a lit drum, sixteen bronze ribs, a lantern cupola, a spire
  dome(560,130,32);
  const prof=[[590,110],[590,150],[560,220],[490,460],[390,550],[170,690]];
  for(let k=0;k<16;k++) {
    const a=k/16*TAU,c=Math.cos(a),sn=Math.sin(a);
    B.tube(prof.map(([r,y])=>V(c*(r+6),130+y,sn*(r+6))),7,5,CK.BRONZE);
  }
  B.at(0,880,0);B.push(toY);
  B.lathe([[95,0,CK.BRONZE],[95,20,CK.GLASS],[88,95,CK.GLASS],[100,105,CK.BRONZE],[60,140,CK.ROOF],[0,170,CK.BRONZE]],16);
  B.pop();B.pop();
  B.tube([V(0,1040,0),V(0,1130,0)],5,6,CK.BRONZE);
  // the portico toward the walk: a glazed hall with a lit frieze
  B.box(0,55,-845,440,130,120,LK.STONE);
  B.box(0,121,-845,452,4,132,LK.BRONZE);
  B.box(0,55,-906,300,100,2,CK.GLASS);
  B.box(0,112,-907,330,14,3,CK.LANTERN);
  B.at(0,123,-845);B.push(toY);B.lathe([[150,0,LK.TILE],[0,60,LK.TILE]],4,Math.PI/4);B.pop();B.pop();
  return B.geometry();
}

/** Continuous edge shields, two transit rails, and regular lunar-ring neighbourhood halls. */
export function buildLunarRingDistricts(radiusKm=2117) {
  const B=new CB(), R=radiusKm*1000, districts=[], lamps=[], N=768;
  // These pressure/service rails have physical thickness and rest in the ring slab.
  for(const z of [-5200,5200]) {
    B.push(new THREE.Matrix4().makeTranslation(0,z,0).multiply(new THREE.Matrix4().makeRotationX(Math.PI/2)));
    B.torus(R+150,190,1800,8,CK.HULL);B.pop();
  }
  for(const z of [-1700,1700]) {
    B.push(new THREE.Matrix4().makeTranslation(0,z,0).multiply(new THREE.Matrix4().makeRotationX(Math.PI/2)));
    B.torus(R+25,45,1800,6,CK.BRONZE);B.pop();
  }
  // The Tranquillity exchange occupies sector zero; the next commons is 17 km away. One hall
  // each side of the rails in every other sector, instanced (a far form for the whole ring, the
  // full hall near the camera: LunarRingHalls in lunarRing.js); their matrices in the Moon
  // frame, metres, two per sector (sector j: 2(j - 1) and 2(j - 1) + 1).
  const hallMats=new Float32Array((N-1)*2*16), hallAngle=new Float32Array((N-1)*2);
  const flip=new THREE.Matrix4().makeRotationY(Math.PI), mh=new THREE.Matrix4();
  for(let j=1;j<N;j++) {
    const a=j/N*TAU,up=V(Math.cos(a),0,Math.sin(a)),west=V(-Math.sin(a),0,Math.cos(a)),north=V(0,1,0);
    const m=new THREE.Matrix4().makeBasis(west,up,north).setPosition(up.clone().multiplyScalar(R));
    for(const sd of [-1,1]) {
      const z=sd*4100,i=2*(j-1)+(sd>0?1:0);
      // (the hall's entrance toward the rails: local -z faces the centreline)
      mh.copy(m).multiply(new THREE.Matrix4().makeTranslation(0,0,z));
      if(sd<0)mh.multiply(flip);
      mh.toArray(hallMats,i*16);
      hallAngle[i]=a;
      districts.push({center:V(0,85,z).applyMatrix4(m),base:V(0,-10,z).applyMatrix4(m),sector:j});
      // the portico's lit door toward the walk, the lantern on the cupola, the towers' lamps
      // (small true radii: from the deck these are door lights and a lantern, not orbs; from
      // afar the sprite floor keeps them as points)
      lamps.push({p:V(0,70,z-sd*912).applyMatrix4(m),r:14,color:LAMP.AMBER,i:2.4,breathe:.2,phase:(j*.37)%1});
      lamps.push({p:V(0,1138,z).applyMatrix4(m),r:10,color:LAMP.WHITE,i:1.5});   // (on the spire, clear of the cupola)
    }
  }
  // parapet lamps on both edge shields and signal lamps along both transit rails, one set per
  // half sector (8.7 km), the rails' teal a half step out of phase with the walls' warm white
  for(let j=0;j<N*2;j++) {
    const a=(j+.5)/(N*2)*TAU,c=Math.cos(a),sn=Math.sin(a);
    for(const zz of [-5200,5200])lamps.push({p:V(c*(R+350),zz,sn*(R+350)),r:10,color:LAMP.WHITE,i:1.5});
    const b=(j+1)/(N*2)*TAU;
    for(const zz of [-1700,1700])lamps.push({p:V(Math.cos(b)*(R+76),zz,Math.sin(b)*(R+76)),r:7,color:LAMP.TEAL,i:1.4});
  }
  return {geo:B.geometry(),districts,lamps,hallMats,hallAngle,hallNear:buildRingHall(false),hallFar:buildRingHall(true),sectors:N};
}

/** The full halls of districts idx placed in the Moon frame (metres), merged: for probes and audits. */
export function placedHalls(data, idx) {
  const m=new THREE.Matrix4();
  return placeMerge(idx.map(i=>({geo:data.hallNear,m:m.clone().fromArray(data.hallMats,i*16)})));
}

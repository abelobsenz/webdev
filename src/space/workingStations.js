import * as THREE from 'three';
import { CB, CK, sectionEllipse } from '../craft/craftGeometry.js';
import { buildTug } from '../craft/craftClasses.js';
import { LAMP } from './lamps.js';
import { craftMesh, addLamps, placeMerge, placeLamps } from './craftMesh.js';
import { stationFrame } from './stations.js';
import { R_EARTH, bodyDir } from './sim.js';
import { NAURU_LON } from './fleet.js';
import { HelianthTraffic } from './helianthTraffic.js';
import { addFoundryUnload } from './foundryUnload.js';
import { HelianthDistrict } from './helianthDistrict.js';
import { FoundryYard } from './foundryYard.js';

const V=(x,y,z)=>new THREE.Vector3(x,y,z), TAU=Math.PI*2;
const TO_Y=new THREE.Matrix4().makeRotationX(-Math.PI/2);

/** Three clear receiving bays, remelting columns, stock courts and the foundry commons. */
export function buildFoundry({ supports = true } = {}) {
  const B=new CB(), lamps=[], bays=[], processPods=[], serviceRails=[], supportRanges=[];
  const support=(name,draw)=>{if(!supports)return;const start=B.idx.length;draw();supportRanges.push({name,start,count:B.idx.length-start});};
  B.tube([V(-6500,-1300,1800),V(6500,-1300,1800)],230,14,CK.HULL);
  for(const x of [-4200,0,4200]) {
    bays.push({min:V(x-1200,-900,-3200),max:V(x+1200,600,1400)});
    B.box(x,-1150,-700,3200,320,6700,CK.HULL);
    // The entire mouth and working volume stay open. Beams form a vaulted gantry.
    for(const z of [-3400,-1000,1400]) {
      B.tube([V(x-1450,-1000,z),V(x-1450,500,z),V(x-700,1300,z),V(x+700,1300,z),V(x+1450,500,z),V(x+1450,-1000,z)],90,8,CK.BRONZE);
      lamps.push({p:V(x-1470,450,z),r:15,color:LAMP.TEAL,i:1.8},{p:V(x+1470,450,z),r:15,color:LAMP.TEAL,i:1.8});
    }
    for(const dx of [-1450,1450]) B.tube([V(x+dx,450,-3400),V(x+dx,450,1600)],65,8,CK.HULL);
    for(const dx of [-600,600]) B.tube([V(x+dx,-950,-3700),V(x+dx,-950,1700)],28,6,CK.LANTERN);
    // Low founded saddles meet the actual hexagonal guide undersides. Their
    // heads stay beneath the receiving volume, with long open spans between.
    for(const dx of [-600,600])for(let j=0;j<6;j++)support(`guide-seat-${x+dx}-${j}`,()=>{
      const z=-3500+j*1000;
      B.box(x+dx,-984,z,78,12.1,74,CK.BRONZE);
      B.box(x+dx,-975,z,32,12,46,CK.DARK);
    });
    // Recessed keel plates and approach markings keep the floor legible at kilometre scale.
    for(let j=0;j<6;j++) {
      const z=-3450+j*1000;
      B.box(x,-985,z,1750,16,800,CK.DARK);
      B.box(x,-976,z,145,10,460,CK.BRONZE);
      for(const sd of [-1,1]) {
        B.box(x+sd*1480,-570,z,140,850,360,CK.HULL);
        B.box(x+sd*1480,-215,z,185,90,400,CK.BRONZE);
        B.box(x+sd*1410,-500,z,40,190,180,CK.CONDUIT);
      }
    }
    // Two overhead rail lines carry inspection gondolas, above the reserved receiving volume.
    for(const dx of [-720,720]) {
      B.tube([V(x+dx,1130,-3400),V(x+dx,1130,1850)],80,8,CK.DARK);
      serviceRails.push({start:V(x+dx,1130,-3400),end:V(x+dx,1130,1850),radius:80});
      B.box(x+dx,890,-600,430,340,650,CK.HULL);
      B.box(x+dx,728,-600,320,32,420,CK.GLASS);
      B.box(x+dx,1090,-600,530,120,850,CK.BRONZE);
      // Railway ends meet the front and rear vaults; the moving car is on the rail.
      for(const z of [-3400,1400])B.tube([V(x+dx,1130,z),V(x+dx*.94,1300,z)],45,8,CK.BRONZE);
    }
    for(const sd of [-1,1]) {
      const sx=x+sd*1850;
      for(const z of [-2450,-650,1150]) {
        B.tube([V(x+sd*1500,-980,z),V(sx,-980,z)],90,8,CK.HULL);
        B.box(sx,-830,z,400,270,800,CK.DARK);
        B.at(sx,-730,z);B.push(TO_Y);
        B.lathe([[180,0,CK.BRONZE],[225,120,CK.HULL],[225,600,CK.HULL],[170,720,CK.BRONZE],[0,780,CK.HULL]],16);B.pop();B.pop();
        B.tube([V(sx,-490,z-260),V(sx,-200,z-260),V(sx,-200,z)],50,8,CK.BRONZE);
      }
    }
    B.at(x,-1000,2550);B.push(TO_Y);
    B.lathe([[650,0,CK.BRONZE],[700,300,CK.HULL],[680,1500,CK.HULL],[760,1650,CK.BRONZE],[620,1900,CK.GLASS],[500,2350,CK.HULL],[0,2600,CK.HULL]],32);B.pop();B.pop();
    B.tube([V(x,-500,1600),V(x,-500,2200)],180,10,CK.DARK);
    // Encapsulated reduction furnaces feed three staged process skids behind the docks.
    for(const y of [-600,150,850]) {
      B.push(new THREE.Matrix4().makeTranslation(x,y,2550).multiply(new THREE.Matrix4().makeRotationX(Math.PI/2)));
      B.torus(720,70,48,8,CK.BRONZE);B.pop();
    }
    for(let k=0;k<8;k++) {
      const a=k/8*TAU;
      B.tube([V(x+Math.cos(a)*700,-750,2550+Math.sin(a)*700),V(x+Math.cos(a)*740,600,2550+Math.sin(a)*740),V(x+Math.cos(a)*500,1350,2550+Math.sin(a)*500)],35,6,CK.DARK);
    }
    B.tube([V(x,-1300,1800),V(x,-1050,3750)],130,10,CK.HULL);
    B.tube([V(x-1000,-1050,3750),V(x+1000,-1050,3750)],130,10,CK.HULL);
    for(const dx of [-1000,0,1000]) {
      const c=V(x+dx,-520,3750);processPods.push({center:c,radius:300});
      B.box(c.x,-960,c.z,800,200,900,CK.HULL);
      B.at(c.x,-865,c.z);B.push(TO_Y);
      B.lathe([[280,0,CK.BRONZE],[340,120,CK.HULL],[340,600,CK.HULL],[300,760,CK.GLASS],[0,980,CK.BRONZE]],20);B.pop();B.pop();
      B.tube([V(x+dx*.24,-300,3150),V(c.x,-300,3370),V(c.x,-300,3750)],75,8,CK.BRONZE);
    }

  }
  // Stock courts are behind the intake line, clear of all tender approach volumes.
  for(const s of [-1,1]) {
    B.box(s*6500,-950,3500,1700,240,5000,CK.HULL);
    B.tube([V(s*4200,-1000,1800),V(s*6500,-1000,1800)],180,10,CK.HULL);
    for(let j=0;j<5;j++) B.box(s*6500,-420,1750+j*850,1250,820,620,j%2?CK.BRONZE:CK.HULL);
    for(let j=0;j<5;j++) {
      const z=1750+j*850;
      B.box(s*6500,20,z,1300,65,690,CK.BRONZE);
      for(const dx of [-510,510])B.box(s*6500+dx,-430,z,65,850,730,CK.DARK);
    }
    B.tube([V(s*6500,200,1450),V(s*6500,200,5500)],60,8,CK.BRONZE);
    for(const z of [1600,5450])B.tube([V(s*6500,-830,z),V(s*6500,200,z)],65,8,CK.DARK);

    B.tube([V(s*6500,-1000,4600),V(s*8600,-1000,4600)],85,8,CK.DARK);
    for(let j=0;j<3;j++) B.box(s*8750,-950,3350+j*1250,2700,45,1050,CK.RADIATOR);
    // A narrow underside spine carries all three leaves off the existing
    // cross-arm. Edge-on spars leave almost all of both radiating faces exposed.
    support(`radiator-spine-${s}`,()=>B.box(s*8650,-990,4600,140,100,3300,CK.BRONZE));
    for(let j=0;j<3;j++)support(`radiator-spar-${s}-${j}`,()=>B.box(s*8750,-980,3350+j*1250,2600,40,70,CK.DARK));
    for(const z of [3350,5850])support(`radiator-brace-${s}-${z}`,()=>B.tube([V(s*8500,-1050,4600),V(s*8650,-1030,z)],22,8,CK.BRONZE));
  }
  // A garden wheel and its bearings house the people who repair the machines.
  B.tube([V(0,-1300,1800),V(0,-1300,6200),V(0,500,6200)],200,12,CK.HULL);
  B.at(0,500,6200);B.push(TO_Y);
  B.lathe([[520,-250,CK.HULL],[600,0,CK.GLASS],[500,350,CK.BRONZE],[0,550,CK.ROOF]],32);B.pop();B.pop();
  B.push(new THREE.Matrix4().makeTranslation(0,500,6200).multiply(new THREE.Matrix4().makeRotationX(Math.PI/2)));
  B.torus(2000,280,100,14,CK.ROOF);B.pop();
  for(let k=0;k<6;k++) {
    const a=k/6*TAU;
    B.tube([V(Math.cos(a)*550,500,6200+Math.sin(a)*550),V(Math.cos(a)*1850,500,6200+Math.sin(a)*1850)],90,10,CK.HULL);
    lamps.push({p:V(Math.cos(a)*2300,500,6200+Math.sin(a)*2300),r:20,color:LAMP.AMBER,i:1.5});
  }
  // The work platform is carried off the Halo's north wall, not left hovering over it.
  // Station origin is 7 km above deck, 42 km north of the ring centre line.
  // The north slow-traffic lane is centred 19.84 km from the Halo axis at deck+3 km.
  // Descend under it, then climb only after crossing the lane's full operating envelope.
  const galleryPath=[V(0,-4760,-26000),V(0,-6200,-22000),V(0,-5900,-19000),V(0,-2900,-15500),V(0,-1300,-4200),V(0,-1300,1800)];
  B.tube(galleryPath,170,12,CK.HULL);
  for(const x of [-650,650]) {
    const lower=galleryPath.map((p,i)=>V(x,p.y-800*Math.sin(Math.PI*i/(galleryPath.length-1)),p.z));
    B.tube(lower,75,8,CK.BRONZE);
    for(let j=0;j<galleryPath.length-1;j++)for(let k=0;k<3;k++) {
      const t=k/3,a=galleryPath[j].clone().lerp(galleryPath[j+1],t),b=lower[j].clone().lerp(lower[j+1],t);
      a.x=Math.sign(x)*90;B.tube([a,b],45,6,CK.DARK);
    }
  }
  return {geo:B.geometry(),lamps,bays,processPods,serviceRails,supportRanges,radius:28};
}

/** Connected maintenance crown and the inhabited ring's finite-Sun shield, in metres. */
function solarService() {
  const parts=[],lamps=[],feet=[],crewRoutes=[];
  const part=(name,draw)=>{const b=new CB();draw(b);const geo=b.geometry();parts.push({name,geo});return geo;};
  // The shield lies behind the collectors, toward the inhabited ring. Its closed
  // annulus covers the Sun's 21-degree apparent disc without blanking the petals.
  part('habitat-shield',b=>{
    b.push(TO_Y);
    b.lathe([[3200,1120,CK.HULL],[5100,1030,CK.HULL],[5100,1140,CK.BRONZE],[3200,1230,CK.HULL]],192,0,{closedProfile:true});b.pop();
  });
  for(let k=0;k<12;k++) {
    const a=k/12*TAU,d=V(Math.cos(a),0,Math.sin(a));
    part(`shield-rafter-${k}`,b=>{
      b.tube([d.clone().multiplyScalar(1200).setY(1400),d.clone().multiplyScalar(3300).setY(1170)],48,10,CK.BRONZE);
      b.tube([d.clone().multiplyScalar(3230).setY(1116),d.clone().multiplyScalar(5070).setY(1035)],30,8,CK.DARK);
    });
    if(k%2===1)part(`habitat-stay-${k}`,b=>b.tube([d.clone().multiplyScalar(4100).setY(1110),d.clone().multiplyScalar(4100).setY(1850)],42,10,CK.HULL));
  }
  for(const [r,y]of[[3210,1180],[5085,1100]])part(`shield-edge-${r}`,b=>{
    b.at(0,y,0,Math.PI/2);b.torus(r,30,192,8,CK.BRONZE);b.pop();
  });
  // Seated expansion seams divide the large ceramic blanket into replaceable
  // sectors; their restrained radial rhythm follows the twelve collector petals.
  for(let k=0;k<48;k++) {
    const a=k/48*TAU,d=V(Math.cos(a),0,Math.sin(a));
    part(`shield-seam-${k}`,b=>b.tube([d.clone().multiplyScalar(3220).setY(1229.5),d.clone().multiplyScalar(5080).setY(1141.5)],6,8,CK.BRONZE));
  }
  part('shield-seam-hoop',b=>{b.at(0,1188,0,Math.PI/2);b.torus(4100,4,192,6,CK.BRONZE);b.pop();});
  // Physical hoops give the green pressure skin a readable structural rhythm.
  // They retain the existing torus dimensions and touch its true faceted surface.
  for(let k=0;k<24;k++) {
    const a=k/24*TAU,center=V(Math.cos(a)*4100,2200,Math.sin(a)*4100),tangent=V(-Math.sin(a),0,Math.cos(a));
    part(`habitat-hoop-${k}`,b=>{
      b.push(new THREE.Matrix4().compose(center,new THREE.Quaternion().setFromUnitVectors(V(0,0,1),tangent),V(1,1,1)));
      b.torus(380,7,48,8,CK.BRONZE);b.pop();
    });
  }
  for(const [r,y]of[[4480,2200],[3720,2200],[4100,2580],[4100,1820]])part(`habitat-belt-${r}-${y}`,b=>{
    b.at(0,y,0,Math.PI/2);b.torus(r,9,144,8,CK.HULL);b.pop();
  });

  part('transfer-core',b=>{
    b.push(TO_Y);
    b.lathe([[510,2670,CK.HULL],[540,2750,CK.BRONZE],[470,3190,CK.HULL],[550,3390,CK.HULL],[550,3500,CK.BRONZE],[430,3570,CK.HULL],[430,3720,CK.GLASS],[400,3780,CK.BRONZE],[170,3900,CK.HULL],[0,3940,CK.BRONZE]],64);b.pop();
  });
  for(const sd of [-1,1]) {
    const x=sd*850;
    part(`service-wing-${sd}`,b=>{
      b.at(x,3480,0);
      b.loft([[-650,120],[-550,300],[-300,410],[300,410],[600,200],[680,60]].map(([z,w])=>({z,pts:[[-w*.9,-50],[w*.9,-50],[w,15],[w*.95,50],[-w*.95,50],[-w,15]]})),CK.HULL);b.pop();
    });
    for(const z of [-300,300])part(`wing-brace-${sd}-${z}`,b=>b.tube([V(sd*250,3200,z*.65),V(sd*900,3450,z)],55,10,CK.BRONZE));
    part(`wing-edging-${sd}`,b=>{
      for(const side of [-1,1])b.tube([V(x+side*285,3500,-550),V(x+side*399,3500,-300),V(x+side*399,3500,300),V(x+side*190,3500,600),V(x+side*50,3500,675)],12,8,CK.BRONZE);
      // Crew circulation stays on the inboard side, separate from the handling courts.
      b.box(sd*620,3530,30,36,.12,520,CK.DECK);
      for(const z of [-160,-80,0,80,160,240])b.box(sd*620,3530.065,z,20,.02,3,CK.LANTERN);
    });
    part(`crew-room-${sd}`,b=>{
      b.at(sd*650,3530,-320);
      b.loft([{z:-115,pts:[[-88,-2],[88,-2],[88,44],[66,82],[-66,82],[-88,44]]},{z:115,pts:[[-88,-2],[88,-2],[88,44],[66,82],[-66,82],[-88,44]]}],(i)=>i===0||i===5?CK.HULL:CK.GLASS,{capStart:CK.HULL,capEnd:CK.GLASS});
      b.box(0,52,0,181,8,240,CK.BRONZE);
      b.box(0,74,0,125,12,242,CK.HULL);
      // A low pressure vestibule faces the exterior EVA lane; five-metre doors
      // and the small inspection windows provide scale beneath the huge collectors.
      b.box(0,10,127,28,22,30,CK.HULL);b.box(0,9,143,5,16,3,CK.BRONZE);
      b.box(0,17,144.8,4,2,1,CK.LANTERN);
      for(const dx of [-52,-30,30,52])b.box(dx,20,115.5,12,12,2,CK.GLASS);
      b.pop();
    });
    const path=[V(sd*340,3570,-120),V(sd*475,3570,-160),V(sd*580,3570,-270)];
    part(`crew-gallery-${sd}`,b=>b.tube(path,14,12,CK.HULL));
    crewRoutes.push({name:`EVA lane ${sd}`,side:sd,min:V(sd*620-12,3530.09,-150),max:V(sd*620+12,3543,240)});
    lamps.push({p:V(sd*650,3550,-173),r:2.8,color:LAMP.TEAL,i:1.8});
  }

  // One occupied tug cradle; the entire vertical departure column is kept free.
  const tug=buildTug(360),tugMatrix=new THREE.Matrix4().makeTranslation(900,3610,60),tugGeo=tug.geo.clone().applyMatrix4(tugMatrix);
  parts.push({name:'service-tug',geo:tugGeo});lamps.push(...placeLamps(tug.lamps,tugMatrix,1.8));
  part('receiving-pad',b=>{
    b.box(900,3531,60,280,4,490,CK.DARK);
    for(const x of [785,1015])for(const z of [-160,-60,40,140,240])b.box(x,3533,z,5,2,45,CK.LANTERN);
    for(const z of [-179,299])b.box(900,3533,z,180,2,5,CK.BRONZE);
  });
  const probe=new THREE.Mesh(tugGeo,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));probe.updateMatrixWorld();
  for(const [dx,dz]of[[-20,-130],[20,-130],[-25,130],[25,130]]) {
    const p=V(900+dx,3531,60+dz),hit=new THREE.Raycaster(p,V(0,1,0),0,200).intersectObject(probe,false)[0];
    if(!hit)throw new Error('Helianth cradle missed its service tug');
    const normal=hit.face.normal.clone().normalize(),knee=hit.point.clone().addScaledVector(normal,14),end=hit.point.clone().addScaledVector(normal,.8);
    feet.push({root:p.clone(),contact:hit.point.clone(),normal,end});
    part(`tug-foot-${dx}-${dz}`,b=>{
      b.box(p.x,3535,p.z,22,8,28,CK.BRONZE);b.tube([p,knee,end],5,8,CK.HULL);
      // The head and final stem follow the actual hull facet. A horizontal head
      // used to bury its edge several metres into the sloping engine casing.
      b.push(new THREE.Matrix4().compose(hit.point.clone().addScaledVector(normal,1.42),new THREE.Quaternion().setFromUnitVectors(V(0,1,0),normal.clone().negate()),V(1,1,1)));
      b.box(0,0,0,13,3,14,CK.DARK);b.pop();
    });
  }
  probe.material.dispose();tug.geo.dispose();

  part('receiving-gantry',b=>{
    for(const x of [775,1120]) {
      b.box(x,3533,-420,50,10,90,CK.BRONZE);
      b.tube([V(x,3530,-420),V(x,3760,-420)],13,8,CK.HULL);
      b.tube([V(x,3540,-380),V(x,3710,-420)],9,8,CK.BRONZE);
    }
    b.box(947.5,3756,-420,390,22,30,CK.DARK);
    b.box(1030,3740,-420,60,40,65,CK.BRONZE);
    b.tube([V(1030,3735,-420),V(1030,3660,-350)],7,8,CK.HULL);
    b.box(1030,3656,-350,130,12,35,CK.BRONZE);
  });
  part('receiver-transfer-cassette',b=>{
    b.box(1030,3550,-350,180,42,110,CK.HULL);
    for(const x of [975,1085])b.box(x,3580,-350,20,70,92,CK.BRONZE);
    b.box(1030,3620,-350,160,100,16,CK.PANEL);
    for(const x of [946,1114])b.box(x,3620,-350,12,112,28,CK.HULL);
    for(const y of [3568,3672])b.box(1030,y,-350,180,12,28,CK.BRONZE);
  });
  // The opposite wing calibrates and stores removed receiver leaves. Sloped
  // cassettes are carried by closed trestles, with a service aisle between rows.
  for(let j=0;j<3;j++) {
    const z=-80+j*210;
    part(`receiver-rack-${j}`,b=>{
      b.box(-960,3533,z,370,10,170,CK.DARK);
      for(const x of [-1090,-830]) {
        b.tube([V(x,3530,z-65),V(x,3650,z),V(x,3530,z+65)],10,8,CK.BRONZE);
        b.box(x,3610,z,28,95,100,CK.HULL);
      }
      b.at(-960,3625,z,Math.PI/8);
      b.box(0,0,0,300,10,135,CK.PANEL);
      for(const dx of [-155,155])b.box(dx,0,0,14,20,152,CK.BRONZE);
      for(const dz of [-73,73])b.box(0,0,dz,315,20,14,CK.HULL);
      b.pop();
    });
  }
  part('calibration-tower',b=>{
    b.box(-990,3534,-435,230,12,130,CK.BRONZE);
    for(const x of [-1080,-900])b.tube([V(x,3530,-435),V(x,3740,-435)],14,8,CK.HULL);
    b.box(-990,3740,-435,220,26,45,CK.BRONZE);
    b.box(-990,3680,-435,130,100,30,CK.GLASS);
    b.box(-990,3625,-435,150,16,45,CK.HULL);
    for(const z of [-470,-400])b.tube([V(-990,3530,z),V(-990,3670+(z+435)*.04,-435)],10,8,CK.DARK);
  });
  // Pipe manifolds and sealed tool lockers occupy the outer margins, never the
  // pressure-gallery exits or the reserved receiving column.
  for(const sd of [-1,1])part(`service-margin-${sd}`,b=>{
    for(const z of [-220,20,240]) {
      b.box(sd*1180,3532,z,75,8,95,CK.BRONZE);
      b.box(sd*1180,3560,z,62,62,80,CK.HULL);
      b.box(sd*1180,3591,z,68,6,84,CK.BRONZE);
    }
    b.tube([V(sd*1180,3550,-220),V(sd*1180,3550,240)],7,8,CK.BRONZE);
    for(const z of [-500,500])lamps.push({p:V(sd*1000,3550,z),r:3,color:LAMP.AMBER,i:1.8});
  });
  return {parts,lamps,feet,crewRoutes,craft:{name:'service-tug',matrix:tugMatrix},approach:{min:V(820,3690,-152),max:V(980,5500,272)}};
}

/** A single inspectable collector among the solar swarm: a twelve-petal thermal station. */
export function buildSolarCollector({service=true}={}) {
  const B=new CB(),lamps=[],petals=[],radiators=[];
  B.push(TO_Y);
  B.lathe([[1700,-320,CK.BRONZE],[1800,-120,CK.PANEL],[1650,160,CK.HULL],[1300,1400,CK.HULL],[1400,1550,CK.BRONZE],[1150,2250,CK.GLASS],[700,2900,CK.ROOF],[0,3200,CK.BRONZE]],48);B.pop();
  for(let k=0;k<12;k++) {
    const a=k/12*TAU, rings=[];
    for(let j=0;j<=24;j++) {
      const t=j/24,z=1550+12950*t,y=420*Math.sin(t*Math.PI),w=100+1450*Math.pow(Math.sin(Math.PI*t),.8);
      rings.push({z,pts:sectionEllipse(w,35,12,3).map(([x,h])=>[x,y+h])});
    }
    B.push(new THREE.Matrix4().makeRotationY(a));
    B.loft(rings,(i)=>i===0||i===6?CK.BRONZE:CK.PANEL);
    const spine=[];
    for(let j=0;j<=12;j++){const t=j/12;spine.push(V(0,460*Math.sin(Math.PI*t)+80,1500+13000*t));}
    B.tube(spine,55,8,CK.DARK);
    for(let j=1;j<8;j++) {
      const t=j/8,z=1550+12950*t,y=420*Math.sin(t*Math.PI),w=100+1450*Math.pow(Math.sin(Math.PI*t),.8);
      B.tube([V(-w,y+45,z),V(w,y+45,z)],24,6,CK.BRONZE);
    }
    B.pop();
    petals.push({angle:a,inner:1550,outer:14500,maxHalfWidth:1550});
    lamps.push({p:V(Math.sin(a)*14520,45,Math.cos(a)*14520),r:24,color:LAMP.AMBER,i:1.7});
  }
  // Habitats sit in the hub's shade, well above the collector and its service catwalks.
  const habitatStart=B.idx.length;
  B.push(new THREE.Matrix4().makeTranslation(0,2200,0).multiply(new THREE.Matrix4().makeRotationX(Math.PI/2)));
  B.torus(4100,380,144,16,service?CK.CONSERVATORY:CK.ROOF);B.pop();
  const habitatRange={start:habitatStart,count:B.idx.length-habitatStart};
  for(let k=0;k<6;k++) {
    const a=k/6*TAU,d=V(Math.cos(a),0,Math.sin(a));
    B.tube([d.clone().multiplyScalar(1200).setY(2200),d.clone().multiplyScalar(4000).setY(2200)],120,12,CK.HULL);
    B.tube([d.clone().multiplyScalar(4100).setY(2200),d.clone().multiplyScalar(7600).setY(3800)],80,8,CK.DARK);
    B.at(d.x*7900,3800,d.z*7900,0,-a,0);
    const start=B.idx.length;
    B.box(0,0,0,3000,1500,45,CK.RADIATOR);
    radiators.push({start,count:B.idx.length-start});
    B.box(0,0,0,3200,65,100,CK.BRONZE);B.pop();
  }
  const baseGeo=B.geometry(),details=service?solarService():null;
  const geo=details?placeMerge([{geo:baseGeo,m:new THREE.Matrix4()},...details.parts.map(p=>({geo:p.geo,m:new THREE.Matrix4()}))]):baseGeo;
  if(details)lamps.push(...details.lamps);
  return {geo,baseGeo,lamps,petals,radiators,habitatRange,service:details,radius:15.5};
}

export class WorkingStations {
  constructor(space) {
    this.space=space;
    this.foundryData=buildFoundry();
    this.foundry=new THREE.Group();
    const up=bodyDir(0,NAURU_LON+.009);
    this.foundry.position.copy(up).multiplyScalar(R_EARTH+627).add(V(0,42,0));
    // +Z north, +X west, exactly the Halo's fixed local coordinates.
    stationFrame(up,this.foundry.quaternion);
    const f=craftMesh(this.foundryData.geo,{accent:[.5,1,.8],lit:.58});
    addLamps(f,this.foundryData.lamps,{minPx:1.2});this.foundry.add(f);
    // a tender unloading its relic in the middle hall (src/space/foundryUnload.js)
    this.unload=addFoundryUnload(this.foundry);
    space.earthFixed.add(this.foundry);
    space.addBody('foundry',[this.foundry],()=>this.foundry.getWorldPosition(new THREE.Vector3()),28,{solid:true,hint:.65});
    this.solarData=buildSolarCollector();
    this.solar=new THREE.Group();
    this.solarOffset=V(0,.025*1.496e8,.004*1.496e8);
    this.solar.quaternion.setFromUnitVectors(V(0,1,0),this.solarOffset.clone().normalize());
    const s=craftMesh(this.solarData.geo,{accent:[1,.72,.4],lit:.5,fill:.075});
    // Helianth is close to Sol, far from the Earth-centred lighting reference.
    s.userData.sunDir=this.solarOffset.clone().normalize().negate();
    addLamps(s,this.solarData.lamps,{minPx:1.2});this.solar.add(s);space.scene.add(this.solar);
    // service tugs on their petal circuits and the relay beacons (src/space/helianthTraffic.js)
    this.helianth=new HelianthTraffic(this.solar,s.userData.sunDir);
    space.addBody('solarCollector',[this.solar],()=>this.solar.getWorldPosition(new THREE.Vector3()),19.8,{solid:true,hint:.9});
    // catwalks, crawlers, crews, berths and the statite flotilla (src/space/helianthDistrict.js)
    this.district=new HelianthDistrict(this.solar,s.userData.sunDir,space,this.solarData.service?.crewRoutes||[]);
    // gantry cranes, stock traffic, furnace light and crews at the foundry (src/space/foundryYard.js)
    this.yard=new FoundryYard(this.foundry,this.foundryData);
    this._cam=new THREE.Vector3();this._fw=new THREE.Vector3();
  }
  update(sim,realTime=0,dt=0,space=this.space) {
    this.solar.position.copy(sim.sunPos).add(this.solarOffset);this.helianth.update(realTime);
    const cam=space?.camera?this._cam.copy(space.camera.position):null;
    this.district.update(realTime,cam);
    this.yard.update(realTime,cam?this.foundry.getWorldPosition(this._fw).distanceTo(cam):Infinity);
  }
}

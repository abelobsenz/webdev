import * as THREE from 'three';
import { latheFacade, loftSections, sweepTube } from './geom.js';
import { sweepLoop } from './platform.js';
import { renderedHeight } from './outerCities.js';
import { mulberry32 } from './noise.js';
import { islandPrism, islandFoundation, islandRoad, footprintGround, rectangle, circleFootprint, pointSegmentDistance, smoothPath, islandRoadHeight, gradeIslandRoadNetwork, islandDistrictRoads, islandPolygonsOverlap, someCircleNear } from './islandPlan.js';

const TAU=Math.PI*2;
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
const body=(parts,q,y,h,wall=5,roof=3)=>{const g=islandPrism(q,y-.4,y+h,wall,roof);parts.push(g);return g;};
const seated=(upper,lower,samples,name)=>{upper.userData.islandSupport={lower,samples,name};return upper;};
const ring=(parts,x,z,r,w,y,h,kind=1,n=48)=>parts.push(latheFacade([{r:r-w,y,kind},{r,y,kind},{r,y:y+h,kind},{r:r-w,y:y+h,kind}],n,{closedProfile:true}).translate(x,0,z));
function dome(parts,x,z,r,y,h,wall=5,roof=1,n=24){
  const p=[{r,y:y-.4,kind:wall},{r,y:y+h*.34,kind:wall},{r:r*1.035,y:y+h*.34,kind:1},{r:r*1.035,y:y+h*.39,kind:1}];
  for(let i=0;i<=7;i++){const a=i/7*Math.PI/2;p.push({r:Math.max(.08,r*Math.cos(a)),y:y+h*.39+Math.sin(a)*h*.61,kind:roof});}
  const g=latheFacade(p,n).translate(x,0,z);parts.push(g);return g;
}
function column(parts,x,z,y,h,r=1.1,kind=1){parts.push(latheFacade([{r:r*1.4,y,kind},{r:r*1.4,y:y+.6,kind},{r,y:y+.6,kind},{r:r*.86,y:y+h-.7,kind},{r:r*1.35,y:y+h-.7,kind},{r:r*1.35,y:y+h,kind}],8).translate(x,0,z));}
function obelisk(parts,x,z,y,h,r,kind=2){parts.push(latheFacade([{r:r*1.5,y,kind:1},{r:r*1.5,y:y+1.4,kind:1},{r,y:y+1.4,kind},{r:r*.62,y:y+h*.78,kind},{r:.06,y:y+h,kind}],6).translate(x,0,z));}
function arcade(parts,W,u0,v0,u1,v1,y,h=12){
  const a=W(u0,v0),b=W(u1,v1),L=Math.hypot(b[0]-a[0],b[1]-a[1]),N=Math.max(1,Math.round(L/10));
  for(let i=0;i<=N;i++){if(Math.abs(i/N-.5)*L<3.5)continue;column(parts,a[0]+(b[0]-a[0])*i/N,a[1]+(b[1]-a[1])*i/N,y,h,1.1);}
  const angle=Math.atan2(b[1]-a[1],b[0]-a[0]);body(parts,rectangle((a[0]+b[0])/2,(a[1]+b[1])/2,L+3,4.2,angle),y+h,1.5,1,1);
}
function court(parts,W,y,size=116){
  const h=size/2,t=13;
  for(const [u,v,w,d] of [[-(h+9)/2,-h+t/2,h-9,t],[(h+9)/2,-h+t/2,h-9,t],[0,h-t/2,size,t],[-h+t/2,0,t,size-2*t],[h-t/2,0,t,size-2*t]]){
    const q=[W(u-w/2,v-d/2),W(u+w/2,v-d/2),W(u+w/2,v+d/2),W(u-w/2,v+d/2)];body(parts,q,y,14,5,3);
  }
  for(const s of [-1,1])arcade(parts,W,-h+t+5,s*(h-t-5),h-t-5,s*(h-t-5),y,9);
}

/** A thematic civic destination, entirely on its own measured retaining foundation. */
function landmark(parts,c,s,record,lights){
  const angle=s.angle+Math.PI/2,cs=Math.cos(angle),sn=Math.sin(angle),x=s.x-c.d[0]*(c.id==='austral'?150:175),z=s.z-c.d[1]*(c.id==='austral'?150:175);
  const W=(u,v)=>[x+u*cs-v*sn,z+u*sn+v*cs];
  const r=c.id==='austral'?125:c.id==='vesper'?116:105;
  const q=circleFootprint(x,z,r,48),g=footprintGround(q),top=islandFoundation(parts,q,{name:`${s.id} civic plinth`,kind:9,top:c.id==='austral'?s.plazaY:undefined});
  record(x,z,r+10,'civic landmark',q,top);
  // Broad formal approach with continuous support joins the civic forecourt to its route.
  // Intersect the actual polygonal plinth edge; an endpoint inside the retaining
  // solid would hide the last treads below its paving.
  let edgeR=Infinity;for(let i=0;i<q.length;i++){const a=q[i],b=q[(i+1)%q.length],ex=b[0]-a[0],ez=b[1]-a[1],ax=a[0]-x,az=a[1]-z,det=c.d[0]*ez-c.d[1]*ex,t=(ax*ez-az*ex)/det,u=(ax*c.d[1]-az*c.d[0])/det;if(t>=0&&u>=0&&u<=1)edgeR=Math.min(edgeR,t);}
  const front=[x+c.d[0]*edgeR,z+c.d[1]*edgeR];
  // A squared stone threshold supports the full stair width at the polygonal
  // circular plinth edge; the outer tread cannot hang past the curved facade.
  const entryQ=rectangle(front[0],front[1],18,3,angle);
  islandFoundation(parts,entryQ,{top,kind:9,name:`${s.id} civic entrance threshold`});
  const entranceStart=parts.length;islandRoad(parts,[[s.x,s.z],front],14,{startY:s.plazaY,endY:top,steps:true,supports:[{q:circleFootprint(s.x,s.z,64,40),top:s.plazaY},{q:entryQ,top:top+.06}]});
  parts[entranceStart].userData.islandEntry={from:[s.x,s.z],to:front,startY:s.plazaY,endY:top,kind:'civic approach',source:'foundation'};
  if(c.id==='thalassa'){
    court(parts,W,top,132);
    const rear=W(0,40),hall=body(parts,rectangle(rear[0],rear[1],56,52,angle),top,15.2,5,1);
    seated(dome(parts,rear[0],rear[1],24,top+15.2,27,1,7,32),hall,[rear],`${s.id} academy roof`);
    const pool=W(0,-13);ring(parts,pool[0],pool[1],16,2.4,top,.8);parts.push(latheFacade([{r:13.5,y:top+.2,kind:6},{r:13.5,y:top+.48,kind:6}],36).translate(pool[0],0,pool[1]));
    for(const u of [-85,85]){const p=W(u,-4);obelisk(parts,p[0],p[1],top,24,3,2);}
  }else if(c.id==='anchorage'){
    // A working exchange hall: closed barrel envelope, service buttresses and a raised
    // central lantern. Its paired halls echo the harbour's twin tower gateway.
    for(const u of [-42,42]){
      const p=W(u,-8),sec=[];
      sec.push({y:top,pts:rectangle(p[0],p[1],65,125,angle),kind:8},{y:top+24,pts:rectangle(p[0],p[1],65,125,angle),kind:0});
      for(let j=1;j<=9;j++){const a=j/10*Math.PI/2;sec.push({y:top+24+22*Math.sin(a),pts:rectangle(p[0],p[1],Math.max(3,65*Math.cos(a)),125,angle),kind:j%3===0?1:0});}
      parts.push(loftSections(sec));
      for(let v=-50;v<=50;v+=25){const b=W(u,v);body(parts,rectangle(b[0],b[1],68,2,angle),top+21,2,1,1);}
    }
    for(const u of [-80,80]){const p=W(u,45);obelisk(parts,p[0],p[1],top,36,5,10);}
  }else if(c.id==='orison'){
    dome(parts,x,z,39,top,47,5,7,36);
    ring(parts,x,z,70,3.5,top+1,2,7);
    for(let k=0;k<12;k++){const a=k*TAU/12,p=W(Math.cos(a)*69,Math.sin(a)*69);obelisk(parts,p[0],p[1],top+3,22+(k%3)*6,2.7,2);}
    const arc=[];for(let i=0;i<=48;i++){const a=i/48*TAU;arc.push(V(x+Math.cos(a)*47,top+51,z+Math.sin(a)*47));}parts.push(sweepTube(arc,()=>1.2,8,{kind:7}));
    // Four closed supports carry the azimuth ring above the observatory shell.
    for(let k=0;k<4;k++){const a=k*Math.PI/2;column(parts,x+Math.cos(a)*47,z+Math.sin(a)*47,top,51,1.6,7);}
  }else if(c.id==='vesper'){
    // A terraced civic theatre: annular seating leaves its open arena visible.
    const aisleAngles=[-145,-90,-35,45].map(a=>angle+a*Math.PI/180).sort((a,b)=>a-b);
    for(let k=0;k<8;k++){
      const outer=50+k*6,inner=outer-6.02,mid=(outer+inner)/2,half=(outer-inner)/2,gap=Math.asin(3.3/inner),roof=top+1.9+k*1.5;
      for(let j=0;j<aisleAngles.length;j++){
        const a0=aisleAngles[j]+gap,a1=(j===aisleAngles.length-1?aisleAngles[0]+TAU:aisleAngles[j+1])-gap,N=Math.ceil((a1-a0)*mid/7),path=[];
        for(let n=0;n<=N;n++){const a=a0+(a1-a0)*n/N;path.push([x+Math.cos(a)*mid,z+Math.sin(a)*mid]);}
        parts.push(sweepLoop(path,()=>[{a:[half,top-.2],b:[half,roof],kind:1},{a:[half,roof],b:[-half,roof],kind:k%2?1:9},{a:[-half,roof],b:[-half,top-.2],kind:1}],{closed:false,closeSection:true,capEnds:true,capKind:1}));
      }
    }
    const st=W(0,-24);body(parts,rectangle(st[0],st[1],42,14,angle),top,2,1,9);
    for(const [u,v,r,h,roof] of [[0,80,15,20,1],[-74,15,11,13,7],[74,15,11,13,7]]){
      const p=W(u,v),pedestal=body(parts,circleFootprint(p[0],p[1],r*1.05,24),top,12,1,1);
      seated(dome(parts,p[0],p[1],r,top+12,h,5,roof,24),pedestal,[p],`${s.id} theatre pavilion`);
    }
    // Four radial flights from the arena to the outer terrace.
    for(const a of aisleAngles){
      const A=[x+Math.cos(a)*43.5,z+Math.sin(a)*43.5],B=[x+Math.cos(a)*90.5,z+Math.sin(a)*90.5],landing=[x+Math.cos(a)*93.5,z+Math.sin(a)*93.5];
      islandFoundation(parts,rectangle(landing[0],landing[1],6,8,a),{top:top+12.4,name:`${s.id} theatre aisle landing`,kind:9});
      const start=parts.length;islandRoad(parts,[A,B],5,{startY:top,endY:top+12.4,steps:true});parts[start].userData.islandEntry={from:A,to:B,startY:top,endY:top+12.4,kind:'theatre aisle',source:'foundation'};
    }
  }else{
    // A fivefold conservatory, each petal a closed green-glass shell on the central plinth.
    ring(parts,x,z,35,7,top,4,1);
    for(let k=0;k<5;k++){
      const a=k*TAU/5,px=x+Math.cos(a)*66,pz=z+Math.sin(a)*66,sec=[];
      for(let j=0;j<=10;j++){const f=j/10;sec.push({y:top+2+31*f,pts:rectangle(px,pz,65*Math.sqrt(Math.max(.02,1-f*f)),29,a),kind:j>8?2:0});}
      const pedestal=body(parts,rectangle(px,pz,65,29,a),top,2.15,1,1),shell=loftSections(sec);parts.push(shell);seated(shell,pedestal,[[px,pz]],`${s.id} glass petal`);
      const ends=[V(x+Math.cos(a)*37,top+2,z+Math.sin(a)*37),V(x+Math.cos(a)*98,top+2,z+Math.sin(a)*98)];parts.push(sweepTube(ends,()=>1.1,6,{kind:1}));
    }
    const seedBase=body(parts,circleFootprint(x,z,23,32),top,4.2,1,1);seated(dome(parts,x,z,22,top+4,26,1,2,32),seedBase,[[x,z]],`${s.id} seed dome`);
  }
  lights.push({x,y:top+14,z,c:c.light,s:2.5});
}

function home(parts,c,W,u,v,w,d,rnd,record,localFree){
  const p=W(u,v),angle=Math.atan2(W(1,0)[1]-W(0,0)[1],W(1,0)[0]-W(0,0)[0]),q=rectangle(p[0],p[1],w,d,angle),r=Math.hypot(w,d)/2+4;
  if(!localFree(p[0],p[1],r))return false;
  const g=footprintGround(q,10);if(g.min<5||g.max-g.min>10)return false;
  const top=islandFoundation(parts,q,{kind:3,name:`${c.id} inhabited terrace`}),h=8+rnd()*10;
  const inset=rectangle(p[0],p[1],w-7,d-7,angle);
  if(c.id==='vesper'){
    body(parts,inset,top,h*.5,5,1);dome(parts,p[0],p[1],Math.min(w,d)*.31,top+h*.5,Math.min(w,d)*.39,1,rnd()<.2?7:1,20);
  }else if(c.id==='orison'){
    body(parts,inset,top,h,5,7);const q1=rectangle(p[0],p[1],w*.48,d*.48,angle);body(parts,q1,top+h,4,0,7);
    if(rnd()<.32)obelisk(parts,p[0],p[1],top+h+4,11,1.8,2);
  }else if(c.id==='anchorage'){
    body(parts,inset,top,h+5,8,9);const roof=rectangle(p[0],p[1],w*.67,d*.65,angle);body(parts,roof,top+h+5,4,0,1);
  }else if(c.id==='austral'){
    body(parts,inset,top,h,0,3);const roof=rectangle(p[0],p[1],w*.42,d*.6,angle);body(parts,roof,top+h,4,0,3);
    for(const f of [-.31,.31]){const b=W(u+w*f,v);body(parts,rectangle(b[0],b[1],2.6,d-5,angle),top+h,.8,1,3);}
  }else{
    body(parts,inset,top,h,5,3);const roof=rectangle(p[0],p[1],w*.55,d*.55,angle);body(parts,roof,top+h,4.5,5,9);
  }
  record(p[0],p[1],r,'home',q,top);
  return true;
}

function gardenTree(parts,x,z,y,height=8,r=3){
  parts.push(latheFacade([{r:.5,y,kind:8},{r:.35,y:y+height*.55,kind:8}],7).translate(x,0,z));
  parts.push(latheFacade([{r:.1,y:y+height*.38,kind:3},{r:r*.85,y:y+height*.45,kind:3},{r,y:y+height*.62,kind:3},{r:r*.75,y:y+height*.85,kind:3},{r:.08,y:y+height,kind:3}],10).translate(x,0,z));
}
function designedGround(parts,c,x,z,w,d,angle,rnd,record){
  const q=rectangle(x,z,w,d,angle),ground=footprintGround(q);if(ground.min<5||ground.max-ground.min>18)return;
  const y=islandFoundation(parts,q,{kind:c.id==='anchorage'?9:3,name:`${c.id} designed grounds`}),foundation=parts.at(-1),cs=Math.cos(angle),sn=Math.sin(angle),W=(u,v)=>[x+u*cs-v*sn,z+u*sn+v*cs];
  const box=(u,v,ww,dd,h,kind=1,top=kind,base=y)=>{const p=W(u,v);body(parts,rectangle(p[0],p[1],ww,dd,angle),base,h,kind,top);};
  const pool=(u,v,ww,dd)=>{
    box(u,v,ww+2.2,dd+2.2,.65,1,1);box(u,v,ww,dd,.12,6,6,y+.65);
    for(const sg of [-1,1]){box(u+sg*(ww/2+.6),v,1.2,dd+2.4,.4,1,1,y+.65);box(u,v+sg*(dd/2+.6),ww,1.2,.4,1,1,y+.65);}
  };
  if(c.id==='thalassa'){
    for(const v of [-d*.4,d*.4])box(0,v,w-5,3,.12,9,9,y+.2);for(const u of [-5,5])box(u,0,2.8,d-5,.12,9,9,y+.2);
    pool(0,0,4,d*.64);
    for(const u of [-w*.28,w*.28])for(const v of [-d*.19,d*.19]){
      box(u,v,w*.29,d*.22,.9,1,3);const p=W(u,v);gardenTree(parts,p[0],p[1],y+.9,10,2.7);
    }
    for(const v of [-d/2+4,d/2-4])arcade(parts,W,-w/2+5,v,w/2-5,v,y,7.5);
  }else if(c.id==='anchorage'){
    box(0,0,w-7,d-7,.15,11,11,y+.1);
    for(let u=-w*.31;u<=w*.31;u+=19)for(const v of [-d*.28,d*.28]){
      const h=4+Math.floor(rnd()*3)*3;box(u,v,14,d*.25,h,8,10,y+.25);
      box(u,v,14.4,d*.25+.4,.6,10,10,y+.25+h);
    }
    for(const v of [-d*.4,d*.4])box(0,v,w*.88,1.2,.28,10,10,y+.2);
    // A gantry spans the clear central handling lane, seated on two substantial legs.
    for(const v of [-d*.42,d*.42])box(0,v,4.5,3.8,20,10,1,y+.2);
    box(0,0,5,d*.88,3,10,1,y+20.2);box(0,d*.12,7,7,4,8,1,y+20.2);
  }else if(c.id==='orison'){
    box(0,0,w-6,d-6,.12,9,9,y+.15);
    for(const u of [-w*.27,w*.27])for(const v of [-d*.26,d*.26]){
      const p=W(u,v);ring(parts,p[0],p[1],11,1.3,y+.3,.8,7,24);column(parts,p[0],p[1],y+.3,7.8,1,7);const support=parts.at(-1);
      const panel=islandPrism(rectangle(0,0,15,13),-.4,.4,10,7);panel.rotateX(-.35).rotateY(-angle).translate(p[0],y+8,p[1]);parts.push(panel);seated(panel,support,[p],`${c.id} mounted instrument`);
    }
    for(let k=-3;k<=3;k++)box(k*w*.12,0,.4,d*.85,.2,7,7,y+.28);
    obelisk(parts,x,z,y+.3,17,1.8,2);
  }else if(c.id==='vesper'){
    for(const u of [-w/2+1,w/2-1])box(u,0,2,d,2.6,1,1);
    for(const v of [-d/2+1,d/2-1])for(const sg of [-1,1])box(sg*(w*.27),v,w*.42,2,2.6,1,1);
    pool(-w*.19,0,w*.24,d*.54);pool(w*.19,0,w*.24,d*.54);
    for(const u of [-w*.37,w*.37])for(const v of [-d*.32,d*.32]){const p=W(u,v);gardenTree(parts,p[0],p[1],y,13,2.2);}
    arcade(parts,W,-w*.36,d*.38,w*.36,d*.38,y,6.5);
    for(const u of [-w*.32,w*.32]){const p=W(u,-d*.33);dome(parts,p[0],p[1],6,y,9,5,1,16);}
  }else{
    box(0,0,w-4,4,.14,9,9,y+.2);pool(0,d*.35,w*.78,2.5);
    for(let u=-w*.35;u<=w*.36;u+=13)for(const v of [-d*.26,d*.19]){const p=W(u,v);gardenTree(parts,p[0],p[1],y,7.5+(rnd()-.5),3.2);}
    const p=W(0,-d/2+7),sec=[];for(let k=0;k<=6;k++){const f=k/6;sec.push({y:y+6*f,pts:rectangle(p[0],p[1],w*.76,11*Math.sqrt(Math.max(.04,1-f*f)),angle),kind:k===6?2:0});}const shell=loftSections(sec);parts.push(shell);seated(shell,foundation,[p,...rectangle(p[0],p[1],w*.74,10.5,angle)],`${c.id} garden greenhouse`);
  }
  record(x,z,Math.hypot(w,d)/2+2,'designed grounds',q,y,c.id==='vesper'?[0,2]:c.id==='austral'?[1,3]:undefined);
}

/** Populate the planned island landscape. Routes are laid before plots and share reservations. */
export function buildIslandLandscape(parts,c,plan,lights,keepouts){
  const rnd=mulberry32(39123+c.island*173),plots=[...(plan.holdings||[])],localRoutes=[],localSurfaces=[],regionalSurfaces=[];
  const addSurface=(sections,target,width)=>{for(let k=1;k<sections.length;k++){const a=sections[k-1],b=sections[k],centre=s=>[(s.left[0]+s.right[0])/2,(s.left[1]+s.right[1])/2];target.push({a:centre(a),b:centre(b),ya:a.y,yb:b.y,width,quad:[a.left,a.right,b.right,b.left],heights:[a.y,a.y,b.y,b.y]});}};
  const record=(x,z,r,type,q,top,entranceEdges)=>{const p={x,z,r,type,q,top,entranceEdges};plots.push(p);plan.circles.push(p);keepouts.push({x,z,r});};
  // Public forecourts are clear destinations: incoming streets stop at their measured level.
  for(const s of plan.sites){const top=c.id==='austral'?Math.max(footprintGround(circleFootprint(s.x,s.z,64,40)).max,footprintGround(circleFootprint(s.x-c.d[0]*150,s.z-c.d[1]*150,125,48)).max)+.85:undefined;s.plazaY=islandFoundation(parts,circleFootprint(s.x,s.z,64,40),{name:`${s.id} arrival square`,top});record(s.x,s.z,64,'arrival square');}
  for(const route of plan.routes){const from=plan.sites.find(s=>s.id===route.from),to=plan.sites.find(s=>s.id===route.to);addSurface(islandRoad(parts,route.points,route.width,{startY:from?.plazaY??plan.startY??3.75,endY:to.plazaY,startRadius:from?64:0,endRadius:64,keepouts}),regionalSurfaces,route.width);parts.at(-1).userData.islandRole='regional';}
  for(const s of plan.sites){
    const cs=Math.cos(s.angle),sn=Math.sin(s.angle),W=(u,v)=>[s.x+u*cs-v*sn,s.z+u*sn+v*cs];
    // The settlement plan is part of its architectural identity. These are distinct
    // connected street patterns, not one radial template decorated with different roofs.
    const roads=islandDistrictRoads(c,s),candidates=[];
    if(c.id==='thalassa'){
      for(const v of [-255,-165,62,155,270,360])for(let u=-430;u<=450;u+=58)candidates.push([u,v,35+rnd()*9,28+rnd()*8]);
      // A covered stepped gallery gives the main street a deliberate civic edge.
      for(let k=0;k<3;k++){
        const p=W(225+k*66,210),q=rectangle(p[0],p[1],54,28,s.angle),g=footprintGround(q);
        if(g.max-g.min<8){const y=islandFoundation(parts,q,{kind:9,name:'Thalassa pilgrim hospice'});body(parts,q,y,13,5,9);record(p[0],p[1],32,'hospice',q,y);}
      }
    }else if(c.id==='anchorage'){
      for(const v of [-188,-66,66,187])for(let u=-465;u<=490;u+=92)candidates.push([u,v,62+rnd()*12,48+rnd()*9]);
      for(const v of [-295,295])for(let u=-450;u<=480;u+=58)candidates.push([u,v,34,31]);
    }else if(c.id==='orison'){
      // A calibrated fan opens toward dawn, with three tangential crescents and only
      // three radial avenues. The clear western wedge preserves the observatory court.
      for(const r of [270,405,530])for(let k=0;k<=23;k++){const a=-2.15+k/23*4.3;candidates.push([Math.cos(a)*r,Math.sin(a)*r,34+rnd()*8,31+rnd()*7]);}
    }else if(c.id==='vesper'){
      // Irregular linked cloister lanes: long gentle curves and offset garden courts.
      for(const v of [-315,-205,-15,104,215,395])for(let u=-410;u<=440;u+=58)candidates.push([u+(rnd()-.5)*18,v+(rnd()-.5)*14,36+rnd()*9,30+rnd()*8]);
    }else{
      // Five garden petals gather around a seed court. The paths follow long lozenges,
      // so the ecological campus reads as fivefold from the island overview as well.
      for(let k=0;k<5;k++){
        const a=k*TAU/5+.12,rotate=(u,v)=>W(-150+Math.cos(a)*u-Math.sin(a)*v,Math.sin(a)*u+Math.cos(a)*v);
        for(const u of [255,355,445])for(const v of [-104,104]){const p=[-150+Math.cos(a)*u-Math.sin(a)*v,Math.sin(a)*u+Math.cos(a)*v];candidates.push([...p,44,34]);}
        const p=rotate(355,0),q=rectangle(p[0],p[1],106,41,s.angle+a),g=footprintGround(q);
        if(g.max-g.min<14&&plan.isRoadFree(p[0],p[1],60)){
          const y=islandFoundation(parts,q,{kind:3,name:'Austral garden laboratory'});body(parts,rectangle(p[0],p[1],100,35,s.angle+a),y,14,0,3);
          body(parts,rectangle(p[0],p[1],90,14,s.angle+a),y+14,5,0,2);record(p[0],p[1],58,'garden laboratory',q,y);
        }
      }
    }
    for(const points of roads){const width=c.id==='anchorage'?11:7;addSurface(islandRoad(parts,points,width,{keepouts,platforms:[{x:s.x,z:s.z,r:64,y:s.plazaY}]}),localSurfaces,width);parts.at(-1).userData.islandRole='local';localRoutes.push(...points.slice(1).map((b,i)=>[points[i],b]));}
    landmark(parts,c,s,record,lights);
    const localFree=(x,z,r)=>!plan.circles.some(p=>Math.hypot(p.x-x,p.z-z)<p.r+r+3)&&plan.isRoadFree(x,z,r)&&!localRoutes.some(([a,b])=>pointSegmentDistance(x,z,a,b)<r+(c.id==='anchorage'?7:5));
    const gardens=[];
    if(c.id==='thalassa')gardens.push([-235,225,128,86],[255,-42,130,140],[-320,420,95,68]);
    else if(c.id==='anchorage')gardens.push([245,0,138,150],[-455,0,88,160],[10,-185,130,85]);
    else if(c.id==='orison')for(const a of [-1.35,-.72,.72,1.35])gardens.push([Math.cos(a)*290,Math.sin(a)*290,70,65]);
    else if(c.id==='vesper')gardens.push([245,-5,115,100],[-220,255,100,75],[260,280,95,72]);
    else for(let k=0;k<5;k++){const a=k*TAU/5+.12;gardens.push([-150+Math.cos(a)*225,Math.sin(a)*225,58,40,a]);}
    for(const [u,v,w,d,rot=0]of gardens){const p=W(u,v),r=Math.hypot(w,d)/2+2;if(localFree(p[0],p[1],r))designedGround(parts,c,p[0],p[1],w,d,s.angle+rot,rnd,record);}
    // Occupied grounds fill the quiet blocks between the street frontages. Six bounded
    // searches favour usable nearby land; the surrounding hills remain continuous habitat.
    for(let sector=0;sector<6;sector++){
      let made=false;
      for(const rad of [175,250,330,405]){
        if(made)break;
        for(const da of [0,-.22,.22]){
          const a=sector*TAU/6+.32+da,u=Math.cos(a)*rad,v=Math.sin(a)*rad;
          const w=c.id==='anchorage'?72:c.id==='austral'?48:72,d=c.id==='anchorage'?64:c.id==='austral'?36:52,p=W(u,v),r=Math.hypot(w,d)/2+2;
          if(!localFree(p[0],p[1],r))continue;
          const n=plots.length;designedGround(parts,c,p[0],p[1],w,d,s.angle,rnd,record);
          if(plots.length>n){made=true;break;}
        }
      }
    }
    for(const [u,v,w,d]of candidates)home(parts,c,W,u,v,w,d,rnd,record,localFree);
    // Street-front parcels complete each plan at human scale. Parcel orientation follows
    // its frontage, and the same reservation test protects the whole roof footprint.
    for(const road of roads){
      let carried=0,next=c.id==='anchorage'?46:28;
      for(let j=1;j<road.length;j++){
        const a=road[j-1],b=road[j],dx=b[0]-a[0],dz=b[1]-a[1],L=Math.hypot(dx,dz);if(L<1e-5)continue;
        while(next<=carried+L){
          const f=(next-carried)/L,x=a[0]+dx*f,z=a[1]+dz*f,tx=dx/L,tz=dz/L;
          for(const sign of [-1,1]){
            const w=c.id==='anchorage'?62:32+rnd()*11,d=c.id==='anchorage'?38:27+rnd()*8,offset=Math.hypot(w,d)/2+(c.id==='anchorage'?12:9);
            const cx=x-tz*offset*sign,cz=z+tx*offset*sign,front=(u,v)=>[cx+tx*u-tz*v,cz+tz*u+tx*v];
            home(parts,c,front,0,0,w,d,rnd,record,localFree);
          }
          next+=c.id==='anchorage'?82:57;
        }
        carried+=L;
      }
    }
    // Small shared courts bind the surrounding plots at four points along the outer lane.
    for(let k=0;k<4;k++){
      const a=k*TAU/4+.5,p=W(Math.cos(a)*345,Math.sin(a)*345),r=22;
      if(!localFree(p[0],p[1],r))continue;
      const g=footprintGround(circleFootprint(p[0],p[1],r,20));if(g.max-g.min>8)continue;
      const y=islandFoundation(parts,circleFootprint(p[0],p[1],r,24),{kind:9,name:'neighbourhood water court'});record(p[0],p[1],r,'water court');
      ring(parts,p[0],p[1],8,1.3,y,.9,1,24);dome(parts,p[0],p[1],1.8,y+.8,5,2,2,12);
      lights.push({x:p[0],y:y+4,z:p[1],c:c.light,s:1.8});
    }
  }
  // Every inhabited terrace has a clear entrance spur to the street system. The route
  // endpoint is an actual pad edge, so doors do not face an unbridged retaining-wall gap.
  const entrance=(plot,segments)=>{
    const candidates=[];
    for(let k=0;k<plot.q.length;k++){
      if(plot.entranceEdges&&!plot.entranceEdges.includes(k))continue;
      const a=plot.q[k],b=plot.q[(k+1)%plot.q.length],gate=[(a[0]+b[0])/2,(a[1]+b[1])/2];
      for(const road of segments){
        const {a:A,b:B}=road;if(Math.hypot(B[0]-A[0],B[1]-A[1])<.001)continue;
        const dx=B[0]-A[0],dz=B[1]-A[1],t=Math.max(0,Math.min(1,((gate[0]-A[0])*dx+(gate[1]-A[1])*dz)/(dx*dx+dz*dz||1))),p=[A[0]+dx*t,A[1]+dz*t],dist=Math.hypot(p[0]-gate[0],p[1]-gate[1]);
        if(dist<(plot.type==='countryside holding'?430:260))candidates.push({gate,p,dist,y:road.ya+(road.yb-road.ya)*t,road});
      }
    }
    candidates.sort((a,b)=>a.dist-b.dist);
    for(const q of candidates){
      if(someCircleNear(plan.circles,Math.min(q.p[0],q.gate[0])-1.5,Math.min(q.p[1],q.gate[1])-1.5,Math.max(q.p[0],q.gate[0])+1.5,Math.max(q.p[1],q.gate[1])+1.5,o=>o!==plot&&pointSegmentDistance(o.x,o.z,q.p,q.gate)<o.r+1.5))continue;
      // A curved ribbon's diagonal triangulation can differ slightly from the
      // centreline interpolation. Match the actual Float32 road top at the junction.
      const P=q.road.quad.map(p=>p.map(Math.fround)),Y=q.road.heights.map(Math.fround),[x,z]=q.p;
      for(const [i,j,k]of [[0,1,2],[0,2,3]]){
        const [a,b,c]=[P[i],P[j],P[k]],det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
        const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(z-c[1]))/det,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(z-c[1]))/det,w=1-u-v;
        if(Math.min(u,v,w)>=-.002){q.y=u*Y[i]+v*Y[j]+w*Y[k];break;}
      }
      return q;
    }
    return null;
  };
  
  // Productive land (fields, vineyards, orchards and farms on the contour, with their lanes)
  // is laid after the road network is graded, by islands/countryside.js.
  for(const plot of plots.filter(p=>['home','designed grounds','hospice','garden laboratory','countryside holding'].includes(p.type)))plot.plannedAccess=entrance(plot,[...localSurfaces,...regionalSurfaces]);
  gradeIslandRoadNetwork(parts,false,[...plan.coreEntrances,...plots.filter(p=>p.plannedAccess).map(p=>({from:p.plannedAccess.p,width:3.8}))]);
  // Refresh the physical street surfaces after grading their shared junctions.
  localSurfaces.length=0;regionalSurfaces.length=0;
  const publicRoads=parts.filter(g=>g.userData.islandRole||g.userData.islandStreet);
  for(const g of publicRoads){const r=g.userData.islandRoad;if(g.userData.islandRole)addSurface(r.sections,g.userData.islandRole==='regional'?regionalSurfaces:localSurfaces,r.width);}
  const publicRoadGrid=new Map();
  for(const g of publicRoads){const s=g.userData.islandRoad.sections;for(let i=1;i<s.length;i++){
    const pair=[s[i-1],s[i]],q=pair.flatMap(a=>[a.left,a.right]);
    for(let x=Math.floor(Math.min(...q.map(p=>p[0]))/64);x<=Math.floor(Math.max(...q.map(p=>p[0]))/64);x++)for(let z=Math.floor(Math.min(...q.map(p=>p[1]))/64);z<=Math.floor(Math.max(...q.map(p=>p[1]))/64);z++){const key=x+','+z;if(!publicRoadGrid.has(key))publicRoadGrid.set(key,[]);publicRoadGrid.get(key).push(pair);}
  }}
  const entryAprons=new Set(),streetY=point=>Math.max(...(publicRoadGrid.get(Math.floor(point[0]/64)+','+Math.floor(point[1]/64))||[]).map(s=>islandRoadHeight(s,point)??-Infinity));
  for(const e of [...plan.coreEntrances,...plots.filter(p=>p.plannedAccess).map(p=>({from:p.plannedAccess.p,width:3.8}))]){
    const point=e.from,key=point.map(v=>v.toFixed(3)).join(','),q=circleFootprint(...point,Math.max(3.4,e.width/2+1.4),32),y=streetY(point);if(entryAprons.has(key)||q.every(p=>Number.isFinite(streetY(p))))continue;
    islandFoundation(parts,q,{top:y,kind:9,name:`${c.id} street-end entrance apron`});entryAprons.add(key);
  }
  const receivingPath=(from,to,q,top,width)=>{
    const dx=to[0]-from[0],dz=to[1]-from[1],L=Math.hypot(dx,dz),normal=[-dz/L,dx/L],caps=[-1,1].map(sign=>[to[0]+normal[0]*width/2*sign,to[1]+normal[1]*width/2*sign]);
    const inside=p=>{const signs=q.map((a,i)=>{const b=q[(i+1)%q.length];return(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);});return signs.every(v=>v>=-.01)||signs.every(v=>v<=.01);};
    if(caps.every(inside))return [from,to];
    const edge=q.map((a,i)=>({a,b:q[(i+1)%q.length],distance:pointSegmentDistance(...to,a,q[(i+1)%q.length])})).sort((a,b)=>a.distance-b.distance)[0],len=Math.hypot(edge.b[0]-edge.a[0],edge.b[1]-edge.a[1]),t=[(edge.b[0]-edge.a[0])/len,(edge.b[1]-edge.a[1])/len],centre=q.reduce((s,p)=>[s[0]+p[0]/q.length,s[1]+p[1]/q.length],[0,0]);let inward=[-t[1],t[0]];if(inward[0]*(centre[0]-to[0])+inward[1]*(centre[1]-to[1])<0)inward=inward.map(v=>-v);
    // Meet the actual plot edge orthogonally: an oblique tread can enter the
    // retaining solid before its nominal endpoint reaches the terrace.
    // the lead is long enough for the flight to turn on a radius wider than itself (a short
    // lead folded the inner edge of sharply turning flights back over itself)
    const turn=Math.acos(Math.max(-1,Math.min(1,((to[0]-from[0])*inward[0]+(to[1]-from[1])*inward[1])/L))),reach=Math.min(Math.max(6,.8*width*Math.tan(turn/2)/.45+.5),L*.45),lead=[to[0]-inward[0]*reach,to[1]-inward[1]*reach];return[from,lead,to];
  };
  const entranceAprons=parts.filter(g=>g.userData.islandFoundation?.name.includes('street-end entrance apron')).map(g=>g.userData.islandFoundation);
  const streetFloor=q=>{const candidates=new Set();for(let x=Math.floor(Math.min(...q.map(p=>p[0]))/64);x<=Math.floor(Math.max(...q.map(p=>p[0]))/64);x++)for(let z=Math.floor(Math.min(...q.map(p=>p[1]))/64);z<=Math.floor(Math.max(...q.map(p=>p[1]))/64);z++)for(const s of publicRoadGrid.get(x+','+z)||[])candidates.add(s);let y=-Infinity;for(const [a,b]of candidates)if(islandPolygonsOverlap(q,[a.left,a.right,b.right,b.left]))y=Math.max(y,a.y,b.y);for(const f of entranceAprons)if(islandPolygonsOverlap(q,f.q))y=Math.max(y,f.top);return y;};
  for(const e of plan.coreEntrances){
    let y=-Infinity;for(const sections of publicRoadGrid.get(Math.floor(e.from[0]/64)+','+Math.floor(e.from[1]/64))||[]){const yy=islandRoadHeight(sections,e.from);if(yy!==undefined)y=Math.max(y,yy);}
    if(!Number.isFinite(y))throw new Error(`${c.id}: missing finalized street at ${e.from}`);
    const path=receivingPath(e.from,e.to,e.q,e.top,e.width),first=parts.length;islandRoad(parts,path,e.width,{startY:y,endY:e.top,steps:true,supports:[{q:e.q,top:e.top+.06}],surfaceFloor:streetFloor,keepouts});parts[first].userData.islandEntry={from:e.from,to:e.to,startY:y,endY:e.top,q:e.q,kind:e.kind||'urban core'};
  }
  for(const plot of plots.filter(p=>p.plannedAccess)){
    const a=plot.plannedAccess;
    if(a){
      a.y=Math.max(...(publicRoadGrid.get(Math.floor(a.p[0]/64)+','+Math.floor(a.p[1]/64))||[]).map(s=>islandRoadHeight(s,a.p)??-Infinity));
      if(plot.type==='countryside holding'&&a.dist>45){
        const f=1-Math.min(30,a.dist*.4)/a.dist,lead=[a.p[0]+(a.gate[0]-a.p[0])*f,a.p[1]+(a.gate[1]-a.p[1])*f],dx=(a.gate[0]-a.p[0])/a.dist,dz=(a.gate[1]-a.p[1])/a.dist;
        const leadY=Math.max(renderedHeight(...lead),renderedHeight(lead[0]-dz*2,lead[1]+dx*2),renderedHeight(lead[0]+dz*2,lead[1]-dx*2))+.28;
        islandRoad(parts,[a.p,lead],3.8,{startY:a.y,endY:leadY,surveyed:true,keepouts});parts.at(-1).userData.islandAccess=true;
        islandRoad(parts,receivingPath(lead,a.gate,plot.q,plot.top,3.8),3.8,{startY:leadY,endY:plot.top,steps:true,supports:[{q:plot.q,top:plot.top+.06}],surfaceFloor:streetFloor,keepouts});
      }else islandRoad(parts,receivingPath(a.p,a.gate,plot.q,plot.top,3.2),3.2,{startY:a.y,endY:plot.top,steps:true,supports:[{q:plot.q,top:plot.top+.06}],surfaceFloor:streetFloor,keepouts});
      plot.access=[a.p,a.gate];plot.accessHeights=[a.y,plot.top];
    }
  }
  plan.plots=plots;plan.localRoutes=localRoutes;plan.streetSurfaces=[...localSurfaces,...regionalSurfaces];
  return plan;
}

import * as THREE from 'three';

// Topology measurements weld shading seams by position, independently of mesh indices.
// Optical sheets are deliberately excluded by callers; structural solids must be watertight.
export function auditGeometry(geometry, { tolerance = 1e-5 } = {}) {
  const p = geometry.getAttribute('position');
  const n = geometry.getAttribute('normal');
  if (!p) throw new Error('Geometry has no positions');
  const vertexIds = new Uint32Array(p.count), points = [], weld = new Map();
  let nonFinite = 0, invalidNormals = 0;
  for (let i = 0; i < p.count; i++) {
    const point = [p.getX(i), p.getY(i), p.getZ(i)];
    if (!point.every(Number.isFinite)) nonFinite++;
    if (n && (!Number.isFinite(n.getX(i) + n.getY(i) + n.getZ(i)) || Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) < 0.5)) invalidNormals++;
    const key = point.map(x => Math.round(x / tolerance)).join(',');
    if (!weld.has(key)) { weld.set(key, points.length); points.push(point); }
    vertexIds[i] = weld.get(key);
  }
  const edgeMap = new Map();
  const at = i => geometry.index ? geometry.index.getX(i) : i;
  const count = geometry.index?.count ?? p.count;
  let degenerates = 0, volume = 0, triangles = 0;
  for (let i = 0; i < count; i += 3) {
    const a = vertexIds[at(i)], b = vertexIds[at(i + 1)], c = vertexIds[at(i + 2)];
    if (a === b || b === c || c === a) { degenerates++; continue; }
    const A = points[a], B = points[b], C = points[c];
    const u = B.map((x,k) => x-A[k]), v = C.map((x,k) => x-A[k]);
    const cross = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    if (Math.hypot(...cross) < tolerance*tolerance) { degenerates++; continue; }
    volume += (A[0]*(B[1]*C[2]-B[2]*C[1]) + A[1]*(B[2]*C[0]-B[0]*C[2]) + A[2]*(B[0]*C[1]-B[1]*C[0])) / 6;
    triangles++;
    for (const [x,y] of [[a,b],[b,c],[c,a]]) {
      const key = x < y ? `${x},${y}` : `${y},${x}`;
      const e = edgeMap.get(key) || { count:0, direction:0 };
      e.count++; e.direction += x < y ? 1 : -1; edgeMap.set(key,e);
    }
  }
  let boundaryEdges=0, nonManifoldEdges=0, inconsistentEdges=0;
  for (const e of edgeMap.values()) {
    if(e.count===1) boundaryEdges++;
    else if(e.count!==2) nonManifoldEdges++;
    else if(e.direction!==0) inconsistentEdges++;
  }
  return { vertices:p.count, weldedVertices:points.length, triangles, degenerates, boundaryEdges, nonManifoldEdges, inconsistentEdges, nonFinite, invalidNormals, signedVolume:volume };
}

// Split the rendered triangles at real position connectivity, not authored labels.
// The returned components retain world-space triangles and a compact spatial tree
// so support checks can reject overlapping bounding boxes that never touch.
export function solidComponents(geometry, matrix = new THREE.Matrix4(), tolerance = 1e-4) {
  const p = geometry.getAttribute('position'), ids = new Uint32Array(p.count);
  const points = [], weld = new Map(), parent = [];
  const point = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    point.fromBufferAttribute(p, i).applyMatrix4(matrix);
    const key = [point.x, point.y, point.z].map(v => Math.round(v / tolerance)).join(',');
    if (!weld.has(key)) { weld.set(key, points.length); parent.push(points.length); points.push(point.clone()); }
    ids[i] = weld.get(key);
  }
  const root = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a, b) => { a = root(a); b = root(b); if (a !== b) parent[b] = a; };
  const at = i => ids[geometry.index ? geometry.index.getX(i) : i];
  const count = geometry.index?.count ?? p.count;
  for (let i = 0; i < count; i += 3) { join(at(i), at(i + 1)); join(at(i), at(i + 2)); }
  const groups = new Map();
  for (let i = 0; i < count; i += 3) {
    const k = root(at(i));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(new THREE.Triangle(points[at(i)], points[at(i + 1)], points[at(i + 2)]));
  }
  return [...groups.values()].map(triangles => {
    const vertices = [...new Set(triangles.flatMap(t => [t.a, t.b, t.c]))];
    const bounds = new THREE.Box3().setFromPoints(vertices);
    return { triangles, vertices, bounds, tree: triangleTree(triangles) };
  });
}

function triangleTree(triangles) {
  const bounds = new THREE.Box3();
  for (const t of triangles) bounds.expandByPoint(t.a).expandByPoint(t.b).expandByPoint(t.c);
  if (triangles.length <= 12) return { bounds, triangles };
  const size = bounds.getSize(new THREE.Vector3());
  const axis = size.x > size.y && size.x > size.z ? 'x' : size.y > size.z ? 'y' : 'z';
  const sorted = triangles.slice().sort((a, b) => (a.a[axis] + a.b[axis] + a.c[axis]) - (b.a[axis] + b.b[axis] + b.c[axis]));
  const mid = sorted.length >> 1;
  return { bounds, left: triangleTree(sorted.slice(0, mid)), right: triangleTree(sorted.slice(mid)) };
}

function boxesNear(a, b, tolerance) {
  return a.min.x <= b.max.x + tolerance && a.max.x + tolerance >= b.min.x &&
    a.min.y <= b.max.y + tolerance && a.max.y + tolerance >= b.min.y &&
    a.min.z <= b.max.z + tolerance && a.max.z + tolerance >= b.min.z;
}

// Separating-axis intersection includes the in-plane axes needed for coplanar
// contact. A tiny geometric tolerance accommodates Float32 structural seams.
function trianglesMeet(a, b, tolerance) {
  const ea = [a.b.clone().sub(a.a), a.c.clone().sub(a.b), a.a.clone().sub(a.c)];
  const eb = [b.b.clone().sub(b.a), b.c.clone().sub(b.b), b.a.clone().sub(b.c)];
  const na = ea[0].clone().cross(ea[1]), nb = eb[0].clone().cross(eb[1]);
  const axes = [na, nb];
  for (const e of ea) { axes.push(na.clone().cross(e)); for (const f of eb) axes.push(e.clone().cross(f)); }
  for (const e of eb) axes.push(nb.clone().cross(e));
  for (const axis of axes) {
    const length = axis.length();
    if (length < 1e-12) continue;
    axis.divideScalar(length);
    const aa = [axis.dot(a.a), axis.dot(a.b), axis.dot(a.c)];
    const bb = [axis.dot(b.a), axis.dot(b.b), axis.dot(b.c)];
    if (Math.min(...aa) > Math.max(...bb) + tolerance || Math.min(...bb) > Math.max(...aa) + tolerance) return false;
  }
  return true;
}

function surfaceContact(a, b, tolerance) {
  if (!boxesNear(a.bounds, b.bounds, tolerance)) return false;
  if (a.triangles && b.triangles) {
    const ba = new THREE.Box3(), bb = new THREE.Box3();
    for (const ta of a.triangles) {
      ba.setFromPoints([ta.a, ta.b, ta.c]);
      for (const tb of b.triangles) {
        bb.setFromPoints([tb.a, tb.b, tb.c]);
        if (boxesNear(ba, bb, tolerance) && trianglesMeet(ta, tb, tolerance)) return true;
      }
    }
    return false;
  }
  if (a.triangles) return surfaceContact(a, b.left, tolerance) || surfaceContact(a, b.right, tolerance);
  if (b.triangles) return surfaceContact(a.left, b, tolerance) || surfaceContact(a.right, b, tolerance);
  return surfaceContact(a.left, b.left, tolerance) || surfaceContact(a.left, b.right, tolerance) ||
    surfaceContact(a.right, b.left, tolerance) || surfaceContact(a.right, b.right, tolerance);
}

function containsMaterial(component, point) {
  if (!component.bounds.containsPoint(point)) return false;
  const ray = new THREE.Ray(point, new THREE.Vector3(.217137, .837731, .501953).normalize());
  const hit = new THREE.Vector3(), normal = new THREE.Vector3();
  const distances = [];
  const visit = node => {
    if (!ray.intersectsBox(node.bounds)) return;
    if (node.triangles) {
      for (const t of node.triangles) if (ray.intersectTriangle(t.a, t.b, t.c, false, hit)) {
        const d = hit.distanceTo(point);
        if (d > 1e-7) distances.push({ d, sign: Math.sign(t.getNormal(normal).dot(ray.direction)) });
      }
    } else { visit(node.left); visit(node.right); }
  };
  visit(component.tree);
  distances.sort((a, b) => a.d - b.d);
  // Shared material faces can have opposite winding at the same distance.
  // Dropping all but the first hit invents material inside an otherwise open
  // passage. Ordinary separated intersections remain the cheap path; ambiguous
  // coincident hits use the oriented solid angle of every actual triangle.
  if (!distances.some((h,i) => i && h.d-distances[i-1].d<=1e-5)) return distances.reduce((sum,h)=>sum+h.sign,0)!==0;
  let angle=0;
  for (const t of component.triangles) {
    const a=t.a.clone().sub(point), b=t.b.clone().sub(point), c=t.c.clone().sub(point);
    const la=a.length(), lb=b.length(), lc=c.length();
    const numerator=a.dot(b.clone().cross(c));
    const denominator=la*lb*lc+a.dot(b)*lc+b.dot(c)*la+c.dot(a)*lb;
    angle+=2*Math.atan2(numerator,denominator);
  }
  return Math.abs(angle)>Math.PI*2;
}

/** True only when actual closed material touches or overlaps; bounding boxes alone never suffice. */
export function materialContact(a, b, tolerance = .002) {
  if (!boxesNear(a.bounds, b.bounds, tolerance)) return false;
  if (surfaceContact(a.tree, b.tree, tolerance)) return true;
  // With disjoint closed boundaries, a connected solid is either wholly inside
  // or wholly outside the other; one real boundary vertex decides containment.
  return containsMaterial(a, b.vertices[0]) || containsMaterial(b, a.vertices[0]);
}

// Node check: the Moon's phase and the Sun in the Moon's frame for a city hour (the orbital view's
// sync), so the default Moon and Medii Landing views can be composed on the lit side.
//   node tools/moonPhase.mjs [hours]
import * as THREE from 'three';
import { SpaceSim } from '../src/space/sim.js';
import { computeSky } from '../src/core/sun.js';

const hours = Number(process.argv[2] ?? 12);
const sky = { sunDir: new THREE.Vector3(), moonDir: new THREE.Vector3(), celestial: new THREE.Matrix3() };
computeSky(hours, sky);
const sim = new SpaceSim();
sim.syncFromHours(hours, sky.moonDir);
const inv = sim.moonQuat.clone().invert();
const sunM = sim.sunDir.clone().applyQuaternion(inv);
const moonDir = sim.moonPos.clone().normalize();
const elong = Math.acos(moonDir.dot(sim.sunDir)) * 180 / Math.PI;
console.log(`hours ${hours}: elongation ${elong.toFixed(1)} deg, lit fraction ${((1 - Math.cos(elong * Math.PI / 180)) / 2).toFixed(3)}`);
console.log(`Sun in the Moon frame (+X to Earth): ${sunM.toArray().map((v) => v.toFixed(3)).join(', ')}`);
console.log(`Sun elevation at Medii Landing (+X): ${(Math.asin(sunM.x) * 180 / Math.PI).toFixed(1)} deg`);
// rig az/el of the Sun direction in the Moon frame (offset = (sin az cos el, sin el, cos az cos el))
console.log(`Sun az ${Math.atan2(sunM.x, sunM.z).toFixed(3)} el ${Math.asin(sunM.y).toFixed(3)}`);

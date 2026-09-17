// Desmon Run — cannon-es rigid-body dynamics bound to three.js.
//
// Architecture (deliberate split):
// - cannon-es owns DYNAMICS: the player body (mass, forces, gravity,
//   contact friction), static props (street plane, hay bales), and
//   fixed-timestep integration with substeps.
// - three-mesh-bvh owns STATIC precision: every ground/wall/top probe
//   raycasts the real ~2M-triangle townscape (a cannon Trimesh that large
//   has no acceleration tree and cannot step in real time).
// The controller drives body velocity; after each physics step the body is
// synced to the player state, BVH probes clamp/slide/ground-snap exactly,
// and corrections write back — so the two systems can never disagree.
//
// From the user's cannon-es/ folder (v0.20.0, MIT — see README credits).
import {
  World, Body, Sphere, Plane, Box, Vec3, Material, ContactMaterial,
  SAPBroadphase,
} from 'cannon-es';

export const PHYS_GRAVITY = -24; // matches the original game feel (m/s^2)
export const PHYS_STEP = 1 / 60;

let world = null;
let playerBody = null;
const _out = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };

export function initPhysics(sx = 0, sy = 2, sz = 10) {
  world = new World({ gravity: new Vec3(0, PHYS_GRAVITY, 0) });
  world.broadphase = new SAPBroadphase(world);
  world.allowSleep = false;
  if (world.solver && 'iterations' in world.solver) world.solver.iterations = 10;

  const groundMat = new Material('ground');
  const playerMat = new Material('player');
  world.addContactMaterial(new ContactMaterial(groundMat, playerMat, {
    friction: 0.0, // tangential drag would fight the controller's own damping;
    restitution: 0.0, // contacts only stop penetration, never bounce or grab
    contactEquationStiffness: 1e7,
  }));
  world.defaultContactMaterial.friction = 0.0;

  // player capsule ≈ two spheres (cannon-es has no capsule primitive),
  // stacked from the feet up so rest height == feet height exactly:
  // lower covers feet→0.8, upper covers 0.9→1.7 (1.7 m body)
  playerBody = new Body({
    mass: 75,
    material: playerMat,
    position: new Vec3(sx, sy, sz),
  });
  playerBody.addShape(new Sphere(0.4), new Vec3(0, 0.4, 0));
  playerBody.addShape(new Sphere(0.4), new Vec3(0, 1.3, 0));
  playerBody.fixedRotation = true;
  playerBody.updateMassProperties();
  playerBody.allowSleep = false;
  playerBody.linearDamping = 0.01;
  playerBody.angularDamping = 1;
  world.addBody(playerBody);

  // infinite street plane (safety net under the BVH-exact city)
  const groundBody = new Body({ mass: 0, material: groundMat, shape: new Plane() });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(groundBody);

  return { world, playerBody };
}

// hay bale: static box collider matching the visual cylinder's footprint
export function addHayBody(x, y, z) {
  if (!world) return null;
  const b = new Body({
    mass: 0,
    shape: new Box(new Vec3(1.2, 0.5, 1.2)),
    position: new Vec3(x, y, z),
  });
  world.addBody(b);
  return b;
}

// One dynamics step: controller velocity in, integrated body out.
// Position is re-seeded from the kinematic state first so scripted moves
// (vault/climb/hang lerps, respawns) flow through physics seamlessly.
export function stepBody(px, py, pz, vx, vy, vz, h) {
  playerBody.position.set(px, py, pz);
  playerBody.velocity.set(vx, vy, vz);
  playerBody.angularVelocity.set(0, 0, 0);
  world.step(h);
  _out.x = playerBody.position.x;
  _out.y = playerBody.position.y;
  _out.z = playerBody.position.z;
  _out.vx = playerBody.velocity.x;
  _out.vy = playerBody.velocity.y;
  _out.vz = playerBody.velocity.z;
  return _out;
}

export function getWorld() { return world; }
export function getPlayerBody() { return playerBody; }

import * as THREE from 'three';
import * as CANNON from 'cannon-es';

type TaggedBody = CANNON.Body & {
  userData?: {
    type: string;
  };
};

type PhysicsMesh = {
  body: CANNON.Body;
  mesh: THREE.Object3D;
  sync?: (body: CANNON.Body, mesh: THREE.Object3D) => void;
};

type PuffParticle = {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
};

type CollisionEvent = {
  body: CANNON.Body;
  contact: CANNON.ContactEquation;
};

const FIXED_TIME_STEP = 1 / 60;
const WORLD_SIZE = 30;
const HALF_WORLD = WORLD_SIZE * 0.5;
const WALL_HEIGHT = 6;
const WALL_THICKNESS = 1;
const IMPACT_THRESHOLD = 9.5;
const THRUST_UP_FORCE = 240;
const THRUST_FORWARD_FORCE = 260;
const clock = new THREE.Clock();

document.body.style.margin = '0';
document.body.style.overflow = 'hidden';
document.body.style.background = '#96adbf';
document.body.innerHTML = '';

const scene = new THREE.Scene();
scene.background = new THREE.Color('#9eb5c6');
scene.fog = new THREE.Fog('#9eb5c6', 20, 60);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 7, -12);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const overlay = document.createElement('div');
overlay.style.position = 'fixed';
overlay.style.inset = '0';
overlay.style.pointerEvents = 'none';
overlay.style.fontFamily = '"Arial Black", Impact, sans-serif';
overlay.innerHTML = `
  <div style="position:absolute;left:20px;top:16px;color:#0c1722;text-shadow:0 2px 0 rgba(255,255,255,0.35);">
    <div style="font-size:28px;line-height:1;">灭火器航天局</div>
    <div style="font-size:12px;max-width:280px;margin-top:8px;opacity:0.85;line-height:1.4;">
      A = 左喷射乱滚 / D = 右喷射乱滚 / A + D = 正向发射辞职申请
    </div>
  </div>
`;
document.body.appendChild(overlay);

const banner = document.createElement('div');
banner.style.position = 'fixed';
banner.style.left = '50%';
banner.style.top = '14%';
banner.style.transform = 'translateX(-50%) scale(0.8)';
banner.style.padding = '18px 28px';
banner.style.fontFamily = '"Arial Black", Impact, sans-serif';
banner.style.fontSize = 'min(7vw, 74px)';
banner.style.letterSpacing = '0.08em';
banner.style.color = '#fff7d7';
banner.style.textAlign = 'center';
banner.style.textShadow = '0 0 18px rgba(0,0,0,0.45), 5px 5px 0 rgba(110,0,0,0.55)';
banner.style.opacity = '0';
banner.style.transition = 'opacity 120ms ease, transform 120ms ease';
banner.style.pointerEvents = 'none';
document.body.appendChild(banner);

const ambientLight = new THREE.HemisphereLight('#ffffff', '#5e6770', 1.1);
scene.add(ambientLight);

const sun = new THREE.DirectionalLight('#fff3cf', 1.6);
sun.position.set(8, 16, -7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 60;
sun.shadow.camera.left = -25;
sun.shadow.camera.right = 25;
sun.shadow.camera.top = 25;
sun.shadow.camera.bottom = -25;
scene.add(sun);

const fillLight = new THREE.DirectionalLight('#9fd4ff', 0.7);
fillLight.position.set(-10, 8, 14);
scene.add(fillLight);

const world = new CANNON.World({
  gravity: new CANNON.Vec3(0, -9.8, 0),
});
world.allowSleep = false;
world.broadphase = new CANNON.SAPBroadphase(world);

const floorMaterial = new CANNON.Material('floor');
const chairMaterial = new CANNON.Material('chair');
const obstacleMaterial = new CANNON.Material('obstacle');
world.defaultContactMaterial.friction = 0.4;
world.defaultContactMaterial.restitution = 0.08;
world.addContactMaterial(
  new CANNON.ContactMaterial(floorMaterial, chairMaterial, {
    friction: 0.25,
    restitution: 0.05,
  }),
);
world.addContactMaterial(
  new CANNON.ContactMaterial(chairMaterial, obstacleMaterial, {
    friction: 0.35,
    restitution: 0.1,
  }),
);

const trackedObjects: PhysicsMesh[] = [];
const particles: PuffParticle[] = [];
const smokeGeometry = new THREE.SphereGeometry(0.18, 6, 6);
const smokeMaterialTemplate = new THREE.MeshBasicMaterial({
  color: '#ffffff',
  transparent: true,
  opacity: 0.92,
});
const tempVec3 = new THREE.Vector3();
const tempVec3B = new THREE.Vector3();
const tempQuat = new THREE.Quaternion();
const tempEuler = new THREE.Euler();
const cameraDesired = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const localOffset = new CANNON.Vec3();
const worldPoint = new CANNON.Vec3();

const crudePalette = {
  gray: new THREE.MeshLambertMaterial({ color: '#8d9097', flatShading: true }),
  darker: new THREE.MeshLambertMaterial({ color: '#5b6068', flatShading: true }),
  metal: new THREE.MeshLambertMaterial({ color: '#6d7580', flatShading: true }),
  red: new THREE.MeshLambertMaterial({ color: '#cf3d2e', flatShading: true }),
  white: new THREE.MeshLambertMaterial({ color: '#f3f3f0', flatShading: true }),
  black: new THREE.MeshLambertMaterial({ color: '#1d2227', flatShading: true }),
  blue: new THREE.MeshLambertMaterial({ color: '#8fc8ff', flatShading: true }),
  wood: new THREE.MeshLambertMaterial({ color: '#87715f', flatShading: true }),
  wall: new THREE.MeshLambertMaterial({ color: '#b7bcc4', flatShading: true }),
  boss: new THREE.MeshLambertMaterial({ color: '#e53935', flatShading: true }),
};

const keys = {
  left: false,
  right: false,
};

let flashTimeout = 0;
let isWin = false;
let lastLeftSmoke = 0;
let lastRightSmoke = 0;

function flashBanner(text: string, color: string, persist = false) {
  if (!persist && isWin) {
    return;
  }

  banner.textContent = text;
  banner.style.color = color;
  banner.style.opacity = '1';
  banner.style.transform = 'translateX(-50%) scale(1)';

  if (persist) {
    return;
  }

  if (flashTimeout) {
    window.clearTimeout(flashTimeout);
  }

  flashTimeout = window.setTimeout(() => {
    if (isWin) {
      return;
    }

    banner.style.opacity = '0';
    banner.style.transform = 'translateX(-50%) scale(0.82)';
  }, 1200);
}

function addBodyMesh(body: CANNON.Body, mesh: THREE.Object3D, sync?: PhysicsMesh['sync']) {
  trackedObjects.push({ body, mesh, sync });
  world.addBody(body);
  scene.add(mesh);
}

function syncTransform(body: CANNON.Body, object: THREE.Object3D) {
  object.position.set(body.position.x, body.position.y, body.position.z);
  object.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
}

function makeStaticBox(
  width: number,
  height: number,
  depth: number,
  position: THREE.Vector3,
  material: THREE.Material,
  type: string,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.copy(position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const body = new CANNON.Body({
    mass: 0,
    material: obstacleMaterial,
    shape: new CANNON.Box(new CANNON.Vec3(width / 2, height / 2, depth / 2)),
    position: new CANNON.Vec3(position.x, position.y, position.z),
  }) as TaggedBody;
  body.userData = { type };

  addBodyMesh(body, mesh);
  return { body, mesh };
}

function makeDesk(x: number, z: number, angle: number) {
  const deskGroup = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.24, 1.5), crudePalette.wood);
  top.position.y = 1.02;
  top.castShadow = true;
  top.receiveShadow = true;
  deskGroup.add(top);

  for (const legX of [-1.3, 1.3]) {
    for (const legZ of [-0.52, 0.52]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.02, 0.18), crudePalette.darker);
      leg.position.set(legX, 0.51, legZ);
      leg.castShadow = true;
      leg.receiveShadow = true;
      deskGroup.add(leg);
    }
  }

  deskGroup.position.set(x, 0, z);
  deskGroup.rotation.y = angle;

  const body = new CANNON.Body({
    mass: 0,
    material: obstacleMaterial,
    position: new CANNON.Vec3(x, 0.95, z),
  }) as TaggedBody;
  body.addShape(new CANNON.Box(new CANNON.Vec3(1.6, 0.75, 0.75)));
  body.quaternion.setFromEuler(0, angle, 0);
  body.userData = { type: 'desk' };

  addBodyMesh(body, deskGroup, (trackedBody, object) => {
    object.position.set(trackedBody.position.x, trackedBody.position.y - 0.95, trackedBody.position.z);
    object.quaternion.set(
      trackedBody.quaternion.x,
      trackedBody.quaternion.y,
      trackedBody.quaternion.z,
      trackedBody.quaternion.w,
    );
  });
}

function makeWaterCooler(x: number, z: number) {
  const coolerGroup = new THREE.Group();

  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 1.5, 10), crudePalette.white);
  tank.position.y = 0.78;
  tank.castShadow = true;
  tank.receiveShadow = true;
  coolerGroup.add(tank);

  const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.23, 0.82, 8), crudePalette.blue);
  bottle.position.y = 1.98;
  bottle.castShadow = true;
  bottle.receiveShadow = true;
  coolerGroup.add(bottle);

  const spoutLeft = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.2), crudePalette.red);
  spoutLeft.position.set(-0.11, 1.1, 0.36);
  const spoutRight = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.2), crudePalette.black);
  spoutRight.position.set(0.11, 1.1, 0.36);
  coolerGroup.add(spoutLeft, spoutRight);

  coolerGroup.position.set(x, 0, z);

  const body = new CANNON.Body({
    mass: 0,
    material: obstacleMaterial,
    shape: new CANNON.Box(new CANNON.Vec3(0.42, 1.2, 0.42)),
    position: new CANNON.Vec3(x, 1.2, z),
  }) as TaggedBody;
  body.userData = { type: 'cooler' };

  addBodyMesh(body, coolerGroup, (trackedBody, object) => {
    object.position.set(trackedBody.position.x, 0, trackedBody.position.z);
  });
}

const floor = new THREE.Mesh(new THREE.BoxGeometry(WORLD_SIZE, 1, WORLD_SIZE), crudePalette.gray);
floor.position.set(0, -0.5, 0);
floor.receiveShadow = true;
scene.add(floor);

const floorBody = new CANNON.Body({
  mass: 0,
  material: floorMaterial,
  shape: new CANNON.Box(new CANNON.Vec3(WORLD_SIZE / 2, 0.5, WORLD_SIZE / 2)),
  position: new CANNON.Vec3(0, -0.5, 0),
}) as TaggedBody;
floorBody.userData = { type: 'floor' };
world.addBody(floorBody);

makeStaticBox(WORLD_SIZE, WALL_HEIGHT, WALL_THICKNESS, new THREE.Vector3(0, WALL_HEIGHT / 2 - 0.5, HALF_WORLD), crudePalette.wall, 'wall');
makeStaticBox(WORLD_SIZE, WALL_HEIGHT, WALL_THICKNESS, new THREE.Vector3(0, WALL_HEIGHT / 2 - 0.5, -HALF_WORLD), crudePalette.wall, 'wall');
makeStaticBox(WALL_THICKNESS, WALL_HEIGHT, WORLD_SIZE, new THREE.Vector3(HALF_WORLD, WALL_HEIGHT / 2 - 0.5, 0), crudePalette.wall, 'wall');
makeStaticBox(WALL_THICKNESS, WALL_HEIGHT, WORLD_SIZE, new THREE.Vector3(-HALF_WORLD, WALL_HEIGHT / 2 - 0.5, 0), crudePalette.wall, 'wall');

const bossDoor = new THREE.Mesh(new THREE.BoxGeometry(4.2, 4.8, 0.45), crudePalette.boss);
bossDoor.position.set(0, 1.9, HALF_WORLD - 1.25);
bossDoor.castShadow = true;
bossDoor.receiveShadow = true;
scene.add(bossDoor);

const bossDoorBody = new CANNON.Body({
  mass: 0,
  material: obstacleMaterial,
  shape: new CANNON.Box(new CANNON.Vec3(2.1, 2.4, 0.23)),
  position: new CANNON.Vec3(0, 1.9, HALF_WORLD - 1.25),
}) as TaggedBody;
bossDoorBody.userData = { type: 'boss-door' };
world.addBody(bossDoorBody);

const obstacleSeeds = [
  { x: -7.5, z: -5.5, rot: 0.3 },
  { x: 6.5, z: -2.6, rot: -0.35 },
  { x: -4.5, z: 5.1, rot: -0.1 },
  { x: 8.3, z: 7.2, rot: 0.55 },
];
for (const desk of obstacleSeeds) {
  makeDesk(desk.x, desk.z, desk.rot);
}

makeWaterCooler(-10.5, 3.2);
makeWaterCooler(10.2, -7.6);
makeWaterCooler(1.8, 8.5);

const chairBody = new CANNON.Body({
  mass: 14,
  material: chairMaterial,
  position: new CANNON.Vec3(0, 2.2, -11.5),
  linearDamping: 0.3,
  angularDamping: 0.58,
}) as TaggedBody;
chairBody.userData = { type: 'chair' };
chairBody.addShape(new CANNON.Box(new CANNON.Vec3(1, 0.18, 0.95)), new CANNON.Vec3(0, 0.24, 0));
chairBody.addShape(new CANNON.Box(new CANNON.Vec3(0.95, 0.12, 0.95)), new CANNON.Vec3(0, -0.2, 0));
chairBody.addShape(new CANNON.Box(new CANNON.Vec3(0.95, 0.9, 0.16)), new CANNON.Vec3(0, 0.92, -0.82));
// Hidden ballast keeps the chair from faceplanting before the player even touches the thrusters.
chairBody.addShape(new CANNON.Box(new CANNON.Vec3(0.72, 0.18, 0.72)), new CANNON.Vec3(0, -0.98, 0));

const chairVisual = new THREE.Group();
const seat = new THREE.Mesh(new THREE.BoxGeometry(2, 0.35, 1.9), crudePalette.red);
seat.position.set(0, 0.24, 0);
seat.castShadow = true;
seat.receiveShadow = true;
chairVisual.add(seat);

const seatBottom = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.25, 1.8), crudePalette.black);
seatBottom.position.set(0, -0.2, 0);
seatBottom.castShadow = true;
seatBottom.receiveShadow = true;
chairVisual.add(seatBottom);

const back = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.8, 0.32), crudePalette.red);
back.position.set(0, 0.92, -0.82);
back.castShadow = true;
back.receiveShadow = true;
chairVisual.add(back);

for (const armX of [-1.08, 1.08]) {
  const armRest = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 1.1), crudePalette.black);
  armRest.position.set(armX, 0.5, 0.05);
  armRest.castShadow = true;
  armRest.receiveShadow = true;
  chairVisual.add(armRest);

  const extinguisher = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.55, 0.26), crudePalette.red);
  extinguisher.position.set(armX, 0.22, 0.68);
  extinguisher.rotation.z = armX > 0 ? -0.12 : 0.12;
  extinguisher.castShadow = true;
  extinguisher.receiveShadow = true;
  chairVisual.add(extinguisher);
}

const basePole = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.75, 0.18), crudePalette.metal);
basePole.position.set(0, -0.72, 0);
basePole.castShadow = true;
basePole.receiveShadow = true;
chairVisual.add(basePole);

const wheelCross = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.22), crudePalette.black);
wheelCross.position.set(0, -1.08, 0);
wheelCross.castShadow = true;
wheelCross.receiveShadow = true;
chairVisual.add(wheelCross);

const wheelCrossB = wheelCross.clone();
wheelCrossB.rotation.y = Math.PI / 2;
chairVisual.add(wheelCrossB);

addBodyMesh(chairBody, chairVisual);

const astronautBodies: CANNON.Body[] = [];

function makeAstronautPart(
  size: THREE.Vector3,
  position: THREE.Vector3,
  color: THREE.Material,
  mass: number,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), color);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const body = new CANNON.Body({
    mass,
    material: chairMaterial,
    shape: new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)),
    position: new CANNON.Vec3(position.x, position.y, position.z),
    linearDamping: 0.08,
    angularDamping: 0.02,
  });

  astronautBodies.push(body);
  addBodyMesh(body, mesh);
  return body;
}

const buttBody = makeAstronautPart(new THREE.Vector3(0.7, 0.8, 0.5), new THREE.Vector3(0, 3, -11.45), crudePalette.white, 1.6);
const leftArmBody = makeAstronautPart(new THREE.Vector3(0.26, 1.2, 0.26), new THREE.Vector3(-0.82, 3.15, -11.3), crudePalette.white, 0.55);
const rightArmBody = makeAstronautPart(new THREE.Vector3(0.26, 1.2, 0.26), new THREE.Vector3(0.82, 3.15, -11.3), crudePalette.white, 0.55);
const leftLegBody = makeAstronautPart(new THREE.Vector3(0.3, 1.4, 0.3), new THREE.Vector3(-0.36, 2.05, -11.1), crudePalette.white, 0.6);
const rightLegBody = makeAstronautPart(new THREE.Vector3(0.3, 1.4, 0.3), new THREE.Vector3(0.36, 2.05, -11.1), crudePalette.white, 0.6);

for (const body of astronautBodies) {
  body.angularVelocity.set((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5);
}

const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.12), crudePalette.blue);
visor.position.set(0, 0.18, 0.31);
(trackedObjects.find((entry) => entry.body === buttBody)?.mesh as THREE.Mesh | undefined)?.add(visor);

const buttConstraint = new CANNON.PointToPointConstraint(
  chairBody,
  new CANNON.Vec3(0, 0.55, 0),
  buttBody,
  new CANNON.Vec3(0, -0.35, 0),
  90,
);
const leftArmConstraint = new CANNON.PointToPointConstraint(
  chairBody,
  new CANNON.Vec3(-0.8, 0.55, -0.1),
  leftArmBody,
  new CANNON.Vec3(0, 0.5, 0),
  26,
);
const rightArmConstraint = new CANNON.PointToPointConstraint(
  chairBody,
  new CANNON.Vec3(0.8, 0.55, -0.1),
  rightArmBody,
  new CANNON.Vec3(0, 0.5, 0),
  26,
);
const leftLegConstraint = new CANNON.PointToPointConstraint(
  chairBody,
  new CANNON.Vec3(-0.33, 0.1, 0.22),
  leftLegBody,
  new CANNON.Vec3(0, 0.65, 0),
  24,
);
const rightLegConstraint = new CANNON.PointToPointConstraint(
  chairBody,
  new CANNON.Vec3(0.33, 0.1, 0.22),
  rightLegBody,
  new CANNON.Vec3(0, 0.65, 0),
  24,
);
buttConstraint.collideConnected = false;
leftArmConstraint.collideConnected = false;
rightArmConstraint.collideConnected = false;
leftLegConstraint.collideConnected = false;
rightLegConstraint.collideConnected = false;
world.addConstraint(buttConstraint);
world.addConstraint(leftArmConstraint);
world.addConstraint(rightArmConstraint);
world.addConstraint(leftLegConstraint);
world.addConstraint(rightLegConstraint);

const leftThrusterForce = new CANNON.Vec3(0, THRUST_UP_FORCE, THRUST_FORWARD_FORCE);
const rightThrusterForce = new CANNON.Vec3(0, THRUST_UP_FORCE, THRUST_FORWARD_FORCE);
const leftThrusterPoint = new CANNON.Vec3(-0.96, 0.28, 0.2);
const rightThrusterPoint = new CANNON.Vec3(0.96, 0.28, 0.2);

function emitSmoke(localX: number, now: number) {
  const lastTime = localX < 0 ? lastLeftSmoke : lastRightSmoke;
  if (now - lastTime < 0.035) {
    return;
  }

  if (localX < 0) {
    lastLeftSmoke = now;
  } else {
    lastRightSmoke = now;
  }

  localOffset.set(localX, 0.32, 0.85);
  chairBody.pointToWorldFrame(localOffset, worldPoint);

  const particleMaterial = smokeMaterialTemplate.clone();
  const particle = new THREE.Mesh(smokeGeometry, particleMaterial);
  particle.position.set(worldPoint.x, worldPoint.y, worldPoint.z);
  particle.scale.setScalar(0.6 + Math.random() * 0.45);
  scene.add(particle);

  const burst = new THREE.Vector3(localX * 0.8, -0.15, -2.8);
  tempQuat.set(chairBody.quaternion.x, chairBody.quaternion.y, chairBody.quaternion.z, chairBody.quaternion.w);
  burst.applyQuaternion(tempQuat);
  burst.add(new THREE.Vector3((Math.random() - 0.5) * 1.4, Math.random() * 0.9, (Math.random() - 0.5) * 1.2));
  const particleLife = 0.45 + Math.random() * 0.22;

  particles.push({
    mesh: particle,
    velocity: burst,
    life: particleLife,
    maxLife: particleLife,
  });
}

function handleThrusters(now: number) {
  if (keys.left) {
    chairBody.applyLocalForce(leftThrusterForce, leftThrusterPoint);
    emitSmoke(-1, now);
  }

  if (keys.right) {
    chairBody.applyLocalForce(rightThrusterForce, rightThrusterPoint);
    emitSmoke(1, now);
  }
}

chairBody.addEventListener('collide', (event: CollisionEvent) => {
  const other = event.body as TaggedBody;
  const otherType = other.userData?.type;
  const impactVelocity = Math.abs(event.contact.getImpactVelocityAlongNormal());

  if (otherType === 'boss-door' && !isWin) {
    isWin = true;
    flashBanner('YOU ARE FIRED (YOU WIN)', '#ffe357', true);
    return;
  }

  if ((otherType === 'wall' || otherType === 'desk') && impactVelocity >= IMPACT_THRESHOLD) {
    flashBanner('RESIGNATION REJECTED', '#fff2e7');
  }
});

window.addEventListener('keydown', (event) => {
  if (event.repeat) {
    return;
  }

  if (event.code === 'KeyA') {
    keys.left = true;
  }

  if (event.code === 'KeyD') {
    keys.right = true;
  }
});

window.addEventListener('keyup', (event) => {
  if (event.code === 'KeyA') {
    keys.left = false;
  }

  if (event.code === 'KeyD') {
    keys.right = false;
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function updateCamera(elapsed: number) {
  tempVec3.set(0, 5.4, -11.5);
  tempQuat.set(chairVisual.quaternion.x, chairVisual.quaternion.y, chairVisual.quaternion.z, chairVisual.quaternion.w);
  tempVec3.applyQuaternion(tempQuat);

  const wobble = tempVec3B.set(
    Math.sin(elapsed * 2.7) * 1.2,
    Math.sin(elapsed * 1.8) * 0.8,
    Math.cos(elapsed * 2.1) * 0.7,
  );

  cameraDesired.set(
    chairBody.position.x + tempVec3.x + wobble.x,
    chairBody.position.y + tempVec3.y + wobble.y,
    chairBody.position.z + tempVec3.z + wobble.z,
  );

  camera.position.lerp(cameraDesired, 0.045);

  lookTarget.set(
    chairBody.position.x + Math.sin(elapsed * 4.5) * 0.35,
    chairBody.position.y + 1.2 + Math.sin(elapsed * 3.2) * 0.5,
    chairBody.position.z + 1.6 + Math.cos(elapsed * 3.7) * 0.45,
  );
  camera.lookAt(lookTarget);
}

function updateParticles(delta: number) {
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const particle = particles[i];
    particle.life -= delta;
    particle.velocity.y += 1.2 * delta;
    particle.mesh.position.addScaledVector(particle.velocity, delta);
    particle.mesh.scale.multiplyScalar(1 + delta * 1.8);

    const alpha = Math.max(particle.life / particle.maxLife, 0);
    (particle.mesh.material as THREE.MeshBasicMaterial).opacity = alpha;

    if (particle.life <= 0) {
      scene.remove(particle.mesh);
      (particle.mesh.material as THREE.Material).dispose();
      particles.splice(i, 1);
    }
  }
}

function updateWorldTransforms() {
  for (const item of trackedObjects) {
    if (item.sync) {
      item.sync(item.body, item.mesh);
    } else {
      syncTransform(item.body, item.mesh);
    }
  }
}

function addCheapDrama() {
  const speed = chairBody.velocity.length();
  tempEuler.set(
    Math.sin(clock.elapsedTime * 1.4) * 0.01,
    0,
    Math.cos(clock.elapsedTime * 1.7) * 0.01 + speed * 0.0008,
  );
  renderer.domElement.style.filter = speed > 18 ? 'saturate(1.12) contrast(1.06)' : 'none';
  scene.rotation.set(tempEuler.x, tempEuler.y, tempEuler.z);
}

let accumulator = 0;

function animate() {
  requestAnimationFrame(animate);

  const frameDelta = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;
  accumulator += frameDelta;

  while (accumulator >= FIXED_TIME_STEP) {
    handleThrusters(elapsed);
    world.step(FIXED_TIME_STEP);
    accumulator -= FIXED_TIME_STEP;
  }

  updateWorldTransforms();
  updateParticles(frameDelta);
  updateCamera(elapsed);
  addCheapDrama();
  renderer.render(scene, camera);
}

updateWorldTransforms();
flashBanner('RESIGNATION PENDING...', '#dfe6ec');
animate();

// Kestrel Yard: an original two-lane industrial yard at dusk. Attackers spawn south,
// defenders hold north, one bombsite (Site A) at the north end. West lane, east lane
// and a mid connector join the two halves; crates, containers, pipes and barriers make
// the corners and sightlines. Every solid is both a mesh and an AABB collider.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const MAP = { minX: -23, maxX: 23, minZ: -19, maxZ: 19, wallHeight: 5 };
export const SITE = { minX: -4, maxX: 8, minZ: -19, maxZ: -13 };
export const SPAWNS = {
  you: { x: 0, z: 15.5, yaw: 0 },
  allies: [
    { x: -3.5, z: 15.5, yaw: 0 },
    { x: 3.5, z: 15.5, yaw: 0 },
  ],
  foes: [
    { x: -8, z: -15.5, yaw: Math.PI },
    { x: 0, z: -16.5, yaw: Math.PI },
    { x: 8, z: -15.5, yaw: Math.PI },
    { x: -16, z: -10, yaw: Math.PI },
  ],
};

// Waypoint routes bots walk: each route is a list of {x, z} stops from a spawn toward Site A.
export const ROUTES = {
  west: [
    { x: -16, z: 12 }, { x: -16, z: 0 }, { x: -16, z: -12 }, { x: -6, z: -16 },
  ],
  east: [
    { x: 16, z: 12 }, { x: 16, z: 0 }, { x: 16, z: -12 }, { x: 6, z: -16 },
  ],
  mid: [
    { x: 0, z: 9 }, { x: 0, z: 0 }, { x: 0, z: -9 }, { x: 2, z: -16 },
  ],
};
export const SITE_HOLDS = [
  { x: -3, z: -16 }, { x: 2, z: -17 }, { x: 7, z: -15 }, { x: -1, z: -14 },
];

export function pointInSite(x, z) {
  return x >= SITE.minX && x <= SITE.maxX && z >= SITE.minZ && z <= SITE.maxZ;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const shootables = [];

  const mats = {};
  function material(name, rough, metal) {
    const key = `${name}:${rough}:${metal}`;
    if (!mats[key]) {
      mats[key] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(PALETTE[name]),
        roughness: rough,
        metalness: metal,
      });
    }
    return mats[key];
  }

  function box(w, h, d, x, y, z, mat, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function cylinder(r, h, x, y, z, mat, segments = 14) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segments), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    // Approximate the cylinder with an AABB so the player and bots collide with it.
    colliders.push(new THREE.Box3(
      new THREE.Vector3(x - r, y - h / 2, z - r),
      new THREE.Vector3(x + r, y + h / 2, z + r),
    ));
    shootables.push(mesh);
    return mesh;
  }

  const groundMat = material('ground', 0.95, 0.0);
  const darkMat = material('groundDark', 0.95, 0.0);
  const wallMat = material('wall', 0.85, 0.15);
  const wallTopMat = material('wallTop', 0.8, 0.2);
  const crateMat = material('crate', 0.9, 0.0);
  const crateDarkMat = material('crateDark', 0.9, 0.0);
  const tealMat = material('containerTeal', 0.6, 0.35);
  const rustMat = material('containerRust', 0.6, 0.35);
  const sandMat = material('containerSand', 0.65, 0.3);
  const pipeMat = material('pipe', 0.45, 0.65);
  const hazardMat = material('hazard', 0.7, 0.1);
  const hazardDarkMat = material('hazardDark', 0.85, 0.0);

  // Yard floor, 46 x 38 m, with worn darker patches for reading.
  box(46.4, 0.4, 38.4, 0, -0.2, 0, groundMat);
  box(12, 0.06, 8, -12, 0.03, 4, darkMat, false);
  box(10, 0.06, 7, 10, 0.03, -4, darkMat, false);
  box(14, 0.06, 6, 2, 0.03, 11, darkMat, false);
  // Perimeter walls, 5 m high, with a lighter coping strip.
  box(0.6, 5, 38.4, -23.3, 2.5, 0, wallMat);
  box(0.6, 5, 38.4, 23.3, 2.5, 0, wallMat);
  box(46.4, 5, 0.6, 0, 2.5, -19.3, wallMat);
  box(46.4, 5, 0.6, 0, 2.5, 19.3, wallMat);
  box(0.7, 0.25, 38.4, -23.3, 5.1, 0, wallTopMat, false);
  box(0.7, 0.25, 38.4, 23.3, 5.1, 0, wallTopMat, false);
  box(46.4, 0.25, 0.7, 0, 5.1, -19.3, wallTopMat, false);
  box(46.4, 0.25, 0.7, 0, 5.1, 19.3, wallTopMat, false);

  // --- Site A, north centre: hazard pad, corner posts, container back wall. ---
  box(SITE.maxX - SITE.minX, 0.08, SITE.maxZ - SITE.minZ, 2, 0.04, -16, hazardMat, false);
  box(0.5, 0.08, 6, -4, 0.04, -16, hazardDarkMat, false);
  box(0.5, 0.08, 6, 8, 0.04, -16, hazardDarkMat, false);
  box(0.5, 2.2, 0.5, -4, 1.1, -13.2, hazardMat);
  box(0.5, 2.2, 0.5, 8, 1.1, -13.2, hazardMat);
  box(0.5, 2.2, 0.5, -4, 1.1, -18.8, hazardDarkMat);
  box(0.5, 2.2, 0.5, 8, 1.1, -18.8, hazardDarkMat);
  // Site back cover: a sand container lying across the north wall.
  box(7, 2.6, 2.5, -8, 1.3, -17.5, sandMat);

  // --- Shipping containers: the long sightline blocks. ---
  box(6, 2.6, 2.5, -14, 1.3, -8, tealMat); // west lane, blocks the straight shot
  box(2.5, 2.6, 6, 13, 1.3, -6, rustMat); // east lane, vertical
  box(6, 2.6, 2.5, 14, 1.3, 8, sandMat); // south-east, attacker side cover
  box(2.5, 2.6, 6, -16, 1.3, 6, rustMat); // south-west, attacker side cover
  box(5, 2.6, 2.5, 9, 1.3, -14.5, tealMat); // site approach, east side

  // --- Mid: a silo and a pipe gantry break the centre sightline. ---
  cylinder(2.1, 6, -8, 3, 0, pipeMat);
  cylinder(0.55, 5.4, 4, 2.7, 0, pipeMat);
  box(6, 0.5, 0.5, 1, 5.3, 0, pipeMat); // gantry beam over mid
  box(0.5, 5.3, 0.5, -2, 2.65, 0, pipeMat);
  box(0.5, 5.3, 0.5, 4, 2.65, 0, pipeMat);

  // --- Crates: crouch-height cover along both lanes and mid. ---
  box(1.2, 1.2, 1.2, -6, 0.6, -10, crateMat);
  box(1.2, 1.2, 1.2, -4.8, 0.6, -10, crateDarkMat);
  box(1.2, 1.2, 1.2, -6, 1.8, -10, crateDarkMat);
  box(1.2, 1.2, 1.2, 8, 0.6, -2, crateMat);
  box(1.2, 1.2, 1.2, 9.2, 0.6, -2, crateDarkMat);
  box(1.2, 1.2, 1.2, -12, 0.6, 2, crateMat);
  box(1.2, 1.2, 1.2, -12, 1.8, 2, crateDarkMat);
  box(1.2, 1.2, 1.2, 4, 0.6, 6, crateMat);
  box(1.2, 1.2, 1.2, 5.2, 0.6, 6, crateDarkMat);
  box(1.2, 1.2, 1.2, -2, 0.6, 12, crateMat);
  box(1.2, 1.2, 1.2, 18, 0.6, -12, crateMat);
  box(1.2, 1.2, 1.2, -19, 0.6, -12, crateMat);
  box(1.2, 1.2, 1.2, -10, 0.6, -14, crateMat);
  box(1.2, 1.2, 1.2, 12, 0.6, 12, crateMat);

  // --- Low barriers: waist-high steel, crouch-or-shoot-over cover. ---
  box(8, 1.0, 0.6, -6, 0.5, 4, pipeMat);
  box(8, 1.0, 0.6, 8, 0.5, -8, pipeMat);
  box(0.6, 1.0, 8, -2, 0.5, -6, pipeMat);
  box(5, 1.0, 0.6, 0, 0.5, 14.5, pipeMat);

  // --- Pipes along the walls: horizontal runs with correct AABB colliders. ---
  // A pipe lying along Z: length runs in z, radius in x/y.
  function pipeZ(r, len, x, y, z, mat) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3(
      new THREE.Vector3(x - r, y - r, z - len / 2),
      new THREE.Vector3(x + r, y + r, z + len / 2),
    ));
    shootables.push(mesh);
    return mesh;
  }
  pipeZ(0.45, 12, -22, 0.45, -6, pipeMat);
  pipeZ(0.45, 12, -22, 1.3, -6, pipeMat);
  pipeZ(0.4, 10, 22, 0.4, 2, pipeMat);

  // --- Sky: a gradient dome, teal dusk above, burnt orange at the horizon. ---
  const skyGeo = new THREE.SphereGeometry(160, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(PALETTE.skyTop) },
      low: { value: new THREE.Color(PALETTE.skyLow) },
    },
    vertexShader: 'varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 low; varying vec3 vPos; void main() { float h = clamp(vPos.y / 160.0, 0.0, 1.0); gl_FragColor = vec4(mix(low, top, pow(h, 0.65)), 1.0); }',
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);
  // Low sun disc, hanging over the west wall.
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(7, 24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb45e'), fog: false }),
  );
  sun.position.set(-110, 26, -40);
  sun.lookAt(0, 8, 0);
  scene.add(sun);

  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 30, 120);

  // --- Light: warm low sun from the west, cool hemisphere, faint fill. ---
  const hemi = new THREE.HemisphereLight(new THREE.Color('#8fb6c4'), new THREE.Color('#3a2b24'), 0.85);
  scene.add(hemi);
  const sunLight = new THREE.DirectionalLight(new THREE.Color('#ff9a3d'), 2.4);
  sunLight.position.set(-28, 16, 10);
  sunLight.target.position.set(4, 0, -4);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -32;
  sunLight.shadow.camera.right = 32;
  sunLight.shadow.camera.top = 32;
  sunLight.shadow.camera.bottom = -32;
  sunLight.shadow.camera.far = 90;
  sunLight.shadow.bias = -0.0005;
  scene.add(sunLight, sunLight.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#5f7f96'), 0.5);
  fill.position.set(18, 12, -14);
  scene.add(fill);

  return { colliders, shootables, group };
}

// DUSTLINE boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. main.js owns the match flow (menu → buy → round → round end), the
// player's raycast shooting, tracers, grenade projectiles, the charge (plant / defuse /
// explode) and the screenshot staging (?shot=start|play|buy|site&seed=N), which sets
// up a deterministic frame, renders it twice, freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, pointInSite, SPAWNS } from './world.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS, GRENADE } from './weapon.js';
import { createBots } from './bots.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import {
  createState, PHASE, BOMB, ROUND_SECONDS, BUY_SECONDS, PLANT_SECONDS,
  DEFUSE_SECONDS, BOMB_SECONDS, WIN_ROUNDS, START_MONEY, WIN_MONEY,
  LOSS_MONEY, KILL_MONEY, PLANT_MONEY, resetForRound, addFeed,
} from './state.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = shot ? mulberry32(seed) : Math.random;
const state = createState(random);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.fog);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 400);
scene.add(camera);

const world = createWorld(scene);
const hud = createHud();
const audio = createAudio({ silent: !!shot });
const weapon = createWeapon(camera);
const bots = createBots(scene, world.colliders, world.shootables, state, random);
const player = createPlayer(world.colliders, SPAWNS.you);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const shootables = world.shootables.concat(bots.hitMeshes);

// Reused scratch vectors: the hot paths allocate nothing.
const dirV = new THREE.Vector3();
const muzzleV = new THREE.Vector3();
const endV = new THREE.Vector3();
const fromV = new THREE.Vector3();
const grenadeTmp = new THREE.Vector3();

const you = { hp: 100, alive: true };
const body = player.state;
let started = false;
let frozen = false;
let roundEndShown = false;
let roundEndAt = 0;
let lastBeepSecond = -1;
let accumulator = 0;
let lastTime = performance.now();

// --- Tracers: a pool of stretched boxes, cycled so no mesh is ever created mid-game. ---
const tracers = [];
for (let i = 0; i < 14; i += 1) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.012, 0.012, 1),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  mesh.visible = false;
  scene.add(mesh);
  tracers.push({ mesh, life: 0 });
}
let tracerIndex = 0;
function spawnTracer(from, to, color) {
  const t = tracers[tracerIndex];
  tracerIndex = (tracerIndex + 1) % tracers.length;
  // A tracer is a short streak near the shooter, not a laser across the map.
  const len = Math.min(from.distanceTo(to), 6);
  if (len < 0.5) return;
  endV.copy(to).sub(from).normalize().multiplyScalar(len).add(from);
  t.mesh.position.copy(from).add(endV).multiplyScalar(0.5);
  t.mesh.lookAt(endV);
  t.mesh.scale.set(1, 1, len);
  t.mesh.material.color.set(color);
  t.mesh.visible = true;
  t.life = 0.07;
}

// --- Grenades: thrown projectiles that bounce on AABBs and burst after the fuse. ---
const grenades = [];
const grenadeGeo = new THREE.SphereGeometry(0.12, 10, 8);
const grenadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hazardDark), roughness: 0.5, metalness: 0.5 });
const boomLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 18);
scene.add(boomLight);
const boomRing = new THREE.Mesh(
  new THREE.RingGeometry(0.5, 0.65, 32),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
);
boomRing.rotation.x = -Math.PI / 2;
scene.add(boomRing);
let boomRingLife = 0;

function throwGrenade() {
  if (!weapon.takeGrenade()) {
    return;
  }
  camera.getWorldDirection(dirV);
  const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
  mesh.castShadow = true;
  mesh.position.copy(camera.position);
  scene.add(mesh);
  grenades.push({
    mesh,
    vx: dirV.x * 15,
    vy: dirV.y * 15 + 3.2,
    vz: dirV.z * 15,
    fuse: GRENADE.fuse,
  });
  audio.throwWhoosh();
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name, weapon.state.grenades);
}

function explodeGrenade(g) {
  const p = g.mesh.position;
  boomLight.position.copy(p);
  boomLight.intensity = 60;
  boomRing.position.set(p.x, 0.12, p.z);
  boomRingLife = 0.4;
  audio.explosion();
  state.noises.push({ x: p.x, z: p.z, radius: 30, at: state.time });
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const d = Math.hypot(bot.x - p.x, bot.z - p.z);
    if (d < GRENADE.radius) {
      const dmg = Math.round(GRENADE.damage * (1 - d / GRENADE.radius));
      const killed = bots.damage(bot, dmg, 'body');
      addFeed(state, `FL-2 frag ${killed ? '▸ ' : 'hit '}${bot.name} (${dmg})`, 'kill');
      if (killed && bot.team === 'foe') {
        state.money += KILL_MONEY;
        state.kills += 1;
      }
    }
  }
  const pd = Math.hypot(body.x - p.x, body.z - p.z);
  if (pd < GRENADE.radius && you.alive) {
    damagePlayer(Math.round(GRENADE.damage * (1 - pd / GRENADE.radius) * 0.5), 'FL-2 frag');
  }
  scene.remove(g.mesh);
}

function stepGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i -= 1) {
    const g = grenades[i];
    g.fuse -= dt;
    g.vy -= 12 * dt;
    const p = g.mesh.position;
    let nx = p.x + g.vx * dt;
    let ny = p.y + g.vy * dt;
    let nz = p.z + g.vz * dt;
    // Cheap AABB bounce: test each axis, reflect the velocity that hit a solid.
    for (const c of world.colliders) {
      if (nx > c.min.x - 0.12 && nx < c.max.x + 0.12 && ny > c.min.y - 0.12 && ny < c.max.y + 0.12 && nz > c.min.z - 0.12 && nz < c.max.z + 0.12) {
        if (p.x <= c.min.x || p.x >= c.max.x) { g.vx *= -0.45; nx = p.x; }
        if (p.z <= c.min.z || p.z >= c.max.z) { g.vz *= -0.45; nz = p.z; }
        if (p.y <= c.min.y || p.y >= c.max.y) { g.vy *= -0.45; ny = p.y; }
      }
    }
    if (ny < 0.12) {
      ny = 0.12;
      g.vy = Math.abs(g.vy) * 0.45;
      g.vx *= 0.85;
      g.vz *= 0.85;
    }
    p.set(nx, ny, nz);
    if (g.fuse <= 0) {
      explodeGrenade(g);
      grenades.splice(i, 1);
    }
  }
  if (boomLight.intensity > 0) boomLight.intensity = Math.max(0, boomLight.intensity - 60 * dt * 4);
  if (boomRingLife > 0) {
    boomRingLife -= dt;
    const t = 1 - Math.max(0, boomRingLife) / 0.4;
    boomRing.scale.setScalar(1 + t * 9);
    boomRing.material.opacity = Math.max(0, 0.85 * (1 - t));
  }
}

// --- The charge: a small device with a blinking light, carried, planted or dropped. ---
const bombGroup = new THREE.Group();
const bombBox = new THREE.Mesh(
  new THREE.BoxGeometry(0.34, 0.2, 0.3),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hazardDark), roughness: 0.5, metalness: 0.4 }),
);
const bombDot = new THREE.Mesh(
  new THREE.SphereGeometry(0.05, 8, 8),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.enemy) }),
);
bombDot.position.set(0, 0.14, 0);
const bombLight = new THREE.PointLight(new THREE.Color(PALETTE.enemy), 0, 5);
bombLight.position.set(0, 0.4, 0);
bombGroup.add(bombBox, bombDot, bombLight);
bombGroup.visible = false;
scene.add(bombGroup);

function syncBombMesh() {
  const b = state.bomb;
  if (b.state === BOMB.PLANTED || b.state === BOMB.DROPPED) {
    bombGroup.visible = true;
    bombGroup.position.set(b.position.x, 0.12, b.position.z);
    const urgent = b.state === BOMB.PLANTED && b.timer < 10;
    const blink = Math.sin(state.time * (urgent ? 16 : 6)) > 0;
    bombLight.intensity = blink ? 3 : 0.4;
    bombDot.material.color.set(blink ? PALETTE.enemy : PALETTE.hazardDark);
  } else {
    bombGroup.visible = false;
  }
}

function damagePlayer(dmg, fromName) {
  if (!you.alive) return;
  you.hp -= dmg;
  hud.setHealth(you.hp);
  hud.damageFlash();
  audio.hurt();
  if (you.hp <= 0) {
    you.hp = 0;
    you.alive = false;
    addFeed(state, `${fromName} ▸ YOU`, 'bad');
    if (state.bomb.state === BOMB.CARRIED && state.bomb.carrier === 'player') {
      // The charge passes to the nearest living ally, or drops where you fell.
      let best = null;
      let bestD = Infinity;
      for (const bot of bots.bots) {
        if (!bot.alive || bot.team !== 'you') continue;
        const d = Math.hypot(bot.x - body.x, bot.z - body.z);
        if (d < bestD) {
          bestD = d;
          best = bot;
        }
      }
      if (best) {
        state.bomb.carrier = best.id;
        addFeed(state, `${best.name} picked up the charge`, 'info');
      } else {
        state.bomb.state = BOMB.DROPPED;
        state.bomb.carrier = null;
        state.bomb.position.x = body.x;
        state.bomb.position.y = 0;
        state.bomb.position.z = body.z;
      }
    }
    maybeEndRound();
  }
}

function playerShoot() {
  // In live play the trigger must be held; in a staged screenshot (?shot=) the
  // shot is scripted, so the trigger check is bypassed there.
  if (!shot && !weapon.wantFire()) return;
  if (!weapon.ready()) {
    if (weapon.state.mag === 0 && weapon.state.cooldown === 0) {
      audio.dryFire();
      weapon.state.cooldown = 0.25;
    }
    return;
  }
  if (!weapon.takeRound()) return;
  const d = weapon.def();
  camera.getWorldDirection(dirV);
  const spread = weapon.spread(player.groundSpeed());
  dirV.x += (random() * 2 - 1) * spread;
  dirV.y += (random() * 2 - 1) * spread;
  dirV.z += (random() * 2 - 1) * spread;
  dirV.normalize();
  muzzleV.set(0.24, -0.17, -0.95);
  camera.localToWorld(muzzleV);
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, dirV);
  const hits = raycaster.intersectObjects(shootables, false);
  const hit = hits[0] || null;
  endV.copy(camera.position).addScaledVector(dirV, 80);
  if (hit) {
    endV.copy(hit.point);
    const target = hit.object.userData.bot;
    if (target && target.alive) {
      const dmg = Math.round(d.damage * (hit.object.userData.part === 'head' ? d.headMult : 1));
      const killed = bots.damage(target, dmg, hit.object.userData.part);
      hud.hitMarker(killed, shot ? 4000 : 90);
      if (killed) {
        audio.kill();
        state.money += KILL_MONEY;
        state.kills += 1;
        addFeed(state, `YOU ▸ ${target.name} (${dmg})`, 'kill');
      } else {
        audio.hit();
        addFeed(state, `YOU hit ${target.name} (${dmg})`, 'info');
      }
      if (bots.aliveCount('foe') === 0) maybeEndRound();
    }
  }
  spawnTracer(muzzleV, endV, PALETTE.accent);
  weapon.pullTrigger();
  player.recoil(d.recoil + random() * 0.004, (random() * 2 - 1) * 0.004);
  audio.shot(d.id);
  state.noises.push({ x: body.x, z: body.z, radius: 24, at: state.time });
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, d.name, weapon.state.grenades);
}

function plantCharge() {
  state.bomb.state = BOMB.PLANTED;
  state.bomb.carrier = null;
  state.bomb.timer = BOMB_SECONDS;
  state.bomb.plantProgress = 0;
  state.bomb.position.x = body.x;
  state.bomb.position.y = 0;
  state.bomb.position.z = body.z;
  state.money += PLANT_MONEY;
  addFeed(state, 'YOU planted the charge', 'good');
  audio.beep(true);
}

function maybeEndRound() {
  if (state.phase !== PHASE.PLAY) return;
  const b = state.bomb;
  if (b.state === BOMB.EXPLODED) {
    endRound('you', 'CHARGE DETONATED — SITE A IS OURS');
  } else if (b.state === BOMB.DEFUSED) {
    endRound('foe', 'CHARGE DEFUSED — SITE HELD');
  } else if (bots.aliveCount('foe') === 0) {
    endRound('you', 'ALL SENTINELS DOWN');
  } else if (!you.alive && bots.aliveCount('you') === 0 && b.state !== BOMB.PLANTED) {
    endRound('foe', 'VANGUARD DOWN');
  } else if (state.timer <= 0 && b.state !== BOMB.PLANTED) {
    endRound('foe', 'TIME EXPIRED — SITE HELD');
  }
}

function endRound(winner, reason) {
  state.phase = PHASE.ROUND_END;
  state.score[winner] += 1;
  state.money += winner === 'you' ? WIN_MONEY : LOSS_MONEY;
  roundEndShown = false;
  roundEndAt = state.time + 1.6;
  hud.banner(
    winner === 'you' ? 'ROUND WON' : 'ROUND LOST',
    `${reason} · +$${winner === 'you' ? WIN_MONEY : LOSS_MONEY}`,
    winner === 'you' ? 'good' : 'bad',
    3000,
  );
  if (winner === 'you') audio.roundWin();
  else audio.roundLose();
  input.releaseLock();
  if (state.score.you >= WIN_ROUNDS || state.score.foe >= WIN_ROUNDS) {
    state.matchOver = true;
    state.matchWinner = state.score.you >= WIN_ROUNDS ? 'you' : 'foe';
  }
}

function startBuyPhase() {
  resetForRound(state, state.round);
  state.phase = PHASE.BUY;
  state.timer = BUY_SECONDS;
  you.hp = 100;
  you.alive = true;
  player.reset(SPAWNS.you);
  bots.reset();
  weapon.refillAmmo();
  syncCamera();
  hud.setHealth(100);
  hud.setMoney(state.money);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name, weapon.state.grenades);
  hud.setScore(state.score.you, state.score.foe, state.round);
  hud.setTimer(BUY_SECONDS, 'buy');
  hud.setBomb('CHARGE WITH YOU — REACH SITE A', '');
  hud.showBuy(state.money, weapon.state.owned, onBuy);
  input.releaseLock();
}

function startRound() {
  hud.hideBuy();
  state.phase = PHASE.PLAY;
  state.timer = ROUND_SECONDS;
  state.phaseTime = 0;
  lastBeepSecond = -1;
  weapon.refillAmmo();
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name, weapon.state.grenades);
  hud.setTimer(ROUND_SECONDS, 'play');
  hud.setBomb('CHARGE WITH YOU — REACH SITE A', '');
  hud.banner(`ROUND ${state.round}`, 'Plant the charge at Site A', 'info', 2400);
  hud.showOverlay('paused', 0);
  input.clearPressed();
}

function startMatch() {
  state.score.you = 0;
  state.score.foe = 0;
  state.money = START_MONEY;
  state.kills = 0;
  state.deaths = 0;
  state.matchOver = false;
  state.matchWinner = null;
  state.round = 1;
  weapon.state.owned = { pistol: true, smg: false, rifle: false };
  weapon.state.grenades = 0;
  weapon.select('pistol');
  startBuyPhase();
}

function onBuy(id) {
  if (state.phase !== PHASE.BUY) return;
  if (id === 'grenade') {
    if (state.money < GRENADE.price) {
      audio.denied();
      return;
    }
    state.money -= weapon.buyGrenade();
    audio.buy();
  } else {
    if (weapon.state.owned[id]) {
      weapon.select(id);
      audio.buy();
    } else if (state.money >= WEAPONS[id].price) {
      state.money -= weapon.buy(id);
      weapon.select(id);
      audio.buy();
    } else {
      audio.denied();
      return;
    }
  }
  hud.setMoney(state.money);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name, weapon.state.grenades);
  hud.showBuy(state.money, weapon.state.owned, onBuy);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    audio.unlock();
    hud.hideOverlay();
  } else if (state.phase === PHASE.PLAY && you.alive && !state.matchOver) {
    hud.showOverlay('paused', 0);
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (state.phase === PHASE.MENU) {
    startMatch();
    return;
  }
  if (state.phase === PHASE.ROUND_END) {
    if (state.matchOver) {
      startMatch();
    } else {
      state.round += 1;
      startBuyPhase();
    }
    return;
  }
  if (state.phase === PHASE.BUY) {
    hud.hideBuy();
    return;
  }
  input.requestLock();
});

function syncCamera() {
  camera.position.set(body.x, body.y + body.eye, body.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.x;
  const dy = point.y - (body.y + body.eye);
  const dz = point.z - body.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function step(dt) {
  state.time += dt;
  state.phaseTime += dt;

  if (state.phase === PHASE.BUY) {
    state.timer -= dt;
    player.step(dt, input.state.keys);
    weapon.step(dt);
    syncCamera();
    hud.setTimer(state.timer, 'buy');
    if (state.timer <= 0) {
      state.timer = 0;
      startRound();
    }
    return;
  }

  if (state.phase !== PHASE.PLAY) return;

  state.timer -= dt;
  const look = input.takeLook();
  player.look(look.x, look.y);
  player.step(dt, input.state.keys);
  weapon.setTrigger(input.state.firing);
  weapon.step(dt);

  // Planting: hold E inside Site A while carrying the charge.
  const b = state.bomb;
  if (b.state === BOMB.CARRIED && b.carrier === 'player' && you.alive && pointInSite(body.x, body.z)) {
    if (input.state.keys.has('KeyE')) {
      b.plantProgress += dt;
      if (Math.floor(b.plantProgress * 4) !== Math.floor((b.plantProgress - dt) * 4)) audio.plantTick();
      if (b.plantProgress >= PLANT_SECONDS) plantCharge();
    } else {
      b.plantProgress = Math.max(0, b.plantProgress - dt * 2);
    }
  } else {
    b.plantProgress = 0;
  }

  // Planted charge: fuse ticks, beeps quicken under 10 seconds.
  if (b.state === BOMB.PLANTED) {
    b.timer -= dt;
    const second = Math.ceil(b.timer);
    if (second !== lastBeepSecond) {
      lastBeepSecond = second;
      audio.beep(b.timer < 10);
    }
    const defuser = b.defuser !== null ? bots.bots[b.defuser] : null;
    if (!defuser || !defuser.alive || defuser.mode !== 'defuse') {
      // The defuse only counts while someone is actually holding the channel.
      b.defuseProgress = 0;
      b.defuser = null;
    } else if (b.defuseProgress >= DEFUSE_SECONDS) {
      b.state = BOMB.DEFUSED;
      addFeed(state, `${defuser.name} defused the charge`, 'bad');
      maybeEndRound();
    }
    if (b.timer <= 0) {
      b.timer = 0;
      b.state = BOMB.EXPLODED;
      audio.explosion();
      boomLight.position.set(b.position.x, 1, b.position.z);
      boomLight.intensity = 80;
      maybeEndRound();
    }
  }

  // Bots fight, patrol and defuse; the player shoots.
  bots.step(dt, {
    player: { x: body.x, y: body.y, z: body.z, eye: body.eye, alive: you.alive, speed: player.groundSpeed() },
    onShoot(fromBot, toPos, hit, dmg) {
      fromV.set(fromBot.x, 1.25, fromBot.z);
      endV.set(toPos.x, toPos.y, toPos.z);
      spawnTracer(fromV, endV, fromBot.team === 'foe' ? PALETTE.enemy : PALETTE.ally);
      if (fromBot.team === 'foe') audio.distantShot();
      if (hit && fromBot.team === 'foe') damagePlayer(dmg, fromBot.name);
    },
    onBotDamaged(victim, dmg, killed, byName) {
      if (killed) {
        addFeed(state, `${byName} ▸ ${victim.name}`, victim.team === 'foe' ? 'good' : 'bad');
        if (victim.team === 'foe') maybeEndRound();
      }
    },
  });

  if (input.state.firing) playerShoot();
  if (input.state.keys.has('KeyR')) {
    const was = weapon.state.reloadLeft;
    weapon.reload();
    if (was === 0 && weapon.state.reloadLeft > 0) audio.reload();
  }

  stepGrenades(dt);
  syncBombMesh();

  // Noises older than 1.5 s stop mattering; prune in place, no allocation.
  for (let i = state.noises.length - 1; i >= 0; i -= 1) {
    if (state.time - state.noises[i].at > 1.5) state.noises.splice(i, 1);
  }

  syncCamera();
  maybeEndRound();
}

function handleEdges() {
  if (shot) return;
  if (input.wasPressed('KeyB') && state.phase === PHASE.BUY) {
    if (hud.buyOpen()) hud.hideBuy();
    else hud.showBuy(state.money, weapon.state.owned, onBuy);
  }
  if (input.wasPressed('Digit1')) {
    if (state.phase === PHASE.BUY) onBuy('rifle');
    else if (weapon.select('rifle')) hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name, weapon.state.grenades);
  }
  if (input.wasPressed('Digit2')) {
    if (state.phase === PHASE.BUY) onBuy('smg');
    else if (weapon.select('smg')) hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name, weapon.state.grenades);
  }
  if (input.wasPressed('Digit3')) {
    if (state.phase === PHASE.BUY) onBuy('pistol');
    else if (weapon.select('pistol')) hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name, weapon.state.grenades);
  }
  if (input.wasPressed('Digit4') && state.phase === PHASE.BUY) onBuy('grenade');
  if (input.wasPressed('KeyG') && state.phase === PHASE.PLAY && you.alive) throwGrenade();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    handleEdges();
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;

    // HUD readouts, refreshed every frame from the one state object.
    hud.setHealth(you.hp);
    hud.setMoney(state.money);
    hud.setScore(state.score.you, state.score.foe, state.round);
    hud.setCrosshairGap(5 + weapon.spread(player.groundSpeed()) * 320);
    if (state.phase === PHASE.PLAY) {
      hud.setTimer(state.timer, 'play');
      const b = state.bomb;
      if (b.state === BOMB.PLANTED) {
        hud.setBomb(`CHARGE PLANTED — ${Math.ceil(b.timer)}s`, b.timer < 10 ? 'bomb-danger' : 'bomb-planted');
      } else if (b.state === BOMB.DEFUSED) {
        hud.setBomb('CHARGE DEFUSED', 'bomb-bad');
      } else if (b.state === BOMB.EXPLODED) {
        hud.setBomb('CHARGE DETONATED', 'bomb-danger');
      } else if (b.state === BOMB.DROPPED) {
        hud.setBomb('CHARGE DROPPED — ROUND LIKELY LOST', 'bomb-danger');
      } else if (b.plantProgress > 0) {
        hud.setBomb(`PLANTING… ${Math.round((b.plantProgress / PLANT_SECONDS) * 100)}%`, 'bomb-planted');
      } else if (b.carrier === 'player' && pointInSite(body.x, body.z)) {
        hud.setBomb('HOLD E TO PLANT THE CHARGE', 'bomb-planted');
      } else if (b.carrier === 'player') {
        hud.setBomb('CHARGE WITH YOU — REACH SITE A', '');
      } else {
        hud.setBomb('ALLY CARRIES THE CHARGE', 'bomb-good');
      }
    }
    for (const t of tracers) {
      if (t.life > 0) {
        t.life -= dt;
        if (t.life <= 0) t.mesh.visible = false;
      }
    }
    if (state.phase === PHASE.ROUND_END && !roundEndShown && state.time >= roundEndAt) {
      roundEndShown = true;
      if (state.matchOver) {
        hud.showOverlay(state.matchWinner === 'you' ? 'endWin' : 'endLose', 0);
      } else {
        hud.showOverlay('roundEnd', state.score.you > state.score.foe
          ? `Vanguard leads ${state.score.you}–${state.score.foe}. Buy up and take the next one.`
          : `Sentinels lead ${state.score.foe}–${state.score.you}. Buy up and answer back.`);
      }
    }
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  state.score.you = 2;
  state.score.foe = 1;
  state.round = 3;
  state.money = 2600;
  you.hp = 100;
  you.alive = true;
  state.phase = PHASE.PLAY;
  state.timer = 68;
  weapon.state.owned = { pistol: true, smg: true, rifle: true };
  weapon.select('rifle');
  weapon.state.grenades = 1;
  bots.reset();
  hud.setHealth(100);
  hud.setMoney(state.money);
  hud.setScore(state.score.you, state.score.foe, state.round);
  hud.setTimer(state.timer, 'play');
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name, weapon.state.grenades);

  if (name === 'start') {
    player.reset(SPAWNS.you);
    body.yaw = 0;
    body.pitch = -0.01;
    settle(20);
    hud.showOverlay('start', 0);
  } else if (name === 'buy') {
    // The buy shot shows the shop as a fresh round sees it: pistol owned, rifle
    // and SMG still priced, one grenade affordable.
    weapon.state.owned = { pistol: true, smg: false, rifle: false };
    weapon.select('pistol');
    weapon.state.grenades = 0;
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name, 0);
    player.reset(SPAWNS.you);
    body.yaw = 0.35;
    body.pitch = 0;
    settle(20);
    hud.showBuy(state.money, weapon.state.owned, () => {});
  } else if (name === 'site') {
    state.bomb.state = BOMB.PLANTED;
    state.bomb.carrier = null;
    state.bomb.timer = 21;
    state.bomb.position.x = 2;
    state.bomb.position.y = 0;
    state.bomb.position.z = -16;
    player.reset({ x: 0, z: -8, yaw: 0 });
    const foe = bots.bots[2];
    foe.x = 5;
    foe.z = -14;
    foe.mesh.position.set(5, 0, -14);
    settle(20);
    // Bots shoot back while the scene settles; restore full health for the frame.
    you.hp = 100;
    hud.setHealth(100);
    syncBombMesh();
    hud.setBomb('CHARGE PLANTED — 21s', 'bomb-planted');
    hud.banner('CHARGE PLANTED', 'Hold Site A — 21 seconds to detonation', 'warn', 4000);
    aimAt({ x: 2, y: 1, z: -16 });
  } else {
    // play: a mid-lane firefight, two rifle shots at Rook with tracer and hit marker.
    // Rook drifts while the scene settles, so aim at his live position, not the old one.
    player.reset({ x: 0, z: 6, yaw: 0 });
    const rook = bots.bots[0];
    rook.x = 2.5;
    rook.z = -7;
    rook.mesh.position.set(2.5, 0, -7);
    settle(20);
    aimAt({ x: rook.x, y: 1.3, z: rook.z });
    for (let round = 0; round < 2; round += 1) {
      playerShoot();
      settle(6);
    }
    settle(2);
    // Bots shoot back while the scene settles; restore full health for the frame.
    you.hp = 100;
    hud.setHealth(100);
  }
  syncCamera();
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
hud.setHealth(100);
hud.setMoney(START_MONEY);
hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name, 0);
if (shot) runShot(shot);
else requestAnimationFrame(frame);
window.__gameReady = true;

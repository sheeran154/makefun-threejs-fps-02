// Sentinel and Vanguard bots: they walk waypoint routes, hold Site A, see the player
// (a real line-of-sight raycast, staggered so only one check runs per bot per tick),
// hear gunfire (noise events in the central state pull them to investigate), burst-fire
// back with distance falloff and a moving-target penalty, and converge on a planted
// charge to defuse it. Allies use the same brain with team 'you'.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { ROUTES, SITE_HOLDS } from './world.js';
import { BOMB, PLANT_SECONDS, BOMB_SECONDS, addFeed } from './state.js';

const BOT_RADIUS = 0.34;
const BOT_HEIGHT = 1.72;
const EYE_HEIGHT = 1.55;
const PATROL_SPEED = 3.1;
const ENGAGE_SPEED = 4.3;
const HEAR_RADIUS = 26;
const SEE_RANGE = 46;
const BURST_MIN = 3;
const BURST_MAX = 5;
const SHOT_GAP = 0.12;
const BURST_PAUSE = 0.95;

const FOE_NAMES = ['Rook', 'Vex', 'Hale', 'Sable'];
const ALLY_NAMES = ['Wren', 'Juno'];

export function createBots(scene, colliders, shootables, state, random) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 60;
  const eye = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  const foeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#a83a30'), roughness: 0.7, metalness: 0.15 });
  const allyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ally), roughness: 0.7, metalness: 0.15 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hazardDark), roughness: 0.7, metalness: 0.2 });
  const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.8, metalness: 0.0 });
  const foeVisor = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.enemy), roughness: 0.3, metalness: 0.1, emissive: new THREE.Color('#5a0f0a') });
  const allyVisor = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ally), roughness: 0.3, metalness: 0.1, emissive: new THREE.Color('#0a3a2e') });

  const bots = [];
  const hitMeshes = [];

  function buildMesh(bot) {
    const g = new THREE.Group();
    const teamMat = bot.team === 'foe' ? foeMat : allyMat;
    const visorMat = bot.team === 'foe' ? foeVisor : allyVisor;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.8, 0.26), darkMat);
    legs.position.y = 0.4;
    legs.userData = { bot, part: 'body' };
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.62, 0.32), teamMat);
    torso.position.y = 1.11;
    torso.userData = { bot, part: 'body' };
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), skinMat);
    head.position.y = 1.57;
    head.userData = { bot, part: 'head' };
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.02), visorMat);
    visor.position.set(0, 1.59, -0.16);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.62), darkMat);
    gun.position.set(0.28, 1.25, -0.25);
    g.add(legs, torso, head, visor, gun);
    g.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        if (child.userData.bot) hitMeshes.push(child);
      }
    });
    scene.add(g);
    return g;
  }

  function makeBot(id, team, name, spawn, route, role) {
    const bot = {
      id, team, name,
      hp: 100, alive: true,
      x: spawn.x, z: spawn.z, y: 0,
      yaw: spawn.yaw,
      route, routeIndex: 0, role,
      hold: role === 'hold' ? SITE_HOLDS[id % SITE_HOLDS.length] : null,
      mode: 'patrol', // patrol | engage | investigate | defuse | converge
      investigate: { x: 0, z: 0 },
      lastSeen: -99,
      losTimer: random() * 0.15, // staggered line-of-sight checks
      seesPlayer: false,
      target: null, // {x, y, z} of the current enemy, or null
      burstLeft: 0,
      shotTimer: 0,
      burstTimer: 0,
      aimTime: 0,
      defuseHeld: 0,
      mesh: null,
    };
    bot.mesh = buildMesh(bot);
    bot.mesh.position.set(bot.x, 0, bot.z);
    bot.mesh.rotation.y = bot.yaw;
    bots.push(bot);
    return bot;
  }

  function spawnAll() {
    const defs = [
      { team: 'foe', name: FOE_NAMES[0], spawn: { x: -8, z: -15.5, yaw: Math.PI }, route: ROUTES.west, role: 'push' },
      { team: 'foe', name: FOE_NAMES[1], spawn: { x: 0, z: -16.5, yaw: Math.PI }, route: ROUTES.mid, role: 'hold' },
      { team: 'foe', name: FOE_NAMES[2], spawn: { x: 8, z: -15.5, yaw: Math.PI }, route: ROUTES.east, role: 'push' },
      { team: 'foe', name: FOE_NAMES[3], spawn: { x: -16, z: -10, yaw: Math.PI }, route: ROUTES.west, role: 'hold' },
      { team: 'you', name: ALLY_NAMES[0], spawn: { x: -3.5, z: 15.5, yaw: 0 }, route: ROUTES.east, role: 'push' },
      { team: 'you', name: ALLY_NAMES[1], spawn: { x: 3.5, z: 15.5, yaw: 0 }, route: ROUTES.mid, role: 'push' },
    ];
    for (let i = 0; i < defs.length; i += 1) {
      const d = defs[i];
      makeBot(i, d.team, d.name, d.spawn, d.route, d.role);
    }
  }

  spawnAll();

  // AABB probe shared by every bot move: one axis at a time, no allocation.
  const probe = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
  function overlaps(x, z) {
    probe.minX = x - BOT_RADIUS;
    probe.minY = 0.04;
    probe.minZ = z - BOT_RADIUS;
    probe.maxX = x + BOT_RADIUS;
    probe.maxY = BOT_HEIGHT - 0.04;
    probe.maxZ = z + BOT_RADIUS;
    for (let i = 0; i < colliders.length; i += 1) {
      const c = colliders[i];
      if (probe.minX < c.max.x && probe.maxX > c.min.x
        && probe.minY < c.max.y && probe.maxY > c.min.y
        && probe.minZ < c.max.z && probe.maxZ > c.min.z) return true;
    }
    return false;
  }

  function moveToward(bot, tx, tz, speed, dt) {
    const dx = tx - bot.x;
    const dz = tz - bot.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.25) return true;
    const stepX = (dx / dist) * speed * dt;
    const stepZ = (dz / dist) * speed * dt;
    bot.yaw = Math.atan2(-dx, -dz);
    if (!overlaps(bot.x + stepX, bot.z)) bot.x += stepX;
    if (!overlaps(bot.x, bot.z + stepZ)) bot.z += stepZ;
    return Math.hypot(tx - bot.x, tz - bot.z) < 0.35;
  }

  function hasLineOfSight(bx, by, bz, tx, ty, tz) {
    eye.set(bx, by, bz);
    dir.set(tx - bx, ty - by, tz - bz);
    const dist = dir.length();
    if (dist > SEE_RANGE) return false;
    dir.divideScalar(dist || 1);
    raycaster.set(eye, dir);
    raycaster.far = dist;
    const hit = raycaster.intersectObjects(shootables, false)[0];
    return !hit;
  }

  function nearestEnemy(bot, others) {
    let best = null;
    let bestDist = Infinity;
    for (const other of others) {
      if (!other.alive || other.team === bot.team) continue;
      const d = Math.hypot(other.x - bot.x, other.z - bot.z);
      if (d < bestDist) {
        bestDist = d;
        best = other;
      }
    }
    return best;
  }

  function damage(bot, amount, part) {
    if (!bot.alive) return false;
    bot.hp -= amount;
    if (bot.hp <= 0) {
      bot.hp = 0;
      bot.alive = false;
      bot.mesh.rotation.x = -Math.PI / 2;
      bot.mesh.position.y = 0.25;
      return true;
    }
    return false;
  }

  function reset() {
    const spawns = [
      { x: -8, z: -15.5, yaw: Math.PI }, { x: 0, z: -16.5, yaw: Math.PI },
      { x: 8, z: -15.5, yaw: Math.PI }, { x: -16, z: -10, yaw: Math.PI },
      { x: -3.5, z: 15.5, yaw: 0 }, { x: 3.5, z: 15.5, yaw: 0 },
    ];
    for (let i = 0; i < bots.length; i += 1) {
      const bot = bots[i];
      const s = spawns[i];
      bot.hp = 100;
      bot.alive = true;
      bot.x = s.x;
      bot.z = s.z;
      bot.yaw = s.yaw;
      bot.routeIndex = 0;
      bot.mode = 'patrol';
      bot.seesPlayer = false;
      bot.target = null;
      bot.burstLeft = 0;
      bot.aimTime = 0;
      bot.defuseHeld = 0;
      bot.mesh.rotation.set(0, bot.yaw, 0);
      bot.mesh.position.set(bot.x, 0, bot.z);
    }
  }

  // ctx: { player, allies (bots list), onShoot(fromBot, toPos, hit, damage), onNoise(x, z, radius) }
  function step(dt, ctx) {
    const player = ctx.player;
    for (const bot of bots) {
      if (!bot.alive) continue;

      // --- Hearing: a recent noise inside the radius pulls the bot to investigate. ---
      if (bot.mode === 'patrol' || bot.mode === 'investigate') {
        for (let i = 0; i < state.noises.length; i += 1) {
          const n = state.noises[i];
          const d = Math.hypot(n.x - bot.x, n.z - bot.z);
          if (d < Math.min(n.radius, HEAR_RADIUS) && state.time - n.at < 1.2) {
            bot.mode = 'investigate';
            bot.investigate.x = n.x;
            bot.investigate.z = n.z;
            break;
          }
        }
      }

      // --- Vision: staggered LOS check against the player (foes) or a foe (allies). ---
      bot.losTimer -= dt;
      if (bot.losTimer <= 0) {
        bot.losTimer = 0.15;
        if (bot.team === 'foe') {
          const sees = player.alive
            && hasLineOfSight(bot.x, EYE_HEIGHT, bot.z, player.x, player.y + player.eye, player.z);
          bot.seesPlayer = sees;
          if (sees) {
            // A beat to react before the first burst: the player gets a second.
            if (bot.mode !== 'engage') {
              bot.burstLeft = 0;
              bot.burstTimer = 1.1;
            }
            bot.mode = 'engage';
            bot.lastSeen = state.time;
            bot.target = { x: player.x, y: player.y + player.eye, z: player.z };
          } else if (bot.mode === 'engage' && state.time - bot.lastSeen > 2.5) {
            bot.mode = bot.role === 'hold' ? 'patrol' : 'investigate';
            bot.investigate.x = player.x;
            bot.investigate.z = player.z;
          }
        } else {
          const foe = nearestEnemy(bot, bots);
          if (foe && hasLineOfSight(bot.x, EYE_HEIGHT, bot.z, foe.x, 1.2, foe.z)) {
            bot.mode = 'engage';
            bot.lastSeen = state.time;
            bot.target = { x: foe.x, y: 1.2, z: foe.z };
            bot.targetBot = foe;
          } else if (bot.mode === 'engage' && state.time - bot.lastSeen > 2.5) {
            bot.mode = 'patrol';
            bot.targetBot = null;
          }
        }
      }

      // --- Bomb duty beats patrol: foes converge on a planted charge to defuse,
      // and an ally carrying the charge walks it to Site A to plant it. ---
      if (state.bomb.state === 'planted' && bot.team === 'foe' && bot.mode !== 'engage') {
        bot.mode = 'converge';
      }
      if (bot.team === 'you' && state.bomb.state === BOMB.CARRIED && state.bomb.carrier === bot.id) {
        bot.mode = 'plant';
      }

      // --- Movement by mode. ---
      if (bot.mode === 'plant') {
        // Walk the charge into Site A, then channel the plant.
        if (moveToward(bot, 2, -16, ENGAGE_SPEED, dt)) {
          state.bomb.plantProgress += dt;
          if (state.bomb.plantProgress >= PLANT_SECONDS) {
            state.bomb.state = BOMB.PLANTED;
            state.bomb.carrier = null;
            state.bomb.timer = BOMB_SECONDS;
            state.bomb.plantProgress = 0;
            state.bomb.position.x = bot.x;
            state.bomb.position.y = 0;
            state.bomb.position.z = bot.z;
            bot.mode = 'patrol';
            addFeed(state, `${bot.name} planted the charge`, 'bad');
          }
        }
      } else if (bot.mode === 'engage' && bot.target) {
        const d = Math.hypot(bot.target.x - bot.x, bot.target.z - bot.z);
        if (d > 14) moveToward(bot, bot.target.x, bot.target.z, ENGAGE_SPEED, dt);
        else bot.yaw = Math.atan2(-(bot.target.x - bot.x), -(bot.target.z - bot.z));
        bot.aimTime += dt;
      } else if (bot.mode === 'investigate') {
        if (moveToward(bot, bot.investigate.x, bot.investigate.z, PATROL_SPEED + 0.6, dt)) {
          bot.mode = 'patrol';
        }
      } else if (bot.mode === 'converge') {
        const bp = state.bomb.position;
        if (moveToward(bot, bp.x, bp.z, ENGAGE_SPEED, dt)) {
          bot.mode = 'defuse';
          bot.defuseHeld = 0;
        }
      } else if (bot.mode === 'defuse') {
        const bp = state.bomb.position;
        bot.yaw = Math.atan2(-(bp.x - bot.x), -(bp.z - bot.z));
        bot.defuseHeld += dt;
        state.bomb.defuseProgress = bot.defuseHeld;
        state.bomb.defuser = bot.id;
      } else if (bot.role === 'hold' && bot.hold) {
        // Site holders shuffle between hold points near Site A.
        if (moveToward(bot, bot.hold.x, bot.hold.z, PATROL_SPEED, dt)) {
          bot.hold = SITE_HOLDS[(bot.id + 1) % SITE_HOLDS.length];
        }
      } else {
        const stop = bot.route[bot.routeIndex];
        if (stop && moveToward(bot, stop.x, stop.z, PATROL_SPEED, dt)) {
          bot.routeIndex = (bot.routeIndex + 1) % bot.route.length;
        }
      }

      // --- Shooting: bursts while engaging, with a hit roll per shot. ---
      if (bot.mode === 'engage' && bot.target) {
        bot.burstTimer -= dt;
        if (bot.burstLeft <= 0 && bot.burstTimer <= 0) {
          bot.burstLeft = BURST_MIN + Math.floor(random() * (BURST_MAX - BURST_MIN + 1));
          bot.burstTimer = BURST_PAUSE;
        }
        if (bot.burstLeft > 0) {
          bot.shotTimer -= dt;
          if (bot.shotTimer <= 0) {
            bot.shotTimer = SHOT_GAP;
            bot.burstLeft -= 1;
            fireShot(bot, ctx);
          }
        }
      }

      bot.mesh.position.set(bot.x, 0, bot.z);
      bot.mesh.rotation.y = bot.yaw;
    }
  }

  function fireShot(bot, ctx) {
    if (!bot.target) return;
    const player = ctx.player;
    tmp.set(bot.x, 1.25, bot.z);
    const dist = Math.hypot(bot.target.x - bot.x, bot.target.z - bot.z);
    let hit = false;
    let dmg = 0;
    if (bot.team === 'foe') {
      // Hit chance falls with range and with the target's speed; sustained aim helps.
      const speedPenalty = Math.min(0.18, player.speed * 0.03);
      const aimBonus = Math.min(0.12, bot.aimTime * 0.05);
      const chance = Math.max(0.06, 0.42 - dist * 0.009 - speedPenalty + aimBonus);
      hit = random() < chance;
      if (hit) dmg = Math.max(4, Math.round(11 * Math.max(0.45, 1 - dist / 70)));
      ctx.onShoot(bot, { x: player.x, y: player.y + player.eye, z: player.z }, hit, dmg);
    } else if (bot.targetBot && bot.targetBot.alive) {
      const chance = Math.max(0.1, 0.5 - dist * 0.008);
      hit = random() < chance;
      if (hit) dmg = Math.max(5, Math.round(16 * Math.max(0.45, 1 - dist / 70)));
      ctx.onShoot(bot, { x: bot.targetBot.x, y: 1.2, z: bot.targetBot.z }, hit, dmg);
      if (hit) {
        const killed = damage(bot.targetBot, dmg, 'body');
        ctx.onBotDamaged(bot.targetBot, dmg, killed, bot.name);
      }
    }
    // Bot gunfire is loud: nearby enemies hear it and come looking.
    state.noises.push({ x: bot.x, z: bot.z, radius: 20, at: state.time });
  }

  function aliveCount(team) {
    let n = 0;
    for (const bot of bots) if (bot.alive && bot.team === team) n += 1;
    return n;
  }

  return {
    bots,
    hitMeshes,
    step,
    reset,
    damage,
    aliveCount,
  };
}

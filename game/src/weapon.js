// DUSTLINE arsenal: one pistol, one SMG, one rifle, one frag grenade. The table owns
// every number — price, damage, headshot multiplier, magazine, rate, reload, spread —
// so the buy menu, the HUD and the shooting code all read the same truth. The view
// model is built per weapon from plain boxes; a muzzle flash plane and a point light
// on the camera sell each shot.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', price: 0, damage: 26, headMult: 2.2,
    mag: 12, reserve: 48, gap: 0.17, auto: false, reload: 1.4,
    spreadStill: 0.004, spreadMove: 0.03, recoil: 0.006, kick: 0.035,
    length: 0.3, barrel: 0.12,
  },
  smg: {
    id: 'smg', name: 'K9 Rattler', price: 1500, damage: 21, headMult: 2.0,
    mag: 28, reserve: 112, gap: 0.075, auto: true, reload: 1.7,
    spreadStill: 0.006, spreadMove: 0.034, recoil: 0.005, kick: 0.028,
    length: 0.52, barrel: 0.22,
  },
  rifle: {
    id: 'rifle', name: 'VK-7 Longshot', price: 2700, damage: 34, headMult: 2.2,
    mag: 25, reserve: 100, gap: 0.1, auto: true, reload: 2.1,
    spreadStill: 0.002, spreadMove: 0.026, recoil: 0.011, kick: 0.055,
    length: 0.72, barrel: 0.34,
  },
};

export const GRENADE = {
  id: 'grenade', name: 'FL-2 Frag', price: 300, fuse: 1.8, radius: 6.5, damage: 120,
};

const MUZZLE_TIME = 0.06;

export function createWeapon(camera) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hazardDark), roughness: 0.6, metalness: 0.3 });
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.pipe), roughness: 0.4, metalness: 0.6 });
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.crate), roughness: 0.85, metalness: 0.05 });

  // One view model per weapon; select() swaps which group is on the camera.
  const models = {};
  function buildModel(def) {
    const g = new THREE.Group();
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.1, def.length * 0.62), metal);
    g.add(receiver);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, def.barrel), dark);
    barrel.position.set(0, 0.02, -(def.length * 0.31 + def.barrel / 2));
    g.add(barrel);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.075, def.length * 0.3), grip);
    stock.position.set(0, -0.02, def.length * 0.42);
    g.add(stock);
    if (def.id === 'rifle') {
      const scope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.16), dark);
      scope.position.set(0, 0.08, -0.05);
      g.add(scope);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.05), grip);
      hand.position.set(0, -0.09, -0.2);
      g.add(hand);
    }
    if (def.id === 'smg') {
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.07), dark);
      mag.position.set(0, -0.12, 0.02);
      mag.rotation.x = 0.12;
      g.add(mag);
    }
    g.position.set(0.26, -0.22, -0.55);
    g.rotation.y = -0.05; // a slight inward angle, like a held rifle
    g.visible = false;
    camera.add(g);
    return g;
  }
  for (const def of Object.values(WEAPONS)) models[def.id] = buildModel(def);
  models.pistol.visible = true; // the starting weapon shows from the first frame

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9,
      depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  flash.position.set(0.26, -0.18, -0.98);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.26, -0.16, -0.7);
  camera.add(flashLight);

  const state = {
    current: 'pistol',
    owned: { pistol: true, smg: false, rifle: false },
    mag: WEAPONS.pistol.mag,
    reserve: WEAPONS.pistol.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    grenades: 0,
    triggerHeld: false,
    triggerLatch: false, // for semi-auto: fire once per press
  };

  function def() {
    return WEAPONS[state.current];
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.current];
    model.position.z = -0.55 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash > 0 ? state.flash * 34 : 0;
    flashLight.intensity = state.flash > 0 ? 16 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const d = def();
      model.rotation.x = -0.55 * Math.min(1, (d.reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = d.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    def,
    step,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    // Semi-auto weapons fire on the press edge; automatics fire while held.
    // main.js calls setTrigger() every fixed step from the mouse state.
    setTrigger(held) {
      state.triggerHeld = held;
      if (!held) state.triggerLatch = false;
    },
    wantFire() {
      if (!state.triggerHeld) return false;
      if (def().auto) return true;
      if (state.triggerLatch) return false;
      state.triggerLatch = true;
      return true;
    },
    pullTrigger() {
      const d = def();
      state.cooldown = d.gap;
      state.flash = MUZZLE_TIME;
      state.kick = d.kick;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      const d = def();
      if (state.reloadLeft > 0 || state.mag === d.mag || state.reserve === 0) return;
      state.reloadLeft = d.reload;
    },
    spread(speed) {
      const d = def();
      return d.spreadStill + Math.min(1, speed / 5.4) * d.spreadMove;
    },
    select(id) {
      if (!state.owned[id] || state.current === id) return false;
      models[state.current].visible = false;
      state.current = id;
      const d = def();
      state.mag = d.mag;
      state.reserve = d.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      models[id].visible = true;
      return true;
    },
    buy(id) {
      if (state.owned[id]) return 0;
      state.owned[id] = true;
      return WEAPONS[id].price;
    },
    buyGrenade() {
      state.grenades += 1;
      return GRENADE.price;
    },
    takeGrenade() {
      if (state.grenades <= 0) return false;
      state.grenades -= 1;
      return true;
    },
    refillAmmo() {
      const d = def();
      state.mag = d.mag;
      state.reserve = d.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
  };
}

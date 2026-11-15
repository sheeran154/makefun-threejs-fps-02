// The DOM HUD for DUSTLINE: crosshair, hit marker, health, money, ammo, round timer
// and score, kill feed, round banners, bomb status, the buy menu and the one overlay
// panel. It never touches the simulation; main.js pushes numbers in and reads the
// play / buy callbacks out. Every setter caches its last value so the DOM is only
// written when something actually changed.
import { GRENADE, WEAPONS } from './weapon.js';

const OVERLAY_COPY = {
  start: {
    title: 'DUSTLINE',
    copy: 'Kestrel Yard at dusk. Plant the charge at Site A or drop every Sentinel. First to 5 rounds takes the match.',
    action: 'Click to play',
  },
  paused: {
    title: 'DUSTLINE',
    copy: 'Paused. Click to resume the round.',
    action: 'Click to resume',
  },
  endWin: {
    title: 'Match won',
    copy: 'Vanguard takes Kestrel Yard. The charge did its work.',
    action: 'Play again',
  },
  endLose: {
    title: 'Match lost',
    copy: 'The Sentinels held the yard this time.',
    action: 'Play again',
  },
  roundEnd: {
    title: 'Round over',
    copy: '',
    action: 'Next round',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const overlayTitle = $('overlay-title');
  const overlayCopy = $('overlay-copy');
  const playBtn = $('play');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const moneyEl = $('money');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const grenadeCount = $('grenade-count');
  const timerEl = $('timer');
  const scoreEl = $('score-value');
  const roundEl = $('round-label');
  const feedEl = $('feed');
  const bannerEl = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const bombEl = $('bomb-status');
  const buyMenu = $('buy-menu');
  const buyMoney = $('buy-money');
  const buyItems = $('buy-items');
  const damageFlash = $('damage-flash');

  let lastHealth = -1;
  let lastMoney = -1;
  let lastMag = -1;
  let lastReserve = -1;
  let lastWeapon = '';
  let lastGrenades = -1;
  let lastTimer = '';
  let lastScore = '';
  let lastBomb = '';
  let lastGap = -1;
  let hitTimer = 0;
  let bannerTimer = 0;

  function fmtTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return {
    setHealth(hp) {
      const v = Math.max(0, Math.round(hp));
      if (v === lastHealth) return;
      lastHealth = v;
      healthFill.style.width = `${v}%`;
      healthNum.textContent = String(v);
      healthFill.classList.toggle('low', v <= 30);
    },
    setMoney(m) {
      if (m === lastMoney) return;
      lastMoney = m;
      moneyEl.textContent = `$${m}`;
      if (buyMenu && !buyMenu.hidden) buyMoney.textContent = `$${m}`;
    },
    setAmmo(mag, reserve, name, grenades) {
      if (mag !== lastMag || reserve !== lastReserve) {
        lastMag = mag;
        lastReserve = reserve;
        ammoMag.textContent = String(mag);
        ammoReserve.textContent = `/ ${reserve}`;
        ammoMag.parentElement.classList.toggle('empty', mag === 0);
      }
      if (name !== lastWeapon) {
        lastWeapon = name;
        weaponName.textContent = name;
      }
      if (grenades !== lastGrenades) {
        lastGrenades = grenades;
        grenadeCount.textContent = `◉ ${grenades}`;
      }
    },
    setTimer(seconds, phase) {
      const text = phase === 'buy' ? `BUY ${fmtTime(seconds)}` : fmtTime(seconds);
      if (text === lastTimer) return;
      lastTimer = text;
      timerEl.textContent = text;
      timerEl.classList.toggle('buy', phase === 'buy');
    },
    setScore(you, foe, round) {
      const text = `YOU ${you} — ${foe} FOE · ROUND ${round}`;
      if (text === lastScore) return;
      lastScore = text;
      scoreEl.textContent = text;
      roundEl.textContent = `ROUND ${round}`;
    },
    setBomb(text, tone) {
      if (text === lastBomb) return;
      lastBomb = text;
      bombEl.textContent = text;
      bombEl.className = tone ? `bomb-${tone}` : '';
    },
    setCrosshairGap(px) {
      const v = Math.round(px);
      if (v === lastGap) return;
      lastGap = v;
      crosshair.style.setProperty('--gap', `${v}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      damageFlash.classList.remove('on');
      void damageFlash.offsetWidth; // restart the CSS animation
      damageFlash.classList.add('on');
    },
    addFeed(text, tone) {
      const line = document.createElement('div');
      line.className = `feed-line ${tone || 'info'}`;
      line.textContent = text;
      feedEl.prepend(line);
      while (feedEl.children.length > 5) feedEl.removeChild(feedEl.lastChild);
      setTimeout(() => {
        if (line.parentElement) line.classList.add('fade');
      }, 4200);
    },
    banner(text, sub, tone, ms = 2600) {
      bannerTitle.textContent = text;
      bannerSub.textContent = sub || '';
      bannerEl.className = `show ${tone || 'info'}`;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { bannerEl.className = ''; }, ms);
    },
    showOverlay(mode, detail) {
      const text = OVERLAY_COPY[mode];
      overlayTitle.textContent = text.title;
      overlayCopy.textContent = mode === 'roundEnd' ? (detail || text.copy) : text.copy;
      playBtn.textContent = text.action;
      overlay.hidden = false;
      playBtn.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      playBtn.addEventListener('click', handler);
    },
    showBuy(money, owned, onBuy) {
      buyMoney.textContent = `$${money}`;
      buyItems.innerHTML = '';
      const rows = [
        { id: 'rifle', name: WEAPONS.rifle.name, price: WEAPONS.rifle.price, desc: '34 dmg · 25 rnd · steady at range', key: '1' },
        { id: 'smg', name: WEAPONS.smg.name, price: WEAPONS.smg.price, desc: '21 dmg · 28 rnd · fast up close', key: '2' },
        { id: 'pistol', name: WEAPONS.pistol.name, price: WEAPONS.pistol.price, desc: '26 dmg · 12 rnd · always yours', key: '3' },
        { id: 'grenade', name: GRENADE.name, price: GRENADE.price, desc: 'Frag · 120 dmg in 6.5 m · press G', key: '4' },
      ];
      for (const row of rows) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'buy-item';
        const isOwned = row.id === 'pistol' ? true : owned[row.id];
        const canAfford = money >= row.price;
        item.disabled = (row.id !== 'grenade' && isOwned) || !canAfford;
        item.innerHTML = `<span class="buy-key">${row.key}</span><span class="buy-name">${row.name}</span>`
          + `<span class="buy-desc">${row.desc}</span><span class="buy-price">${isOwned && row.id !== 'grenade' ? 'OWNED' : '$' + row.price}</span>`;
        item.addEventListener('click', () => onBuy(row.id));
        buyItems.appendChild(item);
      }
      buyMenu.hidden = false;
    },
    hideBuy() {
      buyMenu.hidden = true;
    },
    buyOpen() {
      return buyMenu && !buyMenu.hidden;
    },
  };
}

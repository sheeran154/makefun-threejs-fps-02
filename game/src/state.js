// The one central state object. Every module reads or writes through this, so the
// whole match — phase, round, money, bomb, teams — lives in a single place and the
// fixed-step simulation can be driven, inspected and reset from main.js alone.
export const PHASE = {
  MENU: 'menu',
  BUY: 'buy',
  PLAY: 'play',
  ROUND_END: 'roundEnd',
};

export const BOMB = {
  CARRIED: 'carried',
  PLANTED: 'planted',
  DEFUSED: 'defused',
  EXPLODED: 'exploded',
  DROPPED: 'dropped',
};

export const ROUND_SECONDS = 100;
export const BUY_SECONDS = 14;
export const PLANT_SECONDS = 3;
export const DEFUSE_SECONDS = 5;
export const BOMB_SECONDS = 35;
export const WIN_ROUNDS = 5; // first to 5 rounds takes the match
export const START_MONEY = 800;
export const WIN_MONEY = 3000;
export const LOSS_MONEY = 1400;
export const KILL_MONEY = 300;
export const PLANT_MONEY = 300;

export function createState(random) {
  return {
    random,
    phase: PHASE.MENU,
    round: 1,
    score: { you: 0, foe: 0 },
    money: START_MONEY,
    kills: 0,
    deaths: 0,
    timer: ROUND_SECONDS, // counts down during PLAY, counts up during BUY
    phaseTime: 0, // seconds spent in the current phase
    matchOver: false,
    matchWinner: null, // 'you' | 'foe' | null
    // Bomb objective.
    bomb: {
      state: BOMB.CARRIED,
      carrier: 'player', // 'player' | bot id | null once planted/dropped
      timer: BOMB_SECONDS,
      plantProgress: 0,
      defuseProgress: 0,
      defuser: null, // bot id currently defusing
      position: { x: 0, y: 0, z: 0 },
    },
    // Noise events bots can hear: {x, z, radius, at}. Cleared each step.
    noises: [],
    // Kill feed lines, newest first, capped by hud.
    feed: [],
    time: 0, // total simulated seconds since match start
  };
}

export function resetForRound(state, roundNumber) {
  state.round = roundNumber;
  state.timer = ROUND_SECONDS;
  state.phaseTime = 0;
  state.bomb.state = BOMB.CARRIED;
  state.bomb.carrier = 'player';
  state.bomb.timer = BOMB_SECONDS;
  state.bomb.plantProgress = 0;
  state.bomb.defuseProgress = 0;
  state.bomb.defuser = null;
  state.bomb.position.x = 0;
  state.bomb.position.y = 0;
  state.bomb.position.z = 0;
  state.noises.length = 0;
  state.feed.length = 0;
}

export function addFeed(state, text, tone) {
  state.feed.unshift({ text, tone: tone || 'info', at: state.time });
  if (state.feed.length > 5) state.feed.length = 5;
}

// DUSTLINE look plan: dusk industrial yard, teal shadows against warm orange sun.
// Every colour in the game comes from this one object; the same names drive the CSS.
export const PALETTE = {
  skyTop: '#1d2f45', // deep dusk blue, top of the sky dome
  skyLow: '#e2703a', // burnt orange horizon
  fog: '#3a2f33', // dusty mauve fog between the two
  canvas: '#14161a', // page background behind the canvas
  ground: '#3b3a38', // concrete yard
  groundDark: '#2c2b29', // worn concrete patches
  wall: '#4a4d52', // corrugated perimeter walls
  wallTop: '#5d6066', // wall coping strip
  crate: '#8a6b46', // wooden crates
  crateDark: '#6e5436', // crate shadow faces
  containerTeal: '#2e6f6a', // teal shipping container
  containerRust: '#a5502e', // rust-orange shipping container
  containerSand: '#b3905a', // sand container
  pipe: '#7a7f85', // steel pipes and ducts
  hazard: '#e8a13a', // site marking, hazard stripes
  hazardDark: '#2b2b2b',
  ink: '#f2ede3', // HUD text, warm off-white
  muted: '#9aa3a7', // secondary HUD text
  accent: '#ff9a3d', // muzzle flash, tracers, hit markers
  enemy: '#e0483e', // Sentinel red: visors, tracers, kill feed
  ally: '#4fc3a1', // Vanguard teal: ally markers
  health: '#7ed491', // health bar
  money: '#ffd166', // money readout
};

export function hex(name) {
  return PALETTE[name];
}

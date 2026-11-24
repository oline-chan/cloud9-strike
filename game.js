/* Cloud9 Strike — first-person tactical shooter (raycasting, Wolfenstein-style).
   Vanilla JS, no dependencies. Original assets only (no Riot IP).
   Player "Volt" always attacks with 2 ally bots vs 3 defender bots.
   First to 5 rounds wins the match. */
(function () {
'use strict';

// ================= Config =================
var CELL = 64;
var WIN_ROUNDS = 5;
var FOV_TAN = 0.8; // tan(FOV/2) -> FOV ~77 degrees
var RAYS = 480; // 2 px per column — smoother walls, still cheap DDA
var SENS = 0.0022; // base mouse-look sensitivity (rad per px)
var CFG = {
  buyTime: 15,
  combatTime: 120,
  plantTime: 3,
  explodeTime: 38,
  defuseTime: 5,
  sightRange: 640,
  hearRange: 560,
  startCredits: 800,
  killCredits: 200,
  winCredits: 800,
  lossCredits: 400
};

var WEAPONS = {
  pistol: { name: 'Pistol', price: 0,   dmg: 25, rate: 300, mag: 12, reserve: 36, range: 460, spread: 0.030, reload: 1.3, speed: 210, auto: false, sound: 520, len: 0.45 },
  smg:    { name: 'SMG',    price: 600, dmg: 18, rate: 110, mag: 25, reserve: 75, range: 400, spread: 0.060, reload: 1.6, speed: 220, auto: true,  sound: 700, len: 0.55 },
  rifle:  { name: 'Rifle',  price: 1200,dmg: 30, rate: 130, mag: 25, reserve: 75, range: 560, spread: 0.035, reload: 1.8, speed: 200, auto: true,  sound: 420, len: 0.8 },
  sniper: { name: 'Sniper', price: 1800,dmg: 90, rate: 900, mag: 5,  reserve: 15, range: 760, spread: 0.005, reload: 2.4, speed: 180, auto: false, sound: 240, len: 1.0 }
};
var ARMOR_PRICE = 400;
var ARMOR_MAX = 50;

// Map legend: '#' wall, 'C' crate wall, '.' floor, 'A' site A, 'B' site B,
// 'S' attacker spawn floor. 30 x 20 cells — bigger arena so rounds last
// longer: three lanes (left / mid / right), more cover, longer rotations.
var MAP = [
  '##############################',
  '#AA......##......##.......BB.#',
  '#AA......##......##.......BB.#',
  '#AA..C...##..C...##...C...BB.#',
  '#............................#',
  '#..C.....##......##......C...#',
  '#............................#',
  '#..##.........##........##...#',
  '#..##...C.....##...C....##...#',
  '#............................#',
  '#.....C.....####.....C.......#',
  '#............................#',
  '#..##.....C......C.....##....#',
  '#..##..................##....#',
  '#......C......##......C......#',
  '#............................#',
  '#..C.....##......##......C...#',
  '#............................#',
  '#...S.......S.......S........#',
  '##############################'
];
var MW = MAP[0].length, MH = MAP.length;
var ARENA = { W: 960, H: 600 };

// ================= Utils =================
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function dist(x1, y1, x2, y2) { var dx = x2 - x1, dy = y2 - y1; return Math.sqrt(dx * dx + dy * dy); }
function angleTo(x1, y1, x2, y2) { return Math.atan2(y2 - y1, x2 - x1); }
function rand(a, b) { return a + Math.random() * (b - a); }
function fmtTime(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function $(id) { return document.getElementById(id); }
function cellAt(cx, cy) {
  if (cx < 0 || cy < 0 || cx >= MW || cy >= MH) return '#';
  return MAP[cy][cx];
}
function isSolidCell(cx, cy) { var c = cellAt(cx, cy); return c === '#' || c === 'C'; }
function isSolidAt(wx, wy) { return isSolidCell(Math.floor(wx / CELL), Math.floor(wy / CELL)); }
function cellTypeAt(wx, wy) { return cellAt(Math.floor(wx / CELL), Math.floor(wy / CELL)); }
function cellCenter(cx, cy) { return { x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 }; }
function findCells(type) {
  var out = [];
  for (var y = 0; y < MH; y++) for (var x = 0; x < MW; x++) if (MAP[y][x] === type) out.push({ x: x, y: y });
  return out;
}
// Line of sight, sampled. useSmoke=true means smoke clouds block the line.
function hasLOS(x1, y1, x2, y2, useSmoke, smokes) {
  var d = dist(x1, y1, x2, y2), steps = Math.max(1, Math.ceil(d / 8));
  for (var i = 1; i < steps; i++) {
    var t = i / steps, x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
    if (isSolidAt(x, y)) return false;
    if (useSmoke && smokes) {
      for (var j = 0; j < smokes.length; j++) {
        if (dist(x, y, smokes[j].x, smokes[j].y) < smokes[j].r) return false;
      }
    }
  }
  return true;
}

// ================= Audio (WebAudio, no files) =================
var AudioSys = {
  ctx: null, master: null, muted: false,
  init: function () {
    if (this.ctx) return;
    try {
      var AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    } catch (e) { this.ctx = null; }
  },
  tone: function (freq, dur, type, vol, slide) {
    if (!this.ctx || this.muted) return;
    try {
      var t = this.ctx.currentTime;
      var o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
      g.gain.setValueAtTime(vol || 0.2, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur);
    } catch (e) {}
  },
  noise: function (dur, vol, low) {
    if (!this.ctx || this.muted) return;
    try {
      var t = this.ctx.currentTime, len = Math.floor(this.ctx.sampleRate * dur);
      var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = this.ctx.createBufferSource(); src.buffer = buf;
      var f = this.ctx.createBiquadFilter(); f.type = low ? 'lowpass' : 'highpass'; f.frequency.value = low ? 400 : 1200;
      var g = this.ctx.createGain(); g.gain.value = vol || 0.25;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t);
    } catch (e) {}
  },
  shoot: function (w) { this.noise(0.09, 0.28); this.tone(w.sound || 500, 0.07, 'square', 0.12, 120); },
  hit: function () { this.tone(880, 0.06, 'sine', 0.18); },
  kill: function () { this.tone(660, 0.08, 'sine', 0.2); this.tone(990, 0.12, 'sine', 0.2); },
  hurt: function () { this.tone(180, 0.12, 'sawtooth', 0.15, 90); },
  reload: function () { this.tone(300, 0.05, 'square', 0.12); setTimeout(function () { AudioSys.tone(420, 0.05, 'square', 0.12); }, 120); },
  plant: function () { this.tone(1200, 0.1, 'sine', 0.2); setTimeout(function () { AudioSys.tone(1200, 0.1, 'sine', 0.2); }, 160); },
  explode: function () { this.noise(0.9, 0.5, true); this.tone(60, 0.8, 'sine', 0.35, 30); },
  roundWin: function () { var n = [523, 659, 784]; for (var i = 0; i < 3; i++) (function (f, d) { setTimeout(function () { AudioSys.tone(f, 0.18, 'triangle', 0.22); }, d); })(n[i], i * 140); },
  roundLose: function () { var n = [392, 330, 262]; for (var i = 0; i < 3; i++) (function (f, d) { setTimeout(function () { AudioSys.tone(f, 0.18, 'triangle', 0.2); }, d); })(n[i], i * 140); },
  buy: function () { this.tone(700, 0.07, 'triangle', 0.18); },
  dash: function () { this.noise(0.15, 0.15); },
  smoke: function () { this.noise(0.4, 0.12, true); },
  toggleMute: function () { this.muted = !this.muted; return this.muted; }
};

// ================= State =================
var G = null;      // game state, created by newMatch()
var state = 'menu'; // menu | buy | combat | roundEnd | matchEnd
var paused = false;
var isTouch = false;
var locked = false; // pointer lock active
var lastTs = 0;
var keys = {};
var mouse = { down: false };
var stick = { active: false, id: null, dx: 0, dy: 0 };
var lookTouch = { active: false, id: null, lx: 0, ly: 0 };
var touchFire = false;
var particles = [];
var tracers = [];
var hitT = 0;      // hitmarker timer
var flashT = 0;    // muzzle flash timer
var walkT = 0;     // viewmodel bob phase
var shakeT = 0;    // screen shake timer
var recoil = 0;    // smoothed viewmodel recoil 0..1
var bobAmp = 0;    // smoothed viewmodel bob amplitude 0..1
var swayX = 0;     // smoothed viewmodel sway from mouse look (px)
var lookVelX = 0;  // smoothed look speed (rad/s) driving the sway
var siteCenters = {};

function computeSiteCenters() {
  ['A', 'B'].forEach(function (s) {
    var cells = findCells(s), sx = 0, sy = 0;
    cells.forEach(function (c) { sx += c.x; sy += c.y; });
    var cc = cellCenter(Math.round(sx / cells.length), Math.round(sy / cells.length));
    siteCenters[s] = cc;
  });
}

function newMatch() {
  G = {
    round: 1,
    scoreAtk: 0, scoreDef: 0,
    credits: CFG.startCredits,
    owned: { pistol: true },
    armorOwned: false,
    kills: 0, deaths: 0, plants: 0, damage: 0,
    phase: 'buy',
    phaseTimer: CFG.buyTime,
    roundTimer: CFG.combatTime,
    charge: { state: 'carried', site: null, x: 0, y: 0, plantProgress: 0, fuse: 0, defuseProgress: 0 },
    fighters: [],
    smokes: [],
    sounds: [],
    winner: null
  };
  spawnRound();
  state = 'buy';
  G.phase = 'buy';
  G.phaseTimer = CFG.buyTime;
  buildShop();
  updateHUD();
  showScreen(null);
  setText('charge-status', 'CHARGE: CARRIED');
}

function makeFighter(team, kind, cx, cy, name) {
  var pos = cellCenter(cx, cy);
  var w = WEAPONS.pistol;
  var f = {
    team: team, kind: kind, name: name,
    x: pos.x, y: pos.y, r: 16,
    angle: team === 'atk' ? -Math.PI / 2 : Math.PI / 2,
    targetAngle: team === 'atk' ? -Math.PI / 2 : Math.PI / 2, // look target (angle chases it)
    vx: 0, vy: 0, // smoothed velocity (px/s)
    phase: rand(0, Math.PI * 2), // per-fighter phase for smooth strafe / scan sway
    hp: 100, maxHp: 100, armor: 0, alive: true,
    weapon: 'pistol', mag: w.mag, reserve: w.reserve,
    fireCd: 0, reloadT: 0, bloom: 0,
    speed: w.speed,
    smokeCd: 0, dashCd: 0, dashT: 0, dashDir: 0,
    reactT: 0, state: 'guard', stateT: 0,
    waypoint: null, guardSite: null, home: { x: pos.x, y: pos.y },
    investigate: null, investigateT: 0,
    defuseT: 0, stuckT: 0, lastX: pos.x, lastY: pos.y,
    visibleToPlayer: false
  };
  if (kind !== 'player') f.reserve = 9999; // bots never run out of ammo
  return f;
}

function spawnRound() {
  G.fighters = [];
  var spawns = findCells('S'); // 3 attacker spawn cells
  var p = makeFighter('atk', 'player', spawns[1].x, spawns[1].y, 'Volt');
  p.weapon = G.currentWeapon || 'pistol';
  var w = WEAPONS[p.weapon];
  p.mag = w.mag; p.reserve = w.reserve;
  p.armor = G.armorOwned ? ARMOR_MAX : 0;
  G.player = p;
  G.fighters.push(p);
  var a1 = makeFighter('atk', 'ally', spawns[0].x, spawns[0].y, 'Rook');
  var a2 = makeFighter('atk', 'ally', spawns[2].x, spawns[2].y, 'Sage');
  a1.guardSite = 'A'; a2.guardSite = 'B';
  G.fighters.push(a1, a2);
  var e1 = makeFighter('def', 'enemy', 13, 1, 'Onyx');
  var e2 = makeFighter('def', 'enemy', 14, 1, 'Blitz');
  var e3 = makeFighter('def', 'enemy', 15, 1, 'Havoc');
  e1.guardSite = 'A'; e2.guardSite = 'B'; e3.guardSite = 'mid';
  G.fighters.push(e1, e2, e3);
  G.smokes = [];
  G.sounds = [];
  G.charge = { state: 'carried', site: null, x: 0, y: 0, plantProgress: 0, fuse: 0, defuseProgress: 0 };
  G.roundTimer = CFG.combatTime;
  G.combatElapsed = 0; // seconds since this round's combat started
  tracers = [];
  particles = [];
}

// ================= Raycasting (DDA) =================
function castRay(px, py, angle) {
  var dx = Math.cos(angle), dy = Math.sin(angle);
  var mapX = Math.floor(px / CELL), mapY = Math.floor(py / CELL);
  var deltaX = dx === 0 ? 1e30 : Math.abs(CELL / dx);
  var deltaY = dy === 0 ? 1e30 : Math.abs(CELL / dy);
  var stepX, stepY, sideX, sideY;
  if (dx < 0) { stepX = -1; sideX = (px - mapX * CELL) / Math.abs(dx); }
  else { stepX = 1; sideX = ((mapX + 1) * CELL - px) / Math.abs(dx); }
  if (dy < 0) { stepY = -1; sideY = (py - mapY * CELL) / Math.abs(dy); }
  else { stepY = 1; sideY = ((mapY + 1) * CELL - py) / Math.abs(dy); }
  var side = 0, guard = 0;
  while (guard++ < 100) {
    if (sideX < sideY) { sideX += deltaX; mapX += stepX; side = 0; }
    else { sideY += deltaY; mapY += stepY; side = 1; }
    var t = cellAt(mapX, mapY);
    if (t === '#' || t === 'C') {
      var dist = side === 0 ? sideX - deltaX : sideY - deltaY;
      return { dist: Math.max(1, dist), side: side, type: t, mapX: mapX, mapY: mapY };
    }
  }
  return { dist: 1e30, side: 0, type: '#', mapX: mapX, mapY: mapY };
}

// Hitscan shot from (sx,sy) along angle. Returns hit info; applies damage.
function hitscan(shooter, angle, range, dmg) {
  var ray = castRay(shooter.x, shooter.y, angle);
  var wallDist = Math.min(ray.dist, range);
  var best = null, bestD = wallDist;
  for (var i = 0; i < G.fighters.length; i++) {
    var f = G.fighters[i];
    if (!f.alive || f.team === shooter.team || f === shooter) continue;
    var dx = f.x - shooter.x, dy = f.y - shooter.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d >= bestD) continue;
    var angDiff = normAngle(Math.atan2(dy, dx) - angle);
    var angRadius = Math.atan((f.r + 6) / d);
    if (Math.abs(angDiff) >= angRadius) continue;
    // smoke blocks the player's own shots too only for bots' vision;
    // for the shooter, walls already bound bestD — smoke blocks bots only.
    if (shooter.kind !== 'player' && !hasLOS(shooter.x, shooter.y, f.x, f.y, true, G.smokes)) continue;
    best = f; bestD = d;
  }
  var hx = shooter.x + Math.cos(angle) * bestD;
  var hy = shooter.y + Math.sin(angle) * bestD;
  tracers.push({ x1: shooter.x, y1: shooter.y, x2: hx, y2: hy, t: 0.09, team: shooter.team });
  if (best) {
    damageFighter(best, dmg, shooter);
    return { hit: best, dist: bestD, x: hx, y: hy };
  }
  return { hit: null, dist: wallDist, x: hx, y: hy };
}

// ================= Combat =================
function weaponOf(f) { return WEAPONS[f.weapon]; }

function fireWeapon(f) {
  if (!f.alive || f.reloadT > 0 || f.fireCd > 0) return false;
  var w = weaponOf(f);
  if (f.mag <= 0) { startReload(f); return false; }
  f.mag--;
  f.fireCd = w.rate / 1000;
  f.bloom = Math.min(0.08, f.bloom + 0.012);
  var spread = w.spread + f.bloom;
  var a = f.angle + rand(-spread, spread);
  var res = hitscan(f, a, w.range, w.dmg);
  G.sounds.push({ x: f.x, y: f.y, t: 1.5 });
  if (f === G.player) {
    AudioSys.shoot(w);
    flashT = 0.06;
    recoil = 1; // smoothed recoil kick (decays in updatePlayer)
    if (res.hit) { hitT = 0.15; }
  }
  return true;
}

function startReload(f) {
  if (f.reloadT > 0 || f.mag >= weaponOf(f).mag || f.reserve <= 0) return;
  f.reloadT = weaponOf(f).reload;
  if (f === G.player) AudioSys.reload();
}

function finishReload(f) {
  var w = weaponOf(f);
  var need = w.mag - f.mag;
  var take = Math.min(need, f.reserve);
  f.mag += take;
  f.reserve -= take;
}

function damageFighter(target, dmg, attacker) {
  if (!target.alive) return;
  var absorbed = 0;
  if (target.armor > 0) {
    absorbed = Math.min(target.armor, dmg * 0.5);
    target.armor -= absorbed;
  }
  var hpDmg = dmg - absorbed;
  target.hp -= hpDmg;
  if (attacker === G.player) G.damage += hpDmg;
  if (attacker === G.player) AudioSys.hit();
  if (target === G.player) { AudioSys.hurt(); shakeT = 0.15; }
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    addKillFeed(attacker ? attacker.name : '???', target.name);
    if (attacker === G.player) { G.kills++; G.credits += CFG.killCredits; AudioSys.kill(); }
    if (target === G.player) { G.deaths++; dropCharge(); }
    checkRoundEnd();
  }
}

function dropCharge() {
  if (G.charge.state === 'carried') {
    G.charge.state = 'lost';
    setText('charge-status', 'CHARGE: LOST');
    centerMsg('CHARGE LOST', 2);
  }
}

function tryMove(f, dx, dy, dt) {
  var nx = f.x + dx * dt, ny = f.y + dy * dt;
  if (!circleHitsWall(nx, f.y, f.r)) f.x = nx;
  if (!circleHitsWall(f.x, ny, f.r)) f.y = ny;
  f.x = clamp(f.x, f.r, MW * CELL - f.r);
  f.y = clamp(f.y, f.r, MH * CELL - f.r);
}

function circleHitsWall(x, y, rad) {
  // check the 4 corners of the circle's bounding box against solid cells
  var pts = [[x - rad, y - rad], [x + rad, y - rad], [x - rad, y + rad], [x + rad, y + rad]];
  for (var i = 0; i < pts.length; i++) if (isSolidAt(pts[i][0], pts[i][1])) return true;
  return false;
}

function separateFighters() {
  var fs = G.fighters;
  for (var i = 0; i < fs.length; i++) {
    for (var j = i + 1; j < fs.length; j++) {
      var a = fs[i], b = fs[j];
      if (!a.alive || !b.alive) continue;
      var d = dist(a.x, a.y, b.x, b.y), min = a.r + b.r;
      if (d > 0.01 && d < min) {
        var push = (min - d) / 2, ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
        a.x -= ux * push; a.y -= uy * push;
        b.x += ux * push; b.y += uy * push;
      }
    }
  }
}

// ================= Plant / Defuse =================
function siteAtPos(x, y) {
  var t = cellTypeAt(x, y);
  return (t === 'A' || t === 'B') ? t : null;
}

function updatePlant(dt) {
  var c = G.charge, p = G.player;
  if (c.state === 'carried') {
    if (p.alive) {
      var site = siteAtPos(p.x, p.y);
      if (site) {
        c.plantProgress += dt;
        c.site = site;
        if (c.plantProgress >= CFG.plantTime) {
          c.state = 'planted';
          c.x = p.x; c.y = p.y;
          c.fuse = CFG.explodeTime;
          G.plants++;
          AudioSys.plant();
          $('charge-status').textContent = 'CHARGE: PLANTED @ ' + site;
          centerMsg('CHARGE PLANTED', 2);
        }
      } else {
        c.plantProgress = 0; c.site = null;
      }
    }
  } else if (c.state === 'planted') {
    c.fuse -= dt;
    if (c.fuse <= 0) {
      AudioSys.explode();
      shakeT = 0.6;
      endRound('atk', 'CHARGE DETONATED');
    }
  }
}

function updateDefuse(dt) {
  var c = G.charge;
  if (c.state !== 'planted') return;
  var defuser = null;
  for (var i = 0; i < G.fighters.length; i++) {
    var f = G.fighters[i];
    if (f.team !== 'def' || !f.alive) continue;
    if (dist(f.x, f.y, c.x, c.y) < 52) { defuser = f; break; }
  }
  if (defuser) {
    var threat = nearestVisibleEnemy(defuser, 240);
    if (threat) { c.defuseProgress = 0; defuser.defuseT = 0; return; }
    c.defuseProgress += dt;
    defuser.defuseT = c.defuseProgress;
    if (c.defuseProgress >= CFG.defuseTime) {
      endRound('def', 'CHARGE DEFUSED');
    }
  } else {
    c.defuseProgress = 0;
  }
}

// ================= Round / Match flow =================
function aliveCount(team) {
  var n = 0;
  for (var i = 0; i < G.fighters.length; i++) if (G.fighters[i].team === team && G.fighters[i].alive) n++;
  return n;
}

function checkRoundEnd() {
  if (state !== 'combat') return;
  if (aliveCount('def') === 0) { endRound('atk', 'ENEMY TEAM ELIMINATED'); return; }
  if (aliveCount('atk') === 0) { endRound('def', 'YOUR TEAM ELIMINATED'); return; }
}

function endRound(winner, reason) {
  if (state !== 'combat') return;
  state = 'roundEnd';
  if (winner === 'atk') {
    G.scoreAtk++;
    G.credits += CFG.winCredits;
    AudioSys.roundWin();
  } else {
    G.scoreDef++;
    G.credits += CFG.lossCredits;
    AudioSys.roundLose();
  }
  exitLock();
  setText('charge-status', 'CHARGE: —');
  centerMsg((winner === 'atk' ? 'ROUND WON' : 'ROUND LOST') + ' — ' + reason, 2.4);
  updateHUD();
  var matchAtEnd = G;
  setTimeout(function () {
    if (G !== matchAtEnd || state !== 'roundEnd') return;
    if (G.scoreAtk >= WIN_ROUNDS || G.scoreDef >= WIN_ROUNDS) {
      endMatch(G.scoreAtk >= WIN_ROUNDS ? 'atk' : 'def');
    } else {
      G.round++;
      spawnRound();
      state = 'buy';
      G.phase = 'buy';
      G.phaseTimer = CFG.buyTime;
      buildShop();
      updateHUD();
      setText('charge-status', 'CHARGE: CARRIED');
      showBuy(true);
    }
  }, 2400);
}

function endMatch(winner) {
  state = 'matchEnd';
  G.winner = winner;
  exitLock();
  $('end-title').textContent = winner === 'atk' ? 'VICTORY' : 'DEFEAT';
  $('end-sub').textContent = winner === 'atk'
    ? 'Cloud9 Strike takes the match. The Charge did its job.'
    : 'Tempest defense holds. Run it back.';
  $('end-stats').innerHTML =
    'Rounds: <b>' + G.scoreAtk + ' — ' + G.scoreDef + '</b><br>' +
    'Kills: <b>' + G.kills + '</b> · Deaths: <b>' + G.deaths + '</b><br>' +
    'Plants: <b>' + G.plants + '</b> · Damage dealt: <b>' + Math.round(G.damage) + '</b><br>' +
    'Credits left: <b>₡' + G.credits + '</b>';
  if (winner === 'atk') AudioSys.roundWin(); else AudioSys.roundLose();
  showScreen('end-screen');
}

// ================= Shop =================
function buildShop() {
  var box = $('shop-items');
  box.innerHTML = '';
  var items = [
    { id: 'smg', key: '2', name: 'SMG', desc: 'Fast fire, close range. 18 dmg · 25 mag', price: WEAPONS.smg.price },
    { id: 'rifle', key: '3', name: 'Rifle', desc: 'Balanced all-rounder. 30 dmg · 25 mag', price: WEAPONS.rifle.price },
    { id: 'sniper', key: '4', name: 'Sniper', desc: 'One-shot threat. 90 dmg · 5 mag', price: WEAPONS.sniper.price },
    { id: 'armor', key: '5', name: 'Armor', desc: '+50 armor, absorbs half of damage', price: ARMOR_PRICE }
  ];
  items.forEach(function (it) {
    var div = document.createElement('div');
    div.className = 'shop-item';
    var owned = it.id === 'armor' ? G.armorOwned : !!G.owned[it.id];
    if (owned) div.classList.add('owned');
    if (!owned && G.credits < it.price) div.classList.add('disabled');
    div.innerHTML = '<div class="s-key">[' + it.key + ']</div><div class="s-name">' + it.name + '</div>' +
      '<div class="s-desc">' + it.desc + '</div><div class="s-price">₡' + it.price + '</div>';
    div.addEventListener('click', function () { buyItem(it.id); });
    box.appendChild(div);
  });
  var ownedNote = document.createElement('div');
  ownedNote.style.cssText = 'width:100%;color:#8fb6d4;font-size:13px';
  ownedNote.textContent = 'Current weapon: ' + WEAPONS[G.currentWeapon || 'pistol'].name + ' · Pistol [1] is free · weapons are kept between rounds';
  box.appendChild(ownedNote);
}

function buyItem(id) {
  if (state !== 'buy') return;
  if (id === 'armor') {
    if (G.armorOwned || G.credits < ARMOR_PRICE) return;
    G.credits -= ARMOR_PRICE;
    G.armorOwned = true;
    AudioSys.buy();
    buildShop(); updateHUD();
    return;
  }
  if (G.owned[id]) { G.currentWeapon = id; AudioSys.buy(); buildShop(); updateHUD(); return; }
  var price = WEAPONS[id].price;
  if (G.credits < price) return;
  G.credits -= price;
  G.owned[id] = true;
  G.currentWeapon = id;
  AudioSys.buy();
  buildShop(); updateHUD();
}

// ================= Bot AI =================
function nearestVisibleEnemy(f, maxDist) {
  var best = null, bestD = maxDist || CFG.sightRange;
  for (var i = 0; i < G.fighters.length; i++) {
    var e = G.fighters[i];
    if (!e.alive || e.team === f.team) continue;
    var d = dist(f.x, f.y, e.x, e.y);
    if (d < bestD && hasLOS(f.x, f.y, e.x, e.y, true, G.smokes)) { best = e; bestD = d; }
  }
  return best;
}

// Smooth velocity: the fighter accelerates toward the desired velocity
// instead of jumping to full speed (and eases back to a stop).
function moveSmooth(f, vx, vy, dt) {
  var k = Math.min(1, dt * (f.kind === 'player' ? 14 : 9));
  f.vx += (vx - f.vx) * k;
  f.vy += (vy - f.vy) * k;
  tryMove(f, f.vx, f.vy, dt);
}
// Smooth heading: turn toward the desired angle at a capped rate.
function turnToward(f, desired, dt, rate) {
  var diff = normAngle(desired - f.angle);
  f.angle = normAngle(f.angle + diff * Math.min(1, dt * rate));
}

function moveToward(f, tx, ty, speed, dt) {
  var d = dist(f.x, f.y, tx, ty);
  if (d < 6) {
    moveSmooth(f, 0, 0, dt); // ease to a stop at the target
    turnToward(f, angleTo(f.x, f.y, tx, ty), dt, 8);
    return;
  }
  // arrival easing: slow down as the target gets close (no overshoot wobble)
  var arrive = clamp(d / 48, 0.25, 1);
  var vx = (tx - f.x) / d * speed * arrive, vy = (ty - f.y) / d * speed * arrive;
  moveSmooth(f, vx, vy, dt);
  turnToward(f, angleTo(f.x, f.y, tx, ty), dt, 8);
}

function randomWalkableNear(cx, cy, radius) {
  for (var i = 0; i < 12; i++) {
    var x = Math.floor(cx + rand(-radius, radius));
    var y = Math.floor(cy + rand(-radius, radius));
    if (!isSolidCell(x, y)) { var c = cellCenter(x, y); return { x: c.x + rand(-12, 12), y: c.y + rand(-12, 12) }; }
  }
  return cellCenter(cx, cy);
}

function botPickWaypoint(f) {
  if (f.guardSite === 'A') f.waypoint = randomWalkableNear(2, 2, 3);
  else if (f.guardSite === 'B') f.waypoint = randomWalkableNear(26, 2, 3);
  else f.waypoint = randomWalkableNear(14, 9, 4);
}

function updateBot(f, dt) {
  if (!f.alive) return;
  f.phase += dt; // drives smooth strafe / scan sway
  f.fireCd -= dt;
  if (f.reloadT > 0) { f.reloadT -= dt; if (f.reloadT <= 0) finishReload(f); }
  f.bloom = Math.max(0, f.bloom - 0.05 * dt);
  f.smokeCd -= dt; f.dashCd -= dt;

  // heal at home base
  if (dist(f.x, f.y, f.home.x, f.home.y) < 60 && f.hp < f.maxHp) f.hp = Math.min(f.maxHp, f.hp + 8 * dt);

  // stuck detection: pick a new waypoint if barely moving
  if (Math.abs(f.x - f.lastX) + Math.abs(f.y - f.lastY) < 2 * dt * 60) f.stuckT += dt;
  else f.stuckT = 0;
  f.lastX = f.x; f.lastY = f.y;
  if (f.stuckT > 2) { botPickWaypoint(f); f.stuckT = 0; }

  var enemy = nearestVisibleEnemy(f, CFG.sightRange);
  var c = G.charge;

  // --- Defenders: defuse the planted Charge when no attacker is visible ---
  if (f.team === 'def' && c.state === 'planted' && !enemy) {
    var dPlant = dist(f.x, f.y, c.x, c.y);
    if (dPlant > 44) {
      moveToward(f, c.x, c.y, 175, dt);
      f.state = 'defuse-move';
    } else {
      turnToward(f, angleTo(f.x, f.y, c.x, c.y), dt, 8);
      f.state = 'defusing';
    }
    return;
  }

  // --- Retreat on low HP ---
  if (f.hp < 30 && f.state !== 'retreat') { f.state = 'retreat'; f.stateT = 0; }
  if (f.state === 'retreat') {
    moveToward(f, f.home.x, f.home.y, 185, dt);
    if (f.hp > 70 || dist(f.x, f.y, f.home.x, f.home.y) < 40) f.state = 'guard';
    return;
  }

  // --- Combat ---
  if (enemy) {
    f.state = 'combat';
    var d = dist(f.x, f.y, enemy.x, enemy.y);
    turnToward(f, angleTo(f.x, f.y, enemy.x, enemy.y), dt, 10);
    if (f.reactT <= 0) f.reactT = rand(0.3, 0.5);
    f.reactT -= dt;
    // keep a fighting distance, strafe a little
    if (d > 320) moveToward(f, enemy.x, enemy.y, 150, dt);
    else if (d < 150) moveToward(f, f.x + (f.x - enemy.x), f.y + (f.y - enemy.y), 120, dt);
    else {
      // continuous sine strafe (no hard direction flips at zero crossings)
      var strafe = Math.sin(f.phase * 1.4);
      moveSmooth(f, -Math.sin(f.angle) * strafe * 70, Math.cos(f.angle) * strafe * 70, dt);
    }
    if (f.reactT <= 0 && f.fireCd <= 0) {
      if (f.mag <= 0) { startReload(f); }
      else {
        f.mag--; f.fireCd = 0.28;
        var a = f.angle + rand(-0.07, 0.07);
        hitscan(f, a, 460, 16);
        G.sounds.push({ x: f.x, y: f.y, t: 1.5 });
      }
    }
    return;
  }

  // --- Heard a gunshot? investigate briefly ---
  // Early-round grace: for the first 8s of combat bots hold their guard
  // posts instead of chasing every sound, so the round doesn't snowball
  // before the player has rotated across the bigger map.
  if (f.investigate && f.investigateT > 0) {
    f.investigateT -= dt;
    moveToward(f, f.investigate.x, f.investigate.y, 165, dt);
    if (dist(f.x, f.y, f.investigate.x, f.investigate.y) < 30) f.investigateT = 0;
    return;
  }
  if (G.combatElapsed >= 8) {
    for (var i = 0; i < G.sounds.length; i++) {
      var s = G.sounds[i];
      if (dist(f.x, f.y, s.x, s.y) < CFG.hearRange) {
        f.investigate = { x: s.x, y: s.y };
        f.investigateT = 2.5;
        break;
      }
    }
  }
  if (f.investigateT > 0) return;

  // --- Guard / advance ---
  if (f.team === 'def') {
    if (!f.waypoint || dist(f.x, f.y, f.waypoint.x, f.waypoint.y) < 24) {
      f.stateT -= dt;
      if (f.stateT <= 0) { botPickWaypoint(f); f.stateT = rand(2, 4); }
    } else {
      moveToward(f, f.waypoint.x, f.waypoint.y, 90, dt);
    }
  } else {
    // allies advance to their site; if the Charge is planted, guard it
    var dest = null;
    if (c.state === 'planted') dest = { x: c.x, y: c.y };
    else if (f.guardSite === 'A') dest = siteCenters.A;
    else dest = siteCenters.B;
    var dd = dist(f.x, f.y, dest.x, dest.y);
    if (dd > 70) moveToward(f, dest.x, dest.y, 165, dt);
    else f.angle = normAngle(f.angle + Math.sin(f.phase * 0.7) * dt * 0.5);
  }
}

// ================= Player =================
function updatePlayer(dt) {
  var p = G.player;
  if (!p.alive) return;
  p.fireCd -= dt;
  if (p.reloadT > 0) { p.reloadT -= dt; if (p.reloadT <= 0) finishReload(p); }
  p.bloom = Math.max(0, p.bloom - 0.05 * dt);
  p.smokeCd -= dt; p.dashCd -= dt;
  if (flashT > 0) flashT -= dt;
  if (hitT > 0) hitT -= dt;
  if (shakeT > 0) shakeT -= dt;
  recoil = Math.max(0, recoil - dt * 6);

  // smooth mouse look: the view angle chases targetAngle (fed by raw
  // pointer/touch deltas) with exponential smoothing — no jitter, no
  // lost input, just a ~50ms lag that reads as weight, not stutter.
  var lookDiff = normAngle(p.targetAngle - p.angle);
  var lookStep = lookDiff * Math.min(1, dt * 18);
  p.angle = normAngle(p.angle + lookStep);
  lookVelX += ((lookStep / Math.max(dt, 0.001)) - lookVelX) * Math.min(1, dt * 10);

  // movement (WASD relative to view)
  var mx = 0, my = 0;
  if (keys['w'] || keys['arrowup']) my -= 1;
  if (keys['s'] || keys['arrowdown']) my += 1;
  if (keys['a'] || keys['arrowleft']) mx -= 1;
  if (keys['d'] || keys['arrowright']) mx += 1;
  if (stick.active) { mx = stick.dx; my = -stick.dy; }
  var ml = Math.sqrt(mx * mx + my * my);
  if (ml > 1) { mx /= ml; my /= ml; }
  var speed = weaponOf(p).speed;
  if (keys['shift']) speed *= 0.55;
  if (p.dashT > 0) {
    p.dashT -= dt;
    // dash sets velocity directly (punch), then moveSmooth eases out of it
    p.vx = Math.cos(p.dashDir) * speed * 3.2;
    p.vy = Math.sin(p.dashDir) * speed * 3.2;
    tryMove(p, p.vx, p.vy, dt);
  } else {
    // forward = -my along view, strafe = mx perpendicular
    var fx = Math.cos(p.angle), fy = Math.sin(p.angle);
    var rx = -fy, ry = fx;
    var vx = fx * (-my) + rx * mx;
    var vy = fy * (-my) + ry * mx;
    // accelerate / decelerate smoothly instead of instant speed changes
    moveSmooth(p, vx * speed, vy * speed, dt);
  }
  // viewmodel bob eases in/out instead of snapping on/off with movement
  bobAmp += ((ml > 0.1 ? 1 : 0) - bobAmp) * Math.min(1, dt * 8);
  if (ml > 0.1) walkT += dt * 9;
  // weapon sway follows smoothed look speed
  var swayT = clamp(-lookVelX * 3, -10, 10);
  swayX += (swayT - swayX) * Math.min(1, dt * 12);

  // touch auto-aim assist while firing
  if (isTouch && touchFire) {
    var tgt = nearestVisibleEnemy(p, weaponOf(p).range);
    if (tgt) {
      var want = angleTo(p.x, p.y, tgt.x, tgt.y);
      var diff = normAngle(want - p.angle);
      if (Math.abs(diff) < 0.35) {
        p.angle += diff * 0.35;
        p.targetAngle = p.angle; // keep the look target in sync
      }
    }
  }

  // fire
  var wantFire = isTouch ? touchFire : mouse.down;
  var w = weaponOf(p);
  if (wantFire && p.fireCd <= 0 && p.reloadT <= 0) {
    if (w.auto) fireWeapon(p);
    else if (!p._firedOnce) { fireWeapon(p); p._firedOnce = true; }
  }
  if (!wantFire) p._firedOnce = false;
  if (p.mag <= 0 && p.reserve > 0 && p.reloadT <= 0) startReload(p);
}

function useSmoke() {
  var p = G.player;
  if (!p || !p.alive || p.smokeCd > 0 || state !== 'combat') return;
  p.smokeCd = 25;
  var d = 3 * CELL;
  var sx = p.x + Math.cos(p.angle) * d, sy = p.y + Math.sin(p.angle) * d;
  // clamp to a walkable cell: step back until free
  while (isSolidAt(sx, sy) && d > CELL) { d -= 16; sx = p.x + Math.cos(p.angle) * d; sy = p.y + Math.sin(p.angle) * d; }
  sx = clamp(sx, CELL, MW * CELL - CELL); sy = clamp(sy, CELL, MH * CELL - CELL);
  G.smokes.push({ x: sx, y: sy, r: 78, t: 8 });
  AudioSys.smoke();
}

function useDash() {
  var p = G.player;
  if (!p || !p.alive || p.dashCd > 0 || state !== 'combat') return;
  p.dashCd = 8;
  p.dashT = 0.16;
  var mx = 0, my = 0;
  if (keys['w'] || keys['arrowup']) my -= 1;
  if (keys['s'] || keys['arrowdown']) my += 1;
  if (keys['a'] || keys['arrowleft']) mx -= 1;
  if (keys['d'] || keys['arrowright']) mx += 1;
  if (stick.active) { mx = stick.dx; my = -stick.dy; }
  if (mx === 0 && my === 0) { p.dashDir = p.angle; }
  else {
    var fx = Math.cos(p.angle), fy = Math.sin(p.angle);
    var rx = -fy, ry = fx;
    var vx = fx * (-my) + rx * mx, vy = fy * (-my) + ry * mx;
    p.dashDir = Math.atan2(vy, vx);
  }
  AudioSys.dash();
}

// ================= Feed / messages =================
function addKillFeed(killer, victim) {
  var box = $('killfeed');
  var div = document.createElement('div');
  div.innerHTML = '<b>' + killer + '</b> ▸ <span class="dead">' + victim + '</span>';
  box.appendChild(div);
  while (box.children.length > 4) box.removeChild(box.firstChild);
  setTimeout(function () { if (div.parentNode) div.parentNode.removeChild(div); }, 4000);
}

function centerMsg(text, seconds) {
  var el = $('center-msg');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(centerMsg._t);
  centerMsg._t = setTimeout(function () { el.classList.remove('show'); }, seconds * 1000);
}

// ================= Main update =================
function update(dt) {
  if (paused) return;
  for (var i = G.sounds.length - 1; i >= 0; i--) {
    G.sounds[i].t -= dt;
    if (G.sounds[i].t <= 0) G.sounds.splice(i, 1);
  }
  for (var s = G.smokes.length - 1; s >= 0; s--) {
    G.smokes[s].t -= dt;
    if (G.smokes[s].t <= 0) G.smokes.splice(s, 1);
  }
  for (var t = tracers.length - 1; t >= 0; t--) {
    tracers[t].t -= dt;
    if (tracers[t].t <= 0) tracers.splice(t, 1);
  }
  // player visibility flags (for minimap + bot awareness)
  var p = G.player;
  for (var v = 0; v < G.fighters.length; v++) {
    var f = G.fighters[v];
    f.visibleToPlayer = f.alive && f !== p && dist(p.x, p.y, f.x, f.y) < CFG.sightRange &&
      hasLOS(p.x, p.y, f.x, f.y, true, G.smokes);
  }

  if (state === 'buy') {
    G.phaseTimer -= dt;
    setText('buy-timer', Math.ceil(G.phaseTimer));
    if (G.phaseTimer <= 0) startCombat();
  } else if (state === 'combat') {
    G.roundTimer -= dt;
    G.combatElapsed += dt;
    if (G.roundTimer <= 0 && G.charge.state !== 'planted') {
      endRound('def', 'TIME EXPIRED');
      return;
    }
    updatePlayer(dt);
    for (var j = 0; j < G.fighters.length; j++) {
      var fighter = G.fighters[j];
      if (fighter.kind !== 'player') updateBot(fighter, dt);
    }
    separateFighters();
    updatePlant(dt);
    updateDefuse(dt);
  }
  updateHUD();
}

function startCombat() {
  if (state !== 'buy') return;
  state = 'combat';
  showBuy(false);
  $('buy-panel').classList.add('hidden');
  centerMsg('ROUND ' + G.round + ' — PLANT THE CHARGE', 2);
  if (!isTouch) showLockHint(true);
}

// ================= Rendering (raycasting) =================
var canvas = $('game');
var ctx = canvas.getContext('2d');
var zbuffer = new Array(RAYS).fill(1e30);
// Precomputed paint values — the wall loop must not build strings per column.
var WALL_FILL = { '#0': 'rgb(58,110,165)', '#1': 'rgb(40,76,115)', 'C0': 'rgb(138,109,59)', 'C1': 'rgb(96,76,40)' };
var FOG_FILL = [];
(function () {
  for (var i = 0; i <= 15; i++) FOG_FILL.push('rgba(4,18,31,' + (i * 0.05).toFixed(2) + ')');
})();
var ceilGrad = null, floorGrad = null;
function ensureGradients() {
  if (ceilGrad) return;
  ceilGrad = ctx.createLinearGradient(0, 0, 0, ARENA.H / 2);
  ceilGrad.addColorStop(0, '#04101d');
  ceilGrad.addColorStop(1, '#0a2438');
  floorGrad = ctx.createLinearGradient(0, ARENA.H / 2, 0, ARENA.H);
  floorGrad.addColorStop(0, '#0d1f31');
  floorGrad.addColorStop(1, '#040d17');
}
var spriteList = []; // reused every frame — no per-frame array allocation

function projectPoint(wx, wy, heightCells) {
  var p = G.player;
  var dx = wx - p.x, dy = wy - p.y;
  var d = Math.sqrt(dx * dx + dy * dy);
  if (d < 4) return null;
  var angDiff = normAngle(Math.atan2(dy, dx) - p.angle);
  if (Math.abs(angDiff) > 0.95) return null;
  var perp = d * Math.cos(angDiff);
  if (perp < 4) return null;
  var screenX = (ARENA.W / 2) * (1 + Math.tan(angDiff) / FOV_TAN);
  var baseY = ARENA.H / 2 + (ARENA.H * CELL / 2) / perp;
  var y = baseY - heightCells * CELL * (ARENA.H / perp);
  return { x: screenX, y: y, dist: d, perp: perp };
}

function draw() {
  var W = ARENA.W, H = ARENA.H;
  ctx.save();
  // smooth screen shake: slow sine wander, not random per-frame jitter
  if (shakeT > 0) {
    var shAmp = shakeT * 7, now = Date.now();
    ctx.translate(Math.sin(now * 0.09) * shAmp, Math.cos(now * 0.077) * shAmp);
  }
  // ceiling + floor gradients (cached once — no per-frame allocation)
  ensureGradients();
  ctx.fillStyle = ceilGrad;
  ctx.fillRect(0, 0, W, H / 2);
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, H / 2, W, H / 2);
  if (!G) { ctx.restore(); return; }
  var p = G.player;
  var colW = W / RAYS;

  // ---- wall slices ----
  for (var col = 0; col < RAYS; col++) {
    var cameraX = 2 * col / RAYS - 1;
    var rayAngle = p.angle + Math.atan(cameraX * FOV_TAN);
    var ray = castRay(p.x, p.y, rayAngle);
    var perp = Math.max(1, ray.dist * Math.cos(rayAngle - p.angle));
    zbuffer[col] = perp;
    var lineH = H * CELL / perp;
    var y0 = (H - lineH) / 2;
    ctx.fillStyle = WALL_FILL[ray.type + ray.side];
    ctx.fillRect(col * colW, y0, colW + 1, lineH);
    var fogIdx = Math.round(clamp((perp - 150) / 700, 0, 0.75) * 20);
    if (fogIdx > 0) {
      ctx.fillStyle = FOG_FILL[fogIdx];
      ctx.fillRect(col * colW, y0, colW + 1, lineH);
    }
  }

  // ---- sprites (scratch list reused every frame) ----
  spriteList.length = 0;
  for (var i = 0; i < G.fighters.length; i++) {
    var f = G.fighters[i];
    if (f.alive && f !== p) spriteList.push({ kind: 'fighter', f: f, x: f.x, y: f.y });
  }
  spriteList.push({ kind: 'site', site: 'A', x: siteCenters.A.x, y: siteCenters.A.y });
  spriteList.push({ kind: 'site', site: 'B', x: siteCenters.B.x, y: siteCenters.B.y });
  if (G.charge.state === 'planted') spriteList.push({ kind: 'charge', x: G.charge.x, y: G.charge.y });
  for (var s = 0; s < G.smokes.length; s++) spriteList.push({ kind: 'smoke', x: G.smokes[s].x, y: G.smokes[s].y });
  spriteList.sort(function (a, b) {
    return dist(p.x, p.y, b.x, b.y) - dist(p.x, p.y, a.x, a.y);
  });
  for (var sp = 0; sp < spriteList.length; sp++) drawSprite(spriteList[sp]);

  // ---- tracers ----
  ctx.lineWidth = 2;
  for (var tr = 0; tr < tracers.length; tr++) {
    var t = tracers[tr];
    var hit = projectPoint(t.x2, t.y2, 0.55);
    if (!hit) continue;
    ctx.strokeStyle = t.team === 'atk' ? 'rgba(127,212,255,0.8)' : 'rgba(255,143,163,0.8)';
    ctx.beginPath();
    ctx.moveTo(W / 2 + 46, H * 0.82);
    ctx.lineTo(hit.x, hit.y);
    ctx.stroke();
  }

  drawWeapon();
  drawCrosshair();
  drawMinimap();
  drawPlantBar();
  ctx.restore();
}

function drawSprite(s) {
  var p = G.player, W = ARENA.W, H = ARENA.H;
  var dx = s.x - p.x, dy = s.y - p.y;
  var d = Math.sqrt(dx * dx + dy * dy);
  if (d < 8) return;
  var angDiff = normAngle(Math.atan2(dy, dx) - p.angle);
  if (Math.abs(angDiff) > 0.85) return;
  var perp = d * Math.cos(angDiff);
  if (perp < 8) return;
  var screenX = (W / 2) * (1 + Math.tan(angDiff) / FOV_TAN);
  var col = clamp(Math.floor(screenX / (W / RAYS)), 0, RAYS - 1);
  if (perp > zbuffer[col]) return; // occluded by a wall
  var baseY = H / 2 + (H * CELL / 2) / perp;

  if (s.kind === 'fighter') {
    var f = s.f;
    var h = H * CELL * 0.95 / perp, w = h * 0.42;
    var top = baseY - h;
    var color = f.team === 'atk' ? '#4db2ff' : '#ff5470';
    // body
    ctx.fillStyle = color;
    ctx.fillRect(screenX - w / 2, top + h * 0.25, w, h * 0.75);
    // head
    ctx.beginPath();
    ctx.arc(screenX, top + h * 0.14, w * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = '#e8c39a';
    ctx.fill();
    // gun
    ctx.strokeStyle = '#222';
    ctx.lineWidth = Math.max(2, w * 0.12);
    ctx.beginPath();
    ctx.moveTo(screenX, top + h * 0.45);
    ctx.lineTo(screenX + (f.team === 'atk' ? w * 0.3 : -w * 0.3), top + h * 0.45);
    ctx.stroke();
    // name + hp bar
    ctx.fillStyle = '#fff';
    ctx.font = 'bold ' + Math.max(10, Math.round(h * 0.09)) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(f.name, screenX, top - 8);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(screenX - w / 2, top - 5, w, 4);
    ctx.fillStyle = f.hp > 50 ? '#2ee6a8' : '#ffc857';
    ctx.fillRect(screenX - w / 2, top - 5, w * (f.hp / f.maxHp), 4);
    // distance darkening
    var dark = clamp(perp / 900, 0, 0.55);
    if (dark > 0) {
      ctx.fillStyle = 'rgba(4,18,31,' + dark.toFixed(2) + ')';
      ctx.fillRect(screenX - w / 2, top, w, h);
    }
  } else if (s.kind === 'site') {
    var h2 = H * CELL * 1.15 / perp, w2 = h2 * 1.1;
    var top2 = baseY - h2;
    var col2 = s.site === 'A' ? '#2ee6a8' : '#ffc857';
    ctx.fillStyle = 'rgba(4,18,31,0.8)';
    ctx.fillRect(screenX - w2 / 2, top2, w2, h2 * 0.4);
    ctx.strokeStyle = col2;
    ctx.lineWidth = 2;
    ctx.strokeRect(screenX - w2 / 2, top2, w2, h2 * 0.4);
    ctx.fillStyle = col2;
    ctx.font = 'bold ' + Math.max(12, Math.round(h2 * 0.16)) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SITE ' + s.site, screenX, top2 + h2 * 0.28);
  } else if (s.kind === 'charge') {
    var pulse = 0.6 + 0.4 * Math.sin(Date.now() / 150);
    var r = (H * CELL * 0.16 / perp) * pulse;
    ctx.fillStyle = '#ffc857';
    ctx.beginPath(); ctx.arc(screenX, baseY - r, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(screenX, baseY - r, r * 1.8, 0, Math.PI * 2); ctx.stroke();
  } else if (s.kind === 'smoke') {
    var hs = H * CELL * 0.9 / perp, ws = hs * 1.4;
    ctx.fillStyle = 'rgba(207,216,220,0.5)';
    ctx.beginPath(); ctx.arc(screenX - ws * 0.25, baseY - hs * 0.4, ws * 0.32, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(screenX + ws * 0.2, baseY - hs * 0.5, ws * 0.36, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(screenX, baseY - hs * 0.3, ws * 0.3, 0, Math.PI * 2); ctx.fill();
  }
}

function drawWeapon() {
  if (!G || state === 'menu') return;
  var p = G.player, W = ARENA.W, H = ARENA.H;
  if (!p.alive) return;
  var w = weaponOf(p);
  var bobY = Math.sin(walkT) * 4 * bobAmp; // eases in/out with movement
  var kick = recoil * 12; // smoothed recoil (decays in updatePlayer)
  var cx = W / 2 + swayX, baseY = H - 18 + bobY + kick;
  var len = 90 + w.len * 70;
  ctx.save();
  ctx.translate(cx, baseY);
  // body
  ctx.fillStyle = '#1a2f45';
  ctx.beginPath();
  ctx.moveTo(-26, 0);
  ctx.lineTo(-20, -len * 0.55);
  ctx.lineTo(20, -len * 0.55);
  ctx.lineTo(26, 0);
  ctx.closePath();
  ctx.fill();
  // barrel
  ctx.fillStyle = '#2c4a68';
  ctx.fillRect(-6, -len, 12, len * 0.6);
  // accent stripe per weapon
  ctx.fillStyle = w.name === 'Sniper' ? '#ffc857' : '#0090ff';
  ctx.fillRect(-20, -len * 0.42, 40, 5);
  if (w.name === 'Sniper') {
    ctx.strokeStyle = '#0a2438';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, -len * 0.62, 12, 0, Math.PI * 2); ctx.stroke();
  }
  // muzzle flash — smooth shrink as flashT decays (no random flicker)
  if (flashT > 0) {
    var fr = 10 + 18 * (flashT / 0.06);
    ctx.fillStyle = 'rgba(255,200,80,0.95)';
    ctx.beginPath();
    ctx.arc(0, -len - 8, fr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(0, -len - 8, fr * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCrosshair() {
  if (!G || state === 'menu' || !G.player.alive) return;
  var W = ARENA.W, H = ARENA.H;
  var cx = W / 2, cy = H / 2;
  var gap = 7 + G.player.bloom * 220;
  ctx.strokeStyle = hitT > 0 ? '#ff5470' : '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - gap - 8, cy); ctx.lineTo(cx - gap, cy);
  ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + gap + 8, cy);
  ctx.moveTo(cx, cy - gap - 8); ctx.lineTo(cx, cy - gap);
  ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + gap + 8);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.fillRect(cx - 1, cy - 1, 2, 2);
  if (hitT > 0) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    var o = 12;
    ctx.beginPath();
    ctx.moveTo(cx - o, cy - o); ctx.lineTo(cx - o + 7, cy - o + 7);
    ctx.moveTo(cx + o, cy - o); ctx.lineTo(cx + o - 7, cy - o + 7);
    ctx.moveTo(cx - o, cy + o); ctx.lineTo(cx - o + 7, cy + o - 7);
    ctx.moveTo(cx + o, cy + o); ctx.lineTo(cx + o - 7, cy + o - 7);
    ctx.stroke();
  }
}

function drawMinimap() {
  if (!G) return;
  var scale = 7, x0 = ARENA.W - MW * scale - 10, y0 = 10; // 30x20 map -> 210x140
  ctx.fillStyle = 'rgba(4,18,31,0.78)';
  ctx.fillRect(x0 - 4, y0 - 4, MW * scale + 8, MH * scale + 8);
  for (var y = 0; y < MH; y++) {
    for (var x = 0; x < MW; x++) {
      var t = MAP[y][x];
      if (t === '#') ctx.fillStyle = '#3a6ea5';
      else if (t === 'C') ctx.fillStyle = '#8a6d3b';
      else if (t === 'A') ctx.fillStyle = 'rgba(46,230,168,0.55)';
      else if (t === 'B') ctx.fillStyle = 'rgba(255,200,87,0.55)';
      else continue;
      ctx.fillRect(x0 + x * scale, y0 + y * scale, scale - 1, scale - 1);
    }
  }
  var p = G.player;
  // allies
  for (var i = 0; i < G.fighters.length; i++) {
    var f = G.fighters[i];
    if (!f.alive || f === p) continue;
    if (f.team === 'atk') {
      ctx.fillStyle = '#4db2ff';
      ctx.beginPath(); ctx.arc(x0 + f.x / CELL * scale, y0 + f.y / CELL * scale, 3, 0, Math.PI * 2); ctx.fill();
    } else if (f.visibleToPlayer) {
      ctx.fillStyle = '#ff5470';
      ctx.beginPath(); ctx.arc(x0 + f.x / CELL * scale, y0 + f.y / CELL * scale, 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  // charge
  if (G.charge.state === 'planted') {
    ctx.fillStyle = '#ffc857';
    ctx.beginPath(); ctx.arc(x0 + G.charge.x / CELL * scale, y0 + G.charge.y / CELL * scale, 4, 0, Math.PI * 2); ctx.fill();
  }
  // player arrow
  var px = x0 + p.x / CELL * scale, py = y0 + p.y / CELL * scale;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(px + Math.cos(p.angle) * 7, py + Math.sin(p.angle) * 7);
  ctx.lineTo(px + Math.cos(p.angle + 2.5) * 5, py + Math.sin(p.angle + 2.5) * 5);
  ctx.lineTo(px + Math.cos(p.angle - 2.5) * 5, py + Math.sin(p.angle - 2.5) * 5);
  ctx.closePath();
  ctx.fill();
}

function drawPlantBar() {
  if (!G) return;
  var c = G.charge;
  var W = ARENA.W, H = ARENA.H;
  ctx.textAlign = 'center';
  if (c.state === 'carried' && G.player.alive && c.plantProgress > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(W / 2 - 110, H - 120, 220, 26);
    ctx.fillStyle = '#ffc857';
    ctx.fillRect(W / 2 - 110, H - 120, 220 * (c.plantProgress / CFG.plantTime), 26);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('PLANTING...', W / 2, H - 101);
  }
  if (c.state === 'planted' && c.defuseProgress > 0) {
    ctx.fillStyle = '#ff5470';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('DEFUSE IN PROGRESS!', W / 2, 90);
  }
}

// ================= HUD =================
// HUD writes are cached: the DOM is only touched when a value actually
// changes, so updateHUD() can run every frame without layout thrash.
var hudCache = {};
function setText(id, val) {
  if (hudCache[id] !== val) { hudCache[id] = val; $(id).textContent = val; }
}
function setWidth(id, val) {
  if (hudCache[id] !== val) { hudCache[id] = val; $(id).style.width = val; }
}
function updateHUD() {
  if (!G) return;
  setText('round-label', 'ROUND ' + G.round);
  setText('score-label', 'ATK ' + G.scoreAtk + ' — ' + G.scoreDef + ' DEF');
  setText('credits', G.credits);
  var p = G.player;
  var rt = state === 'buy' ? G.phaseTimer : (state === 'combat' ? G.roundTimer : 0);
  setText('round-timer', fmtTime(rt));
  setWidth('hp-bar', Math.max(0, p.hp) + '%');
  setText('hp-text', Math.ceil(Math.max(0, p.hp)));
  setText('armor-text', Math.ceil(p.armor));
  var w = weaponOf(p);
  setText('weapon-name', w.name + (p.reloadT > 0 ? ' (reloading…)' : ''));
  setText('ammo-text', p.mag + ' / ' + p.reserve);
  setText('weapon-dmg', w.dmg + ' dmg');
  setText('smoke-cd', p.smokeCd > 0 ? Math.ceil(p.smokeCd) + 's' : 'READY');
  setText('dash-cd', p.dashCd > 0 ? Math.ceil(p.dashCd) + 's' : 'READY');
  setText('kills', G.kills);
  setText('deaths', G.deaths);
  setText('plants', G.plants);
  var c = G.charge;
  if (state === 'combat') {
    if (c.state === 'carried') setText('charge-status', c.plantProgress > 0 ? 'CHARGE: PLANTING ' + Math.ceil(c.plantProgress) + '/' + CFG.plantTime + 's' : 'CHARGE: CARRIED — GO TO SITE A/B');
    else if (c.state === 'planted') setText('charge-status', 'CHARGE: PLANTED @ ' + c.site + ' — ' + Math.ceil(c.fuse) + 's' + (c.defuseProgress > 0 ? ' · DEFUSE IN PROGRESS!' : ''));
    else setText('charge-status', 'CHARGE: LOST');
  }
}

// ================= Screens =================
function showScreen(id) {
  ['start-screen', 'pause-screen', 'end-screen'].forEach(function (s) { $(s).classList.add('hidden'); });
  if (id) $(id).classList.remove('hidden');
}
function showBuy(show) {
  $('buy-panel').classList.toggle('hidden', !show);
}
function showLockHint(show) {
  $('lock-hint').classList.toggle('hidden', !show);
}
function exitLock() {
  locked = false;
  if (typeof document !== 'undefined' && document.exitPointerLock) {
    try { document.exitPointerLock(); } catch (e) {}
  }
  showLockHint(false);
}

function togglePause() {
  if (state !== 'buy' && state !== 'combat' && state !== 'roundEnd') return;
  paused = !paused;
  if (paused) {
    exitLock();
    showScreen('pause-screen');
  } else {
    showScreen(null);
    if (state === 'combat' && !isTouch) lockPointer();
  }
}

function lockPointer() {
  if (isTouch) return;
  try {
    if (canvas.requestPointerLock) {
      var r = canvas.requestPointerLock();
      if (r && r.catch) r.catch(function () {});
    }
  } catch (e) {}
}

// ================= Input =================
function bindInput() {
  document.addEventListener('keydown', function (e) {
    var k = e.key.toLowerCase();
    keys[k] = true;
    if (k === ' ' || k === 'arrowup' || k === 'arrowdown') e.preventDefault();
    if (k === 'm') {
      AudioSys.init();
      var muted = AudioSys.toggleMute();
      centerMsg(muted ? 'SOUND MUTED' : 'SOUND ON', 1);
      return;
    }
    if (k === 'escape' || k === 'p') { togglePause(); return; }
    if (k === 'enter' && state === 'buy') { startCombat(); return; }
    if (state === 'buy' && ['1', '2', '3', '4', '5'].indexOf(k) >= 0) {
      if (k === '1') buyItem('pistol');
      if (k === '2') buyItem('smg');
      if (k === '3') buyItem('rifle');
      if (k === '4') buyItem('sniper');
      if (k === '5') buyItem('armor');
      return;
    }
    if (state !== 'combat') return;
    if (k === 'r') startReload(G.player);
    if (k === 'q') useSmoke();
    if (k === ' ') useDash();
  });
  document.addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });

  // Pointer lock + mouse look + shoot
  canvas.addEventListener('click', function () {
    if (state === 'combat' && !isTouch && !locked) lockPointer();
  });
  document.addEventListener('mousemove', function (e) {
    if (locked && state === 'combat' && G && G.player.alive) {
      // clamp wild deltas (pointer-lock glitches / alt-tab jumps) and feed
      // the smoothed look target — the angle chases it in updatePlayer
      var dx = clamp(e.movementX || 0, -150, 150);
      G.player.targetAngle = normAngle(G.player.targetAngle + dx * SENS);
    }
  });
  document.addEventListener('pointerlockchange', function () {
    locked = document.pointerLockElement === canvas;
    if (!locked) {
      if (state === 'combat' && !paused) togglePause();
      else showLockHint(false);
    } else {
      showLockHint(false);
    }
  });
  document.addEventListener('mousedown', function (e) {
    if (e.button === 0 && state === 'combat' && locked && !isTouch) mouse.down = true;
  });
  document.addEventListener('mouseup', function (e) {
    if (e.button === 0) mouse.down = false;
  });

  // Touch: look-drag on the right side of the canvas
  canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      var x = t.clientX - rect.left;
      if (x > rect.width * 0.45 && !lookTouch.active) {
        lookTouch.active = true;
        lookTouch.id = t.identifier;
        lookTouch.lx = t.clientX;
        lookTouch.ly = t.clientY;
      }
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', function (e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (lookTouch.active && t.identifier === lookTouch.id && G && G.player.alive && state === 'combat') {
        var tdx = clamp(t.clientX - lookTouch.lx, -60, 60);
        G.player.targetAngle = normAngle(G.player.targetAngle + tdx * 0.005);
        lookTouch.lx = t.clientX;
        lookTouch.ly = t.clientY;
      }
    }
  }, { passive: false });
  canvas.addEventListener('touchend', function (e) {
    for (var i = 0; i < e.changedTouches.length; i++) {
      if (lookTouch.active && e.changedTouches[i].identifier === lookTouch.id) lookTouch.active = false;
    }
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && (state === 'combat' || state === 'buy') && !paused) togglePause();
  });

  // Buttons
  $('start-btn').addEventListener('click', function () {
    AudioSys.init();
    newMatch();
    showScreen(null);
    if (!isTouch) showLockHint(false);
  });
  $('start-round-btn').addEventListener('click', function () { startCombat(); });
  $('resume-btn').addEventListener('click', function () { togglePause(); });
  $('restart-btn').addEventListener('click', function () {
    paused = false;
    newMatch();
    showScreen(null);
  });
  $('play-again-btn').addEventListener('click', function () {
    newMatch();
    showScreen(null);
  });

  // Touch controls
  if ('ontouchstart' in window || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)) {
    isTouch = true;
    $('touch-controls').classList.remove('hidden');
  }
  var stickEl = $('stick'), knob = $('stick-knob');
  function stickPos(t) {
    var rect = stickEl.getBoundingClientRect();
    var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    var dx = (t.clientX - cx) / (rect.width / 2), dy = (t.clientY - cy) / (rect.height / 2);
    var l = Math.sqrt(dx * dx + dy * dy);
    if (l > 1) { dx /= l; dy /= l; }
    stick.dx = dx; stick.dy = dy;
    knob.style.transform = 'translate(calc(-50% + ' + dx * 32 + 'px), calc(-50% + ' + dy * 32 + 'px))';
  }
  stickEl.addEventListener('touchstart', function (e) {
    e.preventDefault();
    stick.active = true;
    stick.id = e.changedTouches[0].identifier;
    stickPos(e.changedTouches[0]);
  }, { passive: false });
  stickEl.addEventListener('touchmove', function (e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === stick.id) stickPos(e.changedTouches[i]);
    }
  }, { passive: false });
  function stickEnd(e) {
    stick.active = false; stick.dx = 0; stick.dy = 0;
    knob.style.transform = 'translate(-50%, -50%)';
  }
  stickEl.addEventListener('touchend', stickEnd);
  stickEl.addEventListener('touchcancel', stickEnd);

  function holdButton(id, down, up) {
    var el = $(id);
    el.addEventListener('touchstart', function (e) { e.preventDefault(); down(); }, { passive: false });
    el.addEventListener('touchend', function (e) { e.preventDefault(); if (up) up(); }, { passive: false });
    el.addEventListener('mousedown', function (e) { e.preventDefault(); down(); });
    el.addEventListener('mouseup', function () { if (up) up(); });
  }
  holdButton('btn-fire', function () { touchFire = true; }, function () { touchFire = false; });
  holdButton('btn-smoke', function () { useSmoke(); });
  holdButton('btn-dash', function () { useDash(); });
  holdButton('btn-reload', function () { if (G) startReload(G.player); });
}

// ================= Loop / init =================
var dtSmooth = 0.016; // exponentially smoothed frame delta (seconds)
function loop(ts) {
  var raw = (ts - lastTs) / 1000;
  if (!(raw > 0) || raw > 0.25) raw = 0.016; // first frame / tab-switch spike
  lastTs = ts;
  // smooth frame pacing: a single hitch is spread over several frames
  // instead of one big jump, then clamped to the same 50ms ceiling
  dtSmooth += (raw - dtSmooth) * 0.35;
  var dt = clamp(dtSmooth, 0.004, 0.05);
  if (G && (state === 'buy' || state === 'combat')) update(dt);
  try { draw(); } catch (e) {}
  requestAnimationFrame(loop);
}

function init() {
  computeSiteCenters();
  bindInput();
  newMatch();
  state = 'menu';
  showBuy(false);
  showScreen('start-screen');
  requestAnimationFrame(loop);
}

// ================= Test hooks =================
function setState(s) { state = s; }
function setPlayerPos(x, y, angle) {
  G.player.x = x; G.player.y = y;
  if (typeof angle === 'number') { G.player.angle = angle; G.player.targetAngle = angle; }
}
function setFighterPos(f, x, y) { f.x = x; f.y = y; }
function setKeys(map) { keys = map || {}; }
function setMouseDown(v) { mouse.down = v; }
function setTouchFire(v) { touchFire = v; }
function getState() { return state; }
function getG() { return G; }
function getPaused() { return paused; }

if (typeof window !== 'undefined') {
  window.C9Strike = {
    newMatch: newMatch, startCombat: startCombat, buyItem: buyItem,
    fireWeapon: fireWeapon, update: update, updatePlayer: updatePlayer, updateBot: updateBot,
    useSmoke: useSmoke, useDash: useDash, startReload: startReload,
    endRound: endRound, endMatch: endMatch, spawnRound: spawnRound, makeFighter: makeFighter,
    hasLOS: hasLOS, dist: dist, siteAtPos: siteAtPos, aliveCount: aliveCount,
    damageFighter: damageFighter, castRay: castRay, cellAt: cellAt, isSolidAt: isSolidAt,
    draw: draw, setState: setState, setPlayerPos: setPlayerPos, setFighterPos: setFighterPos,
    setSensitivity: function (v) { SENS = clamp(+v || 0.0022, 0.0005, 0.01); return SENS; },
    getSensitivity: function () { return SENS; },
    setKeys: setKeys, setMouseDown: setMouseDown, setTouchFire: setTouchFire,
    getState: getState, getG: getG, getPaused: getPaused,
    CFG: CFG, WEAPONS: WEAPONS, MAP: MAP, MW: MW, MH: MH, CELL: CELL,
    get canvas() { return canvas; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
} else if (typeof module !== 'undefined') {
  module.exports = { init: init };
}

})();

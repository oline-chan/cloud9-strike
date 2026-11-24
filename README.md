# Cloud9 Strike — Tactical FPS

First-person tactical shooter (raycasting, Wolfenstein-style) for the
**Cloud9 x JetBrains: Sky's The Limit Hackathon 2026 — Category 3: Event Mini Game**.

You are **Volt** of the attacking team with 2 ally bots vs 3 defender bots.
Plant the **Charge** in Site A or B, guard it till it detonates — or eliminate the
whole enemy team. First to **5 rounds** wins the match.

100% original assets: no Riot IP, no Valorant names/agents/maps/terms.
"Cloud9" appears as text only. The Charge is the bomb — not a Spike.

## How to run

No build step, no npm dependencies. Open `index.html` in a browser, or serve it:

```bash
cd cloud9-strike
python3 -m http.server 8000
# open http://localhost:8000
```

## How to play

| Input | Action |
|---|---|
| WASD | Move (relative to your view) |
| Mouse | Look — click the game to lock the mouse (Pointer Lock) |
| Click | Shoot (hold for auto weapons) |
| R | Reload |
| Q | Smoke screen (blocks bot vision for 8s) |
| Space | Dash (short speed burst) |
| Shift | Walk slow |
| Esc / P | Pause (Esc also exits mouse lock) |
| M | Mute |
| Enter | Start round early (buy phase) |
| 1–5 | Buy: Pistol (free) / SMG / Rifle / Sniper / Armor |

Mobile: left virtual joystick to move, drag the right side of the screen to look,
FIRE button to shoot (with a little aim assist), SMOKE / DASH / RLD buttons.

## Rules

- **Buy phase (15s):** spend credits on weapons and armor. Kills pay ₡200,
  a won round ₡800, a lost round ₡400. Weapons are kept between rounds.
- **Combat (120s):** stand in Site A or B for 3s to plant the Charge.
  After planting, guard it for 38s until it detonates.
- **Defenders** try to stop the plant, and defuse a planted Charge in 5s.
- **Round win:** Charge detonates, or the whole enemy team is eliminated.
  **Round loss:** your team is eliminated, the Charge is defused, or time runs out.
- **Match:** first to 5 rounds.

## Bots

- Defenders patrol and guard their site, investigate gunshots they hear
  (only after the first 8s of a round, so rounds don't snowball early),
  retreat when HP is low, and move in to defuse a planted Charge.
- Allies advance to their site and guard a planted Charge.
- Enemies only become visible on the minimap when your team has line of sight.

## Tech

- Vanilla HTML/CSS/JS, Canvas 2D. No dependencies, no build step.
- Rendering: DDA raycasting over a 30×20 grid map — shaded walls per type
  (concrete / crates), ceiling + floor gradients, billboard sprites for
  fighters, site signs, the Charge and smoke, a weapon viewmodel with muzzle
  flash, crosshair with bloom + hitmarker, tracers, and a live minimap.
- Combat: hitscan shooting with spread, recoil/bloom, armor (absorbs 50%),
  reload, weapon range / fire-rate / magazine differences.
- Sound: WebAudio only, no audio files.
- JetBrains evidence: `.idea/` WebStorm module (see the other Cloud9 repos
  for the same pattern).

## JetBrains — evidence (honest)

- This project was created with a **JetBrains WebStorm** project
  configuration — the `.idea/` folder holds the project config.
- **It has never been opened in real WebStorm.** The `.idea/` files were
  authored as project configuration and have not been inspected in the IDE.
- **JetBrains Air was not used** — the author has never used JetBrains Air.
- The AI workflow story is in `AI_SHOWCASE.md` (for the "Best AI-Powered
  Workflow Story" bonus entry — it must be submitted in the bonus column
  at Devpost submission time; the file in the repo alone does not count).

## Files

- `index.html` — page, HUD, screens, touch controls
- `style.css` — Cloud9 blue theme
- `game.js` — everything: map, raycasting, AI, rounds, economy, rendering
- `README.md` — this file
- `LICENSE` — MIT, © 2026 Gallagher Satrio

## Verified

- `node --check game.js` passes.
- Local HTTP server: all files return 200.
- All `getElementById` targets exist in `index.html` (18 ids used, 48 in the page).
- Map 30×20: 443 walkable cells, flood fill proves all reachable from the
  attacker spawn; Site A, Site B, and all spawns reachable.
- Headless smoke test (Node vm + stub DOM/canvas, `/tmp/c9strike-smoke.js`):
  **31/31 PASS** — match starts, spawn positions, buy works, raycasting
  distances (up 352 / down 608 / left 288 / right 1504 from cell (5,9)),
  LOS, shooting reduces enemy HP, kill credits, armor, charge drop on death,
  planting completes, fuse explosion (38s) wins the round, defuse (5s) wins
  for defenders, elimination ends a round, bot retreat, early-round
  investigation grace, smoke/dash, `draw()` runs, match ends at 5 rounds.
- Smoothness test (`/tmp/c9strike-smooth-test.js`): **12/12 PASS** — RAYS 480,
  velocity ramps, look convergence without overshoot, sensitivity hook, bot
  turning/velocity easing, HUD steady-state writes, 360° raycasting finite.
- 45s unattended simulation (`/tmp/c9strike-sim.js`): **0 errors**; round 1
  still in combat at 45s (120s timer + bigger map = longer rounds).

## Not yet verified

- No full match has been played end-to-end in a real browser.
- Balance with an active human player is untested (bots were tuned against
  an idle player in simulation).
- Pointer Lock behaviour varies by browser; mobile touch look is untested on
  a real phone.
- No demo video, no GitHub repo, no deploy yet.

## License

MIT — see `LICENSE`.

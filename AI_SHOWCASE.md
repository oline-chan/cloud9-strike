# AI Showcase — Cloud9 Strike

Case study for the **Best AI-Powered Workflow Story** bonus entry
(Cloud9 x JetBrains: Sky's The Limit Hackathon 2026, Category 3: Event Mini Game).

> **Important:** this file is the workflow story. The file in the repo alone
> is **not enough** — the bonus entry must be selected/submitted in the
> "Best AI-Powered Workflow Story" bonus prize column at Devpost submission time.

## What was built

**Cloud9 Strike** — a first-person tactical shooter (DDA raycasting,
Wolfenstein-style). You are Volt with 2 ally bots vs 3 defender bots: rounds
with a buy phase (Pistol/SMG/Rifle/Sniper + armor), plant/defuse the Charge
at Site A/B, first to 5 rounds. Vanilla HTML/CSS/JS, no framework, no npm,
100% original assets (no Riot IP, no Valorant names — the bomb is the
"Charge", not a Spike).

## Workflow: human + AI

1. **Idea & decisions (human — Gallagher Satrio).** After the aim trainer
   and the mini MOBA, the human asked for "a war game like Valorant" — and
   then insisted on one thing: **the view must be POV** ("Yang penting view
   nya POV"). A full 5v5 3D FPS was honestly ruled out; a first-person
   raycasting shooter was built instead.
2. **Implementation (AI — Muse, AI coding agent, persona Oline).** The AI
   wrote the game (1,559 lines of `game.js` after the smoothness pass):
   320→480-ray DDA raycasting, billboard sprites, weapon viewmodel, buy
   phase, bot AI, HUD, minimap, touch controls.
3. **Verification (AI).** `node --check`, local server + curl HTTP 200,
   `getElementById` cross-check, headless smoke test **27/27 PASS** (later
   31/31 after the map expansion), smoothness test **12/12 PASS**, 45-second
   unattended simulation with 0 errors.
4. **Playtest & iteration (human + AI).** The human played the playable
   artifact and gave short, direct feedback, and the AI iterated on exactly
   that: "Bagus, cuma bikin lebih smooth lagi coba" → smoothness pass
   (exponential mouse-look smoothing, velocity-based movement, frame pacing);
   "map-nya diperluas, ronde dipanjangkan, match kelar terlalu cepat" →
   map 20×14 → 30×20 (three lanes), round timer 90 → 120s, fuse 25 → 38s.
   The human then approved it: "Dah bagus itu, tinggal improve tipis tipis aja."
5. **Documentation (AI).** README, build report, and this file.

## Tools used

- **Muse (AI coding agent)** — code generation, static verification,
  playable artifact builds, iteration from human playtest feedback.
- **JetBrains WebStorm** — project configuration `.idea/` included in the
  repo. Honest note: this project has **never been opened in real WebStorm**
  at the time of writing. **JetBrains Air was not used** — the author has
  never used JetBrains Air.

## What is NOT claimed

- No "only one" claim — no rival gallery check has been done.
- No bot playtest percentages — there are no bot playtest numbers in this
  project.
- No full match has been played end-to-end in a real browser by a human at
  the time of writing; balance against an active human player is untested
  (bots were tuned against an idle player in simulation).

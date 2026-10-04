import { launch, shot, sleep, BASE, attachLogs } from "./lib.mjs";

// node scripts/qa/pad-smoke.mjs
// Drives the REAL host page with simulated Xbox / PlayStation pads (navigator.getGamepads is stubbed):
// join -> choose fighter -> ready -> start -> move / attack / right-stick smash -> rumble -> unplug.
// Software GL is slow, so waits are generous; the checks are on game state, not frame rate.

const FAKE_PADS = `
  (() => {
    window.__rumbles = [];
    window.__pads = [null, null, null, null];
    const mk = (index, id) => ({
      id, index, connected: true, mapping: "standard", timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
      vibrationActuator: { playEffect: (type, params) => { window.__rumbles.push({ index, type, ...params }); return Promise.resolve("complete"); } },
    });
    navigator.getGamepads = () => window.__pads.slice();
    window.__plug = (i, id) => { window.__pads[i] = mk(i, id); };
    window.__unplug = (i) => { window.__pads[i] = null; };
    window.__set = (i, o = {}) => {
      const p = window.__pads[i]; if (!p) return;
      p.axes = o.axes ?? [0, 0, 0, 0];
      p.buttons = Array.from({ length: 17 }, (_, k) => ({ pressed: (o.down ?? []).includes(k), value: (o.down ?? []).includes(k) ? 1 : 0 }));
    };
  })();
`;
const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const browser = await launch();
const logs = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const host = await ctx.newPage();
attachLogs(host, "host", logs);
await host.addInitScript(FAKE_PADS);
await host.goto(`${BASE}/${process.env.AIRBRAWL_QUERY ?? ""}`, { waitUntil: "domcontentloaded" });
await sleep(3500);

const state = () => host.evaluate(() => window.__airBrawlState?.());
// Taps must outlast one rendered frame: software GL here runs at only a few fps.
const pressUntil = async (i, down, predicate, tries = 6) => {
  for (let t = 0; t < tries; t += 1) {
    await press(i, down, 300);
    for (let k = 0; k < 8; k += 1) {
      await sleep(120);
      if (await predicate(await state())) return true;
    }
  }
  return false;
};
const press = async (i, down, ms = 350) => {
  await host.evaluate(([i, down]) => window.__set(i, { down }), [i, down]);
  await sleep(ms);
  await host.evaluate((i) => window.__set(i, {}), i);
  await sleep(ms);
};

// 1. Plug in an Xbox pad and a DualSense; nothing joins until a button is pressed.
await host.evaluate(() => {
  window.__plug(0, "Xbox 360 Controller (XInput STANDARD GAMEPAD)");
  window.__plug(1, "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)");
});
await sleep(500);
let s = await state();
check("plugged-in pads do not join until a button is pressed", s.players.filter((p) => p.local).length === 0);

// 2. Press a button on each pad to join.
// (Taps retry until seen: the stubbed renderer here runs at only a few fps and polling can miss a short tap.)
await pressUntil(0, [B.A], (st) => st.players.filter((p) => p.local).length >= 1);
await pressUntil(1, [B.START], (st) => st.players.filter((p) => p.local).length >= 2);
await sleep(600);
s = await state();
const locals = s.players.filter((p) => p.local);
check("both pads joined as local players", locals.length === 2, locals.map((p) => p.name).join(", "));
check("pad names reflect device type", locals.some((p) => p.name.startsWith("Xbox")) && locals.some((p) => p.name.startsWith("PlayStation")));
await shot(ctx, host, "pad-lobby-joined");

// 3. Choose a fighter with the D-pad, then ready up.
const p0 = locals.find((p) => p.name.startsWith("Xbox"));
await press(0, [B.RIGHT]);
await sleep(400);
s = await state();
const p0after = s.players.find((p) => p.id === p0.id);
check("D-pad right changes fighter", p0after.fighter !== p0.fighter, `${p0.fighter} -> ${p0after.fighter}`);

check("A readies up", await pressUntil(0, [B.A], (st) => st.players.find((p) => p.id === p0.id)?.ready === true));
check("a ready player cannot change fighter", await (async () => {
  const before = (await state()).players.find((p) => p.id === p0.id).fighter;
  await press(0, [B.RIGHT]);
  await sleep(300);
  return (await state()).players.find((p) => p.id === p0.id).fighter === before;
})());
check("B un-readies", await pressUntil(0, [B.B], (st) => st.players.find((p) => p.id === p0.id)?.ready === false));

// 4. Leader tweaks setup with LB/RB and starts with Start.
const leaderId = s.players.filter((p) => p.connected).sort((a, b) => a.slot - b.slot)[0].id;
check("first pad to join is the room leader", leaderId === p0.id);
check("leader RB adds a CPU", await pressUntil(0, [B.RB], (st) => st.players.some((p) => p.id.startsWith("bot-"))));
s = await state();
await shot(ctx, host, "pad-lobby-setup");
await pressUntil(0, [B.A], (st) => st.players.find((p) => p.id === p0.id)?.ready === true);
const p1id = locals.find((p) => p.id !== p0.id).id;
await pressUntil(1, [B.A], (st) => st.players.find((p) => p.id === p1id)?.ready === true);
await sleep(600);
// Wait for auto-start (everyone ready) and the fight phase.
for (let i = 0; i < 80; i += 1) {
  s = await state();
  if (s.phase === "playing") break;
  await sleep(500);
}
check("match starts once every pad is ready", s.phase === "playing", `phase=${s.phase}`);
await sleep(1200);

// 5. In the match: stick moves the pad's fighter, buttons act.
const me = () => state().then((st) => st.fighters.find((f) => f.id === p0.id));
let f = await me();
const x0 = f.x;
await host.evaluate(() => window.__set(0, { axes: [1, 0, 0, 0] }));
await sleep(900);
f = await me();
check("left stick moves the fighter", Math.abs(f.x - x0) > 40, `x ${x0} -> ${f.x}`);
await host.evaluate(() => window.__set(0, {}));
await sleep(700);

let seenMove = null;
for (let t = 0; t < 5 && !/^(jab|ftilt|dashAttack)/.test(seenMove ?? ""); t += 1) {
  await host.evaluate(() => window.__set(0, { down: [0] }));
  for (let k = 0; k < 12 && !/^(jab|ftilt|dashAttack)/.test(seenMove ?? ""); k += 1) {
    await sleep(60);
    seenMove = (await me()).moveId;
  }
  await host.evaluate(() => window.__set(0, {}));
  await sleep(250);
}
check("A starts a ground attack", /^(jab|ftilt|dashAttack)/.test(seenMove ?? ""), `move=${seenMove}`);
for (let i = 0; i < 60 && (await me()).state === "attack"; i += 1) await sleep(100);

// Right-stick flick -> smash.
await host.evaluate(() => window.__set(0, { axes: [0, 0, 1, 0] }));
// The renderer runs at a few fps here, so poll the sim state instead of sampling once.
seenMove = null;
for (let i = 0; i < 60 && !/smash/.test(seenMove ?? ""); i += 1) {
  await sleep(50);
  seenMove = (await me()).moveId;
}
check("right-stick flick launches a smash", /smash/.test(seenMove ?? ""), `move=${seenMove}`);
await host.evaluate(() => window.__set(0, {}));
for (let i = 0; i < 100 && ((await me()).state === "attack" || (await me()).state === "special"); i += 1) await sleep(100);

// Jump and shield.
let jumped = false;
for (let t = 0; t < 5 && !jumped; t += 1) {
  await host.evaluate(() => window.__set(0, { down: [2] })); // X
  for (let k = 0; k < 10 && !jumped; k += 1) {
    await sleep(80);
    f = await me();
    jumped = f.state === "jumpsquat" || f.state === "airborne";
  }
  await host.evaluate(() => window.__set(0, {}));
  await sleep(300);
}
check("X jumps", jumped, `state=${f.state}`);
for (let i = 0; i < 80 && (await me()).state !== "idle"; i += 1) await sleep(100);
await host.evaluate(() => window.__set(0, { down: [6] })); // LT
let shielded = false;
for (let i = 0; i < 60 && !shielded; i += 1) {
  await sleep(50);
  f = await me();
  shielded = f.state === "shield" || f.state === "shieldStun";
}
check("trigger shields", shielded, `state=${f.state}`);
await host.evaluate(() => window.__set(0, {}));
await shot(ctx, host, "pad-in-match");

// 6. Rumble reaches the pad: walk at the CPU and attack until someone takes a hit.
for (let i = 0; i < 160; i += 1) {
  const st = await state();
  const mine = st.fighters.find((x) => x.id === p0.id);
  const foe = st.fighters.find((x) => x.id !== p0.id && x.id.startsWith("bot-")) ?? st.fighters.find((x) => x.id !== p0.id);
  if (!mine || !foe) break;
  const dir = foe.x > mine.x ? 1 : -1;
  const near = Math.abs(foe.x - mine.x) < 90;
  await host.evaluate(([dir, near]) => window.__set(0, { axes: [near ? 0 : dir, 0, 0, 0], down: near ? [0] : [] }), [dir, near]);
  await sleep(120);
  if ((await host.evaluate(() => window.__rumbles.length)) > 0) break;
}
await host.evaluate(() => window.__set(0, {}));
const rumbles = await host.evaluate(() => window.__rumbles.length);
check("controller rumble fired during play", rumbles > 0, `${rumbles} effects`);

// 7. Unplug mid-match: fighter goes idle (OFFLINE), match keeps running without errors.
await host.evaluate(() => window.__unplug(1));
await sleep(900);
s = await state();
const dropped = s.players.find((p) => p.local && p.id !== p0.id);
check("unplugged pad is marked offline, not removed, mid-match", !!dropped && dropped.connected === false);
check("match is still running", s.phase === "playing");

const errors = logs.filter((l) => !/AudioContext|404|SESSION_NOT_READY|autoplay/i.test(l));
check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);

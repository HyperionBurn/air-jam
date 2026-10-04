import { launch, shot, sleep, BASE, attachLogs } from "./lib.mjs";

// node scripts/qa/pad-controller.mjs
// A gamepad paired with the phone/laptop that opened /controller: D-pad moves focus, A presses, Start readies.

const FAKE_PAD = `
  (() => {
    window.__pads = [null, null, null, null];
    navigator.getGamepads = () => window.__pads.slice();
    window.__plug = (i, id) => { window.__pads[i] = { id, index: i, connected: true, mapping: "standard", timestamp: 0, axes: [0,0,0,0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }; };
    window.__set = (i, o = {}) => {
      const p = window.__pads[i]; if (!p) return;
      p.axes = o.axes ?? [0, 0, 0, 0];
      p.buttons = Array.from({ length: 17 }, (_, k) => ({ pressed: (o.down ?? []).includes(k), value: (o.down ?? []).includes(k) ? 1 : 0 }));
    };
  })();
`;
const B = { A: 0, START: 9, DOWN: 13, UP: 12 };
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const browser = await launch();
const logs = [];
const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const host = await hostCtx.newPage();
attachLogs(host, "host", logs);
await host.addInitScript("window.__noop = 1;");
await host.goto(`${BASE}/${process.env.AIRBRAWL_QUERY ?? ""}`, { waitUntil: "domcontentloaded" });
await sleep(3000);
const room = await host.evaluate(() => document.body.innerText.match(/ROOM CODE\s*([A-Z0-9]{4})/i)?.[1]);
check("host shows a room code", !!room, room);

const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const phone = await phoneCtx.newPage();
attachLogs(phone, "phone", logs);
await phone.addInitScript(FAKE_PAD);
await phone.goto(`${BASE}/controller?room=${room}`, { waitUntil: "domcontentloaded" });
await sleep(5000);

const press = async (down, ms = 350) => {
  await phone.evaluate((d) => window.__set(0, { down: d }), down);
  await sleep(ms);
  await phone.evaluate(() => window.__set(0, {}));
  await sleep(ms);
};
const hostPlayers = () => host.evaluate(() => window.__airBrawlState?.().players ?? []);
const phoneReady = async () => (await hostPlayers()).filter((p) => !p.local).some((p) => p.ready);

await phone.evaluate(() => window.__plug(0, "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"));
let badge = false;
for (let i = 0; i < 20 && !badge; i += 1) {
  await sleep(300);
  badge = await phone.evaluate(() => document.documentElement.hasAttribute("data-pad-nav"));
}
check("controller page detects the pad (focus ring enabled)", badge);
check("badge names the pad type", /PlayStation/i.test(await phone.evaluate(() => document.body.innerText)));

let moved = false;
for (let t = 0; t < 5 && !moved; t += 1) {
  await press([B.DOWN]);
  moved = await phone.evaluate(() => document.activeElement && document.activeElement !== document.body);
}
check("D-pad moves focus onto a control", moved, await phone.evaluate(() => document.activeElement?.textContent?.slice(0, 30)));

let ready = false;
for (let t = 0; t < 6 && !ready; t += 1) {
  await press([B.START]);
  for (let k = 0; k < 8 && !ready; k += 1) {
    await sleep(150);
    ready = await phoneReady();
  }
}
check("Start readies the player", ready);
await shot(phoneCtx, phone, "pad-controller-lobby");

const errors = logs.filter((l) => !/AudioContext|404|SESSION_NOT_READY|autoplay/i.test(l));
check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);

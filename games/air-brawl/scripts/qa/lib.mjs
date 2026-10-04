import { chromium } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Visual QA helpers (headless Chromium + software GL). Screenshots use CDP
 * Page.captureScreenshot because Playwright's own capture stalls on a page that
 * renders continuously with WebGL.
 *
 *   AIRBRAWL_URL   host URL (default http://localhost:5173)
 *   AIRBRAWL_OUT   screenshot folder (default <tmp>/air-brawl-shots)
 *   AIRBRAWL_CHROME  optional path to a Chromium/Chrome executable
 */
export const BASE = process.env.AIRBRAWL_URL ?? "http://localhost:5173";
export const OUT = process.env.AIRBRAWL_OUT ?? path.join(os.tmpdir(), "air-brawl-shots");
fs.mkdirSync(OUT, { recursive: true });

export const launch = () =>
  chromium.launch({
    executablePath: process.env.AIRBRAWL_CHROME || undefined,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"],
  });

export const shot = async (ctx, page, name, clip, scale = 1) => {
  const cdp = await ctx.newCDPSession(page);
  const params = { format: "png" };
  if (clip) params.clip = { ...clip, scale };
  const r = await cdp.send("Page.captureScreenshot", params);
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(r.data, "base64"));
  await cdp.detach();
  return file;
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const attachLogs = (page, tag, logs) => {
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type())) logs.push(`[${tag}:${m.type()}] ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => logs.push(`[${tag}:pageerror] ${e.message.slice(0, 400)}`));
};

/** Open the host, join one phone as leader, add CPUs, pick a stage, ready up. */
export const startMatch = async (browser, { bots = 3, stage, preset, viewport = { width: 1600, height: 900 }, logs = [] } = {}) => {
  const hostCtx = await browser.newContext({ viewport });
  const host = await hostCtx.newPage();
  attachLogs(host, "host", logs);
  await host.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await sleep(2500);
  const room = await host.evaluate(() => document.body.innerText.match(/ROOM CODE\s*([A-Z0-9]{4})/i)?.[1]);
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const phone = await phoneCtx.newPage();
  attachLogs(phone, "phone", logs);
  await phone.goto(`${BASE}/controller?room=${room}`, { waitUntil: "domcontentloaded" });
  await sleep(4500);
  if (preset) await phone.getByText(preset).first().click({ timeout: 10000 });
  await phone.getByText("Show all options").click({ timeout: 10000 });
  await phone.locator("text=CPU fighters").locator("xpath=following-sibling::*").getByText(String(bots), { exact: true }).click({ timeout: 8000 });
  if (stage) await phone.getByRole("button", { name: stage }).first().click({ timeout: 8000 }).catch(() => {});
  await phone.getByRole("button", { name: /ready/i }).first().click();
  return { hostCtx, host, phoneCtx, phone, room };
};

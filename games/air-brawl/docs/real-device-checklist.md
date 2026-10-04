# Real-device checklist

Everything below needs hardware this build was **not** verified on. Automated checks
(unit tests, headless Chromium with software GL, viewport emulation) cannot stand in for it.

## Phones

- [ ] iPhone Safari and Android Chrome, portrait and landscape: stick appears under the thumb, never drifts after release, five pads reachable one-handed, no page scroll/zoom/long-press menu.
- [ ] Multi-touch: hold stick + jump + attack together; lift fingers in odd orders; nothing stays held.
- [ ] Background the browser mid-match, lock the screen, pull down notification shade: the fighter must stop running/shielding (watchdog) and rejoin cleanly.
- [ ] Haptics on Android (Vibration API) and the iOS fallback behaviour; turn haptics off in phone prefs.
- [ ] Rotate while holding a button.
- [ ] Wi-Fi: 8 phones on a congested network; read the debug overlay for packet rate / age / jitter / RTT and compare against the "Input feel" table below.

## Host display

- [ ] Real GPU (integrated Intel/AMD and a discrete card) at 1080p and 4K: sustained fps, adaptive-quality level in the debug overlay, shadow and bloom cost.
- [ ] Projector colour/contrast: slot colours + shapes readable at distance; HUD safe margins on TV overscan.
- [ ] Audio through speakers: mix levels (hits vs music vs announcer), crowd swell, KO impact.
- [ ] Browser autoplay: "Click to enable sound" gate appears once and music starts after a click.

## Input feel (fill in on site)

| Metric | Target | Measured |
| --- | --- | --- |
| Packet rate while stick active | 60–120 /s | |
| Input age (p95) | < 40 ms | |
| Relative jitter | < 15 ms | |
| RTT probe | < 80 ms | |

## Event dry-run

- [ ] 8 players join via QR in < 60 s.
- [ ] Auto-rematch (event mode) keeps the room moving for 5 consecutive matches; leaderboard accumulates.
- [ ] A player leaves and re-scans: slot and fighter restored within the 30 s lease.

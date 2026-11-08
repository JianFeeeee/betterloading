# betterloading

**English** | [简体中文](README.zh.md)

A **frosted-glass pouring loader** for the [DeepSeek Harness](https://github.com/deepseek-ai/dsh) (dsh) web UI.

The most familiar slow-network scene: the shell UI has already rendered, but the session list, workspaces and jobs are still in flight, leaving a blank area — you cannot tell loading from frozen. This plugin covers the unfinished part with a pane of frosted glass, **raises the water line with real load progress, lets the frost recede with it, and fades the page into clarity**. At the end the plate fades out and the overlay is removed.

> It does not fake progress. The water level is driven by real events: static resources completing, the app mounting, and every `/api` request starting and finishing.

## Features

- **Causal physics**: each finished load drops one invisible blob of water from a **random horizontal position** above the surface. It splashes, and its volume is poured in continuously (smoothstep, with ease-in/ease-out) so the level rises by exactly how much that blob carried.
- **A real water surface**: a 1-D damped wave equation integrated every frame. Waves travel, reflect off both edges, and interfere. Not a scrolling texture.
- **The blur boundary *is* the water surface**: the frost layer's clip geometry is regenerated from the wave curve every frame (`clip-path: path(...)`), not a horizontal line.
- **Two frost modes** (below): static sampling (default, zero realtime filters) or real blur.
- **Theme aware**: follows dsh's `body[data-ds-dark-theme]` for both palette and plate styling.
- **Never touches your business requests**: `fetch` is wrapped for counting only and returns the original promise; no dsh package file is modified.
- **Never traps you**: removed on content-ready, with a fallback check and a hard timeout.

## Install

```bash
dsh plugin --profile web add betterloading
```

The CLI reads the `dsh.bundle` declaration and registers it in `dsh.profile.bundles` — no manual patch editing.

Uninstall:

```bash
dsh plugin --profile web remove betterloading
```

## Two frost modes (`mode`)

| | `static` | `realtime` (default) |
|---|---|---|
| Implementation | Sample the page's base colour once + tile a generated noise texture | Real `backdrop-filter: blur()` |
| Look | Frosted film (grain) | Real glass — you can see blurred shapes behind it |
| Compositing cost | **No realtime filters** | Blurs only the band |
| Measured fps | 60 | ~36 (while the frosted area is nearly full-screen early on) |

In earlier builds `realtime` dropped to 34fps because **a full-screen `backdrop-filter` sat underneath a full-screen canvas repainting every frame**, forcing the compositor to re-blur the whole backdrop each frame. A layered structure fixes it — both modes now measure 60fps:

```
above + middle │ ONE frost layer whose clip-path follows the wave
───────────────┼──────────────────────────────────────────────
below          │ transparent (nothing drawn; the page is sharp)
```

**A single `backdrop-filter` element is deliberate**: two adjacent blurred
layers each clamp their backdrop sampling at the edge, which always shows up as
a visible seam; and `mask` + `backdrop-filter` is unreliable in Chrome (the fade
does not apply, the tint double-stacks). One layer costs more per frame but is
visually seamless.

Switch to `static` when you want 60fps and can accept a frosted film instead of
real blur:

```yaml
- id: betterloading
  config:
    mode: "realtime"
    blur: 12
```

## Configuration

Override in your own profile patch layer (`$DSH_HOME/cordis.patch.yml` or the profile's `cordis.patch.yml`; both apply after every bundle layer):

```yaml
- id: betterloading
  config:
    mode: "realtime"     # realtime (default) | static
    noise: 13            # static-mode grain strength, 0-100
    tintLight: "rgba(250,252,255,.55)"
    tintDark: "rgba(14,18,26,.62)"
```

| Option | Default | Description |
|---|---|---|
| `mode` | `"realtime"` | `static` = sampled frost; `realtime` = real backdrop blur |
| `blur` | `10` | Blur radius for `realtime` mode (px), 0-60 |
| `noise` | `13` | Grain strength for `static` mode, 0-100 |
| `tintLight` | `rgba(250,252,255,.55)` | Frost tint on light theme |
| `tintDark` | `rgba(14,18,26,.62)` | Frost tint on dark theme |
| `maxBlob` | `0.04` | Max volume of one blob (fraction of screen). Caps how much a single load advances |
| `waveSpeed` | `200` | c² of the wave equation. Higher travels faster |
| `damping` | `0.35` | Damping. Too high and waves die before reaching the edges; too low and they ring |
| `amplitude` | `46` | Surface amplitude in px |
| `idleTimeoutMs` | `12000` | Hard timeout (ms) after which the overlay is removed regardless |

### Tuning hints

- Water fills too fast / a single load nearly fills the screen → lower `maxBlob`
- Cannot see the waves → raise `amplitude`, or lower `damping` so they travel further
- The surface twitches → raise `damping`
- Weak machine, want it cheaper → keep `mode: static` and lower `noise`

## How it works

Exactly three injections, all via dsh's `webserver/index-inject`:

1. `<style>` — overlay, frost layer and plate styling
2. a `<div>` at the top of `body` — the overlay structure
3. a synchronous `<script>` at the top of `body` — it runs before the `type="module"` scripts in `head`, so it can install the fetch wrapper and `MutationObserver` before dsh issues its first `/api` call

Water-level state machine:

```
0%      start
 →0.42  static resources (one blob per newly finished resource)
 →0.10  app mount (#root gains child nodes)
 →…     one small blob per /api request start and finish
 100%   content ready → plate fades, surface recedes, node removed
```

## Known limitations

- Affects the dsh **web UI** only; server behaviour is unchanged.
- Depends on dsh's `webserver/index-inject` event and the `#root` structure. A major dsh change may require follow-up.
- dsh's own boot screen is hidden via a **structural selector** (class contains `_boot_`) because its class names carry build hashes. The failure card is deliberately left visible.
- "Content ready" is heuristic (text length / interactive-element count inside `#root`). Unusual layouts may finish slightly early or late; the hard timeout guarantees the overlay never traps you.

## License

MIT

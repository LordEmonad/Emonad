# Emonad Pixel Pack

The Emonad mascot as a game character: **179 animations, 620 frames**, four directions,
melee, traversal, swimming, four guns and a bat. Free to use in your games (see LICENSE.txt).

## Files

| File | What it is |
| --- | --- |
| `sprite sheet.png` | Idle + walk in four directions (the hand-pixelled base). 8 rows. |
| `sprite sheet actions.png` | Every body action: run, jump, flip, crouch, crawl, slide, roll, dash, punch, kick, bat, throw, block, pickup, interact, push, hang, mantle, wall-slide, fall, swim, sit, hurt, death, climb, celebrate, plus top-down versions. 77 rows. |
| `sprite sheet weapons.png` | Pistol, rifle, shotgun, rocket launcher: aim, shoot, reload, walk, crouch-shoot, aim-up, air-shoot, hurt (left and right), top-down shoot / walk / reload; bat idle, walk, hurt. 94 rows. |
| `actions.json` | The manifest: for every animation its `sheet`, `row`, `frames`, `fps` and `loop`. Load this instead of hard-coding rows. |
| `frames/` | Every frame as its own PNG, `<animation>-<n>.png`, the full 76x78 cell (so frames line up when you swap them). |
| `contact-*.png` | Each sheet laid out with labels, for a quick look. |

## The cells

- Every sheet is a grid of **76 x 78** cells, 8 columns wide. Cell `(row, col)` is at `(col * 76, row * 78)`.
- Draw the **whole cell**, never a trimmed frame: the character sits in the same place in every cell of a row, so
  nothing drifts between frames.
- **Feet are on row 63** of the cell (the bottom of the shoes); row 64 is the ground. Put the cell's row 64 on your floor.
- Airborne animations (jump, flip, fall, hang, mantle, swim) carry no vertical offset of their own: move the sprite
  by your own physics and pick the frame from velocity (jump: 0 prep, 1 launch, 2 rise, 3 apex, 4 fall, 5 land).
- **Left and right are separate rows, not mirrors.** The artist drew both heads; use the `-left` row rather than
  flipping `-right` in code.
- **Render with nearest-neighbour scaling** (`ctx.imageSmoothingEnabled = false`, CSS `image-rendering: pixelated`).
  Scale by whole numbers (2x, 3x, 4x). Smoothing or fractional scales turn the outline to mush.
- `loop: false` animations play once and hold their last frame (deaths end lying flat; `death` frame 3 is the impact,
  start there for a fall death).

## Loading it (vanilla canvas)

```js
const meta = await (await fetch('actions.json')).json();
const sheets = {};
for (const [key, s] of Object.entries(meta.sheets)) {
  const img = new Image(); img.src = s.file; await img.decode(); sheets[key] = img;
}
const anims = Object.fromEntries(meta.anims.map(a => [a.name, a]));

function draw(ctx, name, t, x, y, scale = 3) {
  const a = anims[name], n = Math.floor(t * a.fps);
  const frame = a.loop ? n % a.frames : Math.min(n, a.frames - 1);
  ctx.imageSmoothingEnabled = false;
  // x, y is where the feet touch the ground
  ctx.drawImage(sheets[a.sheet], frame * 76, a.row * 78, 76, 78,
                x - 38 * scale, y - 64 * scale, 76 * scale, 78 * scale);
}
```

## Palette

- `#111111` outline
- `#484848` shirt, pants
- `#373737` shade
- `#c4c4c4` hands, light shade
- `#ffffff` skin
- `#8f51c1` wristbands, shoes
- `#ab6ee3` hair
- `#683870` hair shadow, shoe dark

Only these eight colours appear (plus transparency). Recolour by swapping them and the whole set still reads.

## Row maps

### sprite sheet.png

| Row | Animation | Frames | fps | Loop |
| :-: | --- | :-: | :-: | :-: |
| 0 | `idle-right` | 6 | 4 | yes |
| 1 | `idle-down` | 6 | 4 | yes |
| 2 | `idle-left` | 6 | 4 | yes |
| 3 | `idle-up` | 6 | 4 | yes |
| 4 | `walk-right` | 8 | 8 | yes |
| 5 | `walk-down` | 4 | 5 | yes |
| 6 | `walk-left` | 8 | 8 | yes |
| 7 | `walk-up` | 4 | 5 | yes |

### sprite sheet actions.png

| Row | Animation | Frames | fps | Loop |
| :-: | --- | :-: | :-: | :-: |
| 0 | `run-right` | 6 | 12 | yes |
| 1 | `run-left` | 6 | 12 | yes |
| 2 | `jump-right` | 6 | 10 | no |
| 3 | `jump-left` | 6 | 10 | no |
| 4 | `crouch-right` | 2 | 4 | yes |
| 5 | `crouch-left` | 2 | 4 | yes |
| 6 | `punch-right` | 4 | 12 | no |
| 7 | `punch-left` | 4 | 12 | no |
| 8 | `kick-right` | 4 | 12 | no |
| 9 | `kick-left` | 4 | 12 | no |
| 10 | `throw-right` | 3 | 10 | no |
| 11 | `throw-left` | 3 | 10 | no |
| 12 | `block-right` | 2 | 4 | yes |
| 13 | `block-left` | 2 | 4 | yes |
| 14 | `hurt-right` | 2 | 8 | no |
| 15 | `hurt-left` | 2 | 8 | no |
| 16 | `death-right` | 6 | 8 | no |
| 17 | `death-left` | 6 | 8 | no |
| 18 | `dash-right` | 2 | 12 | yes |
| 19 | `dash-left` | 2 | 12 | yes |
| 20 | `pickup-right` | 3 | 8 | no |
| 21 | `pickup-left` | 3 | 8 | no |
| 22 | `roll-right` | 4 | 12 | yes |
| 23 | `roll-left` | 4 | 12 | yes |
| 24 | `flip-right` | 4 | 14 | yes |
| 25 | `flip-left` | 4 | 14 | yes |
| 26 | `mantle-right` | 2 | 6 | no |
| 27 | `mantle-left` | 2 | 6 | no |
| 28 | `fall-right` | 2 | 6 | yes |
| 29 | `fall-left` | 2 | 6 | yes |
| 30 | `swim-right` | 4 | 6 | yes |
| 31 | `swim-left` | 4 | 6 | yes |
| 32 | `sit-right` | 2 | 3 | yes |
| 33 | `sit-left` | 2 | 3 | yes |
| 34 | `slide-right` | 2 | 8 | yes |
| 35 | `slide-left` | 2 | 8 | yes |
| 36 | `hang-right` | 2 | 3 | yes |
| 37 | `hang-left` | 2 | 3 | yes |
| 38 | `wallslide-right` | 2 | 4 | yes |
| 39 | `wallslide-left` | 2 | 4 | yes |
| 40 | `push-right` | 2 | 6 | yes |
| 41 | `push-left` | 2 | 6 | yes |
| 42 | `swing-right` | 4 | 12 | no |
| 43 | `swing-left` | 4 | 12 | no |
| 44 | `interact-right` | 2 | 4 | no |
| 45 | `interact-left` | 2 | 4 | no |
| 46 | `crawl-right` | 4 | 8 | yes |
| 47 | `crawl-left` | 4 | 8 | yes |
| 48 | `climb` | 4 | 6 | yes |
| 49 | `celebrate` | 4 | 6 | yes |
| 50 | `punch-down` | 4 | 12 | no |
| 51 | `punch-up` | 4 | 12 | no |
| 52 | `kick-down` | 3 | 10 | no |
| 53 | `kick-up` | 3 | 10 | no |
| 54 | `hurt-down` | 2 | 8 | no |
| 55 | `hurt-up` | 2 | 8 | no |
| 56 | `jump-down` | 5 | 10 | no |
| 57 | `jump-up` | 5 | 10 | no |
| 58 | `death-down` | 5 | 8 | no |
| 59 | `pickup-down` | 3 | 8 | no |
| 60 | `pickup-up` | 3 | 8 | no |
| 61 | `run-down` | 6 | 12 | yes |
| 62 | `dash-down` | 2 | 12 | yes |
| 63 | `crouch-down` | 2 | 4 | yes |
| 64 | `block-down` | 2 | 4 | yes |
| 65 | `throw-down` | 3 | 10 | no |
| 66 | `interact-down` | 2 | 4 | no |
| 67 | `swim-down` | 4 | 6 | yes |
| 68 | `run-up` | 6 | 12 | yes |
| 69 | `dash-up` | 2 | 12 | yes |
| 70 | `crouch-up` | 2 | 4 | yes |
| 71 | `block-up` | 2 | 4 | yes |
| 72 | `throw-up` | 3 | 10 | no |
| 73 | `interact-up` | 2 | 4 | no |
| 74 | `swim-up` | 4 | 6 | yes |
| 75 | `sit-down` | 2 | 3 | yes |
| 76 | `death-up` | 5 | 8 | no |

### sprite sheet weapons.png

| Row | Animation | Frames | fps | Loop |
| :-: | --- | :-: | :-: | :-: |
| 0 | `pistol-aim-right` | 2 | 4 | yes |
| 1 | `pistol-aim-left` | 2 | 4 | yes |
| 2 | `pistol-shoot-right` | 3 | 14 | no |
| 3 | `pistol-shoot-left` | 3 | 14 | no |
| 4 | `pistol-reload-right` | 4 | 8 | no |
| 5 | `pistol-reload-left` | 4 | 8 | no |
| 6 | `pistol-walk-right` | 6 | 8 | yes |
| 7 | `pistol-walk-left` | 6 | 8 | yes |
| 8 | `pistol-crouchshoot-right` | 3 | 14 | no |
| 9 | `pistol-crouchshoot-left` | 3 | 14 | no |
| 10 | `pistol-aimup-right` | 3 | 14 | no |
| 11 | `pistol-aimup-left` | 3 | 14 | no |
| 12 | `pistol-airshoot-right` | 2 | 14 | no |
| 13 | `pistol-airshoot-left` | 2 | 14 | no |
| 14 | `pistol-hurt-right` | 2 | 8 | no |
| 15 | `pistol-hurt-left` | 2 | 8 | no |
| 16 | `rifle-aim-right` | 2 | 4 | yes |
| 17 | `rifle-aim-left` | 2 | 4 | yes |
| 18 | `rifle-shoot-right` | 3 | 14 | no |
| 19 | `rifle-shoot-left` | 3 | 14 | no |
| 20 | `rifle-reload-right` | 4 | 8 | no |
| 21 | `rifle-reload-left` | 4 | 8 | no |
| 22 | `rifle-walk-right` | 6 | 8 | yes |
| 23 | `rifle-walk-left` | 6 | 8 | yes |
| 24 | `rifle-crouchshoot-right` | 3 | 14 | no |
| 25 | `rifle-crouchshoot-left` | 3 | 14 | no |
| 26 | `rifle-aimup-right` | 3 | 14 | no |
| 27 | `rifle-aimup-left` | 3 | 14 | no |
| 28 | `rifle-airshoot-right` | 2 | 14 | no |
| 29 | `rifle-airshoot-left` | 2 | 14 | no |
| 30 | `rifle-hurt-right` | 2 | 8 | no |
| 31 | `rifle-hurt-left` | 2 | 8 | no |
| 32 | `shotgun-aim-right` | 2 | 4 | yes |
| 33 | `shotgun-aim-left` | 2 | 4 | yes |
| 34 | `shotgun-shoot-right` | 3 | 14 | no |
| 35 | `shotgun-shoot-left` | 3 | 14 | no |
| 36 | `shotgun-reload-right` | 4 | 8 | no |
| 37 | `shotgun-reload-left` | 4 | 8 | no |
| 38 | `shotgun-walk-right` | 6 | 7 | yes |
| 39 | `shotgun-walk-left` | 6 | 7 | yes |
| 40 | `shotgun-crouchshoot-right` | 3 | 14 | no |
| 41 | `shotgun-crouchshoot-left` | 3 | 14 | no |
| 42 | `shotgun-aimup-right` | 3 | 14 | no |
| 43 | `shotgun-aimup-left` | 3 | 14 | no |
| 44 | `shotgun-airshoot-right` | 2 | 14 | no |
| 45 | `shotgun-airshoot-left` | 2 | 14 | no |
| 46 | `shotgun-hurt-right` | 2 | 8 | no |
| 47 | `shotgun-hurt-left` | 2 | 8 | no |
| 48 | `rocket-aim-right` | 2 | 4 | yes |
| 49 | `rocket-aim-left` | 2 | 4 | yes |
| 50 | `rocket-shoot-right` | 3 | 14 | no |
| 51 | `rocket-shoot-left` | 3 | 14 | no |
| 52 | `rocket-reload-right` | 4 | 8 | no |
| 53 | `rocket-reload-left` | 4 | 8 | no |
| 54 | `rocket-walk-right` | 6 | 6 | yes |
| 55 | `rocket-walk-left` | 6 | 6 | yes |
| 56 | `rocket-crouchshoot-right` | 3 | 14 | no |
| 57 | `rocket-crouchshoot-left` | 3 | 14 | no |
| 58 | `rocket-aimup-right` | 3 | 14 | no |
| 59 | `rocket-aimup-left` | 3 | 14 | no |
| 60 | `rocket-airshoot-right` | 2 | 14 | no |
| 61 | `rocket-airshoot-left` | 2 | 14 | no |
| 62 | `rocket-hurt-right` | 2 | 8 | no |
| 63 | `rocket-hurt-left` | 2 | 8 | no |
| 64 | `bat-idle-right` | 2 | 4 | yes |
| 65 | `bat-hurt-right` | 2 | 8 | no |
| 66 | `bat-hurt-left` | 2 | 8 | no |
| 67 | `bat-idle-left` | 2 | 4 | yes |
| 68 | `bat-walk-right` | 6 | 8 | yes |
| 69 | `bat-walk-left` | 6 | 8 | yes |
| 70 | `pistol-shoot-down` | 3 | 14 | no |
| 71 | `pistol-shoot-up` | 3 | 14 | no |
| 72 | `pistol-walk-down` | 6 | 8 | yes |
| 73 | `pistol-walk-up` | 6 | 8 | yes |
| 74 | `pistol-reload-down` | 4 | 8 | no |
| 75 | `pistol-reload-up` | 4 | 8 | no |
| 76 | `rifle-shoot-down` | 3 | 14 | no |
| 77 | `rifle-shoot-up` | 3 | 14 | no |
| 78 | `rifle-walk-down` | 6 | 8 | yes |
| 79 | `rifle-walk-up` | 6 | 8 | yes |
| 80 | `rifle-reload-down` | 4 | 8 | no |
| 81 | `rifle-reload-up` | 4 | 8 | no |
| 82 | `shotgun-shoot-down` | 3 | 14 | no |
| 83 | `shotgun-shoot-up` | 3 | 14 | no |
| 84 | `shotgun-walk-down` | 6 | 8 | yes |
| 85 | `shotgun-walk-up` | 6 | 8 | yes |
| 86 | `shotgun-reload-down` | 4 | 8 | no |
| 87 | `shotgun-reload-up` | 4 | 8 | no |
| 88 | `rocket-shoot-down` | 3 | 14 | no |
| 89 | `rocket-shoot-up` | 3 | 14 | no |
| 90 | `rocket-walk-down` | 6 | 8 | yes |
| 91 | `rocket-walk-up` | 6 | 8 | yes |
| 92 | `rocket-reload-down` | 4 | 8 | no |
| 93 | `rocket-reload-up` | 4 | 8 | no |

Made by Emonad ($EMO) on Monad. emonad.lol/game-assets

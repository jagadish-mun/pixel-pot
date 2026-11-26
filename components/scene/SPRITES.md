# Hand-drawn sprite overrides

Drop a PNG into `public/sprites/` and the table uses it instead of the code-drawn
sprite of the same name. The list of PNGs is read when the app is built
(`/api/sprites`), so add the file, then rebuild or restart `next dev`.

Every sprite is **pixel art at 1×** ("art pixels"). The scene only ever enlarges
it by whole numbers, so draw at exactly the size below, with a transparent
background, top-left anchored. Light comes from the top-left; use 4-step ramps
(highlight, base, shadow, deep shadow) and selective outlines to match the rest.

## Cards

| Name | Size | Notes |
| --- | --- | --- |
| `card-<card>-upright` | 42 × 58 | My hand. Face 41 × 57 with 2-1 cut corners, plus a 1 px shadow edge on the right and bottom. `<card>` is rank + suit as the game writes it: `As`, `Td`, `9c`, `Qh`… |
| `card-back-upright` | 42 × 58 | The back, same shape. |
| `card-<card>-flat` | 41 × 35 | A card lying on the felt (board, showdown): face 41 × 33, then 2 rows of darker edge for its thickness. The dithered shadow on the felt is added by code. |
| `card-back-flat` | 41 × 35 | Dealt cards before they flip, my lowered cards, empty board outlines (its shape). |
| `card-back-mini` | 9 × 13 | The backs opponents hold. |

Upright cards are turned with RotSprite in my hand (−9°/+5°, Omaha −12/−4/+4/+12)
and flat cards by a few degrees at showdown, so keep a clear 1 px outline: the
turned edge comes out as clean stair-steps.

## My hands

| Name | Size | Notes |
| --- | --- | --- |
| `hands-hold-back` | 130 × 82 | Holding two cards: everything behind them (forearms from the bottom corners, sleeves, palms, fingertips peeking past the outer edges). The cards' bottom centres sit at (53, 61) and (77, 61). |
| `hands-hold-front` | 130 × 82 | Holding: everything in front of the cards (the thumbs on the bottom corners). |
| `hands-rest` | 130 × 82 | Palms down on the rail, no cards. The rail runs across the sprite's middle. |
| `hands-lowered` | 130 × 82 | Peeking: palms down with my cards face down between them (draw the cards in). |

## Opponents

48 × 48 each: one row of headroom, then a 48 × 47 person whose rail line is row
41 (from the top of the sprite). Everything below the rail is hidden by the table
in the body layer.

| Name | Notes |
| --- | --- |
| `opponent-front-body` | Facing me (far side of the table): head, neck, torso, upper arms. |
| `opponent-quarter-body` | Turned about 35° to the right (the left end of the table); mirrored for the right end. |
| `opponent-front-arms-hold`, `opponent-quarter-arms-hold` | Forearms on the rail, hands holding two card backs in front of the chest (draw the cards in). |
| `opponent-front-arms-rest`, `opponent-quarter-arms-rest` | Forearms on the rail, hands together, no cards. |
| `opponent-front-arms-fold`, `opponent-quarter-arms-fold` | Arms crossed, leaning back. |

The player's icon is printed on afterwards, 7 × 7 at (20, 6) on the front view and
(24, 6) on the three-quarter view: leave a dark screen there. Players who are out
are turned grey by code; idle moves (breathing, blinking, a head tilt) shift
whole parts, so the body sprite should not include them.

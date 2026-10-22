# Shop Happens

A cooperative, browser-based 3D shop/logistics game prototype. Up to five workers share one chaotic store floor:
pick up delivery boxes, ride them down a conveyor belt (or carry them), and fill the order.

**Stack:** TypeScript monorepo (pnpm) · Vite + React (HUD only) · Three.js · Colyseus 0.18 (server-authoritative rooms).

```
apps/web         browser client: Three.js scene, input, HUD
apps/server      Colyseus server (ShopRoom) + multiplayer integration test
packages/shared  constants, message contracts, collision helpers, and the pure game rules (GameSim)
```

`GameSim` (in `packages/shared`) holds all rules: pickup, put-down, conveyor, delivery, round reset. The server runs it
authoritatively and mirrors it into the Colyseus schema; the browser runs the very same class for **offline mode**.

## Run it

Requires Node 20+ and pnpm 10.

```bash
pnpm install
pnpm dev            # server on ws://localhost:2567 + client on http://localhost:5173
```

Or separately: `pnpm dev:server` and `pnpm dev:web`. Open <http://localhost:5173>, enter a name, press **Start shift**.

- If the server is not reachable the game falls back to **offline single-player** (the status chip says so; **Retry** reconnects).
- `http://localhost:5173/?local` forces offline mode.
- Point the client at another server with `VITE_SERVER_URL=ws://host:2567 pnpm dev:web`.
  The default is `ws://<page hostname>:2567`, so opening the Vite "Network" URL from another machine on the LAN works.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move (screen-relative; the camera does not rotate) |
| E | Pick up the highlighted box / put down the box you carry (belt input, delivery zone, or floor) |
| Q | Drop the carried box on the floor |
| Esc | Show/hide the help panel |

Goal: deliver 5 boxes. Put a box on the belt near the green "PUT BOX ON BELT" ring, or carry it into the green delivery zone.
When the target is reached the round resets after a few seconds.

## Test multiplayer locally

1. `pnpm dev`
2. Open <http://localhost:5173> in two or more tabs or windows (up to five share a room; the sixth player gets a new room).
3. Give each tab a different name. You should see each other's workers, the "N / 5 players" chip, and boxes carried by others.
4. Try to pick up the same box from two tabs at once: only one succeeds. Close a tab while it carries a box: the box drops back on the floor.

## Checks

```bash
pnpm typecheck   # tsc in all packages
pnpm lint        # eslint
pnpm test        # vitest: shared rules (unit) + server (real Colyseus server, real SDK clients)
pnpm build       # production client bundle in apps/web/dist
```

## How multiplayer works

- Clients send **intents** (`move`, `pickup {boxId}`, `put {drop}`) at ≤20 Hz for movement; the server rate-limits every message type.
- The server validates: ids, interaction range, one carried box per worker, boxes held by someone else, movement speed and walkability
  (no walking through shelves, walls or teleporting). Delivery is a state transition (`delivered`) that can only happen once per box.
- Players move with **client-side prediction** using the shared collision code; the server accepts or rejects reported positions, and a
  rejected/diverged client is snapped back to the server position. Remote workers and all boxes are smoothed on the client.
- The server ticks at 20 Hz and writes to the Colyseus schema only on change. Rendering runs at display rate, independent of that.
- A leaving player's carried box is released to the floor.

## Known limitations / placeholders

- **Rapier is not used.** The slice needed no rigid-body behaviour (belt is a waypoint rule, collisions are circle-vs-box).
  Throwing, tumbling boxes and similar are the natural place to add it next.
- Players are client-predicted with server *validation* (not full server-side simulation of input), so a modified client can move at up to ~1.6x speed.
- No reconnection: if the connection drops the game tells you and offline mode / a page reload is needed.
- Q is a plain drop, not a throw.
- Worker and props are primitive-built placeholders (art direction follows the supplied references); the `Worker` class is the seam for a GLB model.
- No persistence, accounts, audio assets (a synthesized "ding" plays on delivery), or mobile/touch controls.

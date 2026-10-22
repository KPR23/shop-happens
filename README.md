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

## How the game plays

A manual-first store. The day runs on a clock: **prep → open (09:00–18:00) → closing → summary**, then the next day.
Everything is done by hand; roles (cashier, warehouse, driver) are simply whatever each player is doing.

```
wholesaler van ─► belt ─► crate ─► (hold E) unpack into rack ─► (hold E) take a tray ─► (hold E) fill a shelf
                                                                                   customers buy ─► cashier (hold E) scans ─► $$$
```

- **Van:** stand in the yellow bay, hold E to drive to the wholesaler (costs $50). The driver is away for ~12 s; the crates then come down the belt.
- **Warehouse:** crates end up at the racks. Hold E at a rack with a crate to unpack it (stock goes into the rack); hold E empty-handed to take a tray of goods.
- **Shelves:** hold E (5 s) at a shelf with a tray to stock it. Shelf and rack contents are visible on the models and in the small labels.
- **Customers (NPC):** come in while the store is open, pick a stocked shelf, take 1–3 items, queue at the register. Empty shelves or a long wait lose the customer.
- **Register:** stand behind the counter (blue mat); hold E to scan the first customer in line (1 s per item). Sales add money.
- **Door:** hold E at the door during prep to open early.
- **Upgrades:** the panel on the right buys faster hands, a better wholesaler deal, and advertising with the money you earn.
- Workers are soft bodies: walking into someone nudges them (resolved on the server).

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move (screen-relative; the camera does not rotate) |
| E (tap) | Pick up the highlighted box, or set down the one you carry (onto the belt when standing at its start) |
| E (hold) | Work: unpack, take goods, stock a shelf, scan, drive the van, open the store. The hint and a progress bar show what applies |
| Q | Throw the carried box about 3 m (visible arc; it stops at obstacles) |
| Esc | Show/hide the help panel |

## Test multiplayer locally

1. `pnpm dev`
2. Open <http://localhost:5173> in two or more tabs or windows (up to five share a room; the sixth player gets a new room).
3. Give each tab a different name. You should see each other's workers, the "N / 5 players" chip, carried boxes, task progress bars, shelf stock and customers.
4. Try to pick up the same crate from two tabs at once: only one succeeds. Close a tab while it carries a box: the box drops back on the floor. Walk into the other worker: they get shoved along.

## Checks

```bash
pnpm typecheck   # tsc in all packages
pnpm lint        # eslint
pnpm test        # vitest: shared rules (24 unit tests) + server (real Colyseus server, real SDK clients; ~40 s)
pnpm build       # production client bundle in apps/web/dist
```

## How multiplayer works

- Clients send **intents**: `move` (≤20 Hz), `pickup {boxId}`, `put`, `throw`, `hold {on}` and `upgrade {id}`. The server rate-limits every type.
- For a hold, the client only says "I'm holding E". The server decides which task applies (`resolveInteraction`, shared with the client for hints),
  runs the timer, cancels it if the worker leaves or the situation changes, and applies the effect when it completes.
- The server validates ids, range, one carried box per worker, boxes held by someone else, stock levels, money, and movement (speed, walls, no teleporting).
- Players are **client-predicted** using the shared collision code; the server accepts or rejects reported positions. Small drift (shoves) is pulled in
  gently, big jumps snap. Remote workers, customers and boxes are smoothed on the client.
- Customers, the day clock, money, stock and upgrades live only in the server's `GameSim`; the room mirrors them into the Colyseus schema (written only on change, 20 Hz).
- A leaving player's carried box is released and their task is cancelled.

### Adding a task (e.g. a close-up minigame)

Hold-tasks are data-driven in `packages/shared/src/interaction.ts` (`resolveInteraction`: when does a task apply, how long, what label) and
`sim.ts` (`startHold` / `stopHold` / `completeTask`: what it does). A minigame can start a task through `session.hold(true)`, show its own UI while
`players[localId].action` is set, and let the server complete the task.

## Known limitations / placeholders

- **Rapier is not used.** Nothing in this slice needs rigid bodies (belt is a waypoint rule, collisions are circles vs boxes, throws are a fixed arc).
- Players are client-predicted with server *validation* (not full server-side simulation of input), so a modified client can move at up to ~1.6x speed.
- No reconnection: if the connection drops the game tells you and a page reload (or offline mode) is needed.
- One wholesaler van, fixed prices and one product type; shelf stock is a single number per shelf (no per-product items yet).
- Customers use a simple grid path and do not collide with workers; no cleaning, no theft, no stock quality.
- Worker, customers and props are primitive-built placeholders following the supplied art direction; `Worker` is the seam for a GLB model.
- No persistence or accounts (a room resets when emptied). No mobile/touch controls. The only audio is a synthesized chime.

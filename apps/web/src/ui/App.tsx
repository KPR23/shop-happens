import { useEffect, useRef, useState } from "react";
import { MAX_UPGRADE_LEVEL, UPGRADES } from "@shop/shared";
import { hud, useHud } from "../app/store";
import { Game } from "../game/Game";
import { LocalSession } from "../game/session/local";
import { NetworkSession } from "../game/session/network";

const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? `ws://${location.hostname}:2567`;
const FORCE_LOCAL = new URLSearchParams(location.search).has("local");

function savedName() {
  try {
    return localStorage.getItem("shop-happens:name") ?? "";
  } catch {
    return "";
  }
}

export function App() {
  const container = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  const h = useHud();
  const [name, setName] = useState(savedName);

  useEffect(() => {
    try {
      game.current = new Game(container.current!);
    } catch (e) {
      hud.set({ fatal: `Could not start the 3D renderer (is WebGL enabled?). ${e instanceof Error ? e.message : String(e)}` });
    }
    const onErr = (ev: ErrorEvent) => hud.set({ fatal: `Unexpected error: ${ev.message}` });
    window.addEventListener("error", onErr);
    return () => {
      window.removeEventListener("error", onErr);
      game.current?.dispose();
      game.current = null;
    };
  }, []);

  const playOffline = (text: string) => {
    game.current?.setSession(new LocalSession(name.trim() || "Worker"));
    hud.set({ status: "offline", statusText: text });
  };

  const connect = async () => {
    const g = game.current;
    if (!g) return;
    const n = name.trim() || "Worker";
    if (FORCE_LOCAL) return playOffline("Offline mode (?local)");
    hud.set({ status: "connecting", statusText: `Connecting to ${SERVER_URL}…` });
    try {
      const s = await NetworkSession.connect(SERVER_URL, n);
      s.onDisconnect = (reason) => {
        g.setSession(null);
        hud.set({ status: "error", statusText: `${reason}. Reload to rejoin, or play offline.` });
      };
      g.setSession(s);
      hud.set({ status: "online", statusText: "Online" });
    } catch (e) {
      playOffline(`Server unreachable (${e instanceof Error ? e.message : "unknown error"}) — playing offline`);
    }
  };

  const start = () => {
    try {
      localStorage.setItem("shop-happens:name", name.trim());
    } catch {
      /* ignore */
    }
    hud.set({ started: true });
    void connect();
  };

  const tips: Record<string, string> = {
    prep: "Get ready: unpack crates, carry trays to the shelves, and put someone on the register. Hold E at the door to open early.",
    open: "Customers are shopping! Keep shelves stocked and scan them out at the register.",
    closing: "Closing time. Let the last customers pay.",
    summary: "Day over. Spend your money on upgrades before tomorrow.",
  };
  const phaseName: Record<string, string> = { prep: "Preparing", open: "OPEN", closing: "Closing", summary: "Closed" };
  const upgradeDefs = UPGRADES;
  return (
    <div className="app">
      <div ref={container} className="stage" />

      {h.fatal && (
        <div className="overlay">
          <div className="card error">
            <h2>Something went wrong</h2>
            <p>{h.fatal}</p>
          </div>
        </div>
      )}

      {!h.started && !h.fatal && (
        <div className="overlay">
          <form
            className="card start"
            onSubmit={(e) => {
              e.preventDefault();
              start();
            }}
          >
            <div className="logo">Shop<span>Happens</span></div>
            <p>Run a tiny store together: fetch stock, fill the shelves, serve the customers, and grow the shop day by day.</p>
            <label>
              Your name
              <input value={name} maxLength={14} placeholder="Worker" autoFocus onChange={(e) => setName(e.target.value)} />
            </label>
            <button type="submit">Start shift</button>
            <small>Up to 5 players per room · WASD to move · E to interact · Q to throw</small>
          </form>
        </div>
      )}

      {h.started && (
        <>
          <div className="panel objective">
            <div className="row">
              <span className="title">Day {h.day}</span>
              <span className={`phase ${h.phase}`}>{phaseName[h.phase]}</span>
              <span className="clock">{h.clock}</span>
            </div>
            <div className="money">${h.money}</div>
            <div className="stats">Today: <b>${h.earned}</b> · served <b>{h.served}</b> · lost <b>{h.lost}</b></div>
            <div className="tip">{tips[h.phase]}</div>
            {h.phase !== "summary" && <div className="phasetimer">{phaseName[h.phase]}: {h.phaseLeft}s</div>}
          </div>

          <div className={`panel status ${h.status}`}>
            <span className="dot" />
            <span>{h.statusText || h.status}</span>
            {h.status === "online" && <span className="players">· {h.players} / 5 players</span>}
            {h.status === "offline" && !FORCE_LOCAL && <button onClick={() => void connect()}>Retry</button>}
          </div>

          <div className="panel upgrades">
            <div className="title">Upgrades</div>
            {upgradeDefs.map((u) => {
              const level = h.upgrades[u.id];
              const cost = level >= MAX_UPGRADE_LEVEL ? null : u.costs[level];
              return (
                <button
                  key={u.id}
                  disabled={cost === null || h.money < cost}
                  title={u.description}
                  onClick={(e) => {
                    game.current?.buyUpgrade(u.id);
                    e.currentTarget.blur();
                  }}
                >
                  <span>{u.name} <i>Lv {level}/{MAX_UPGRADE_LEVEL}</i></span>
                  <b>{cost === null ? "MAX" : `$${cost}`}</b>
                </button>
              );
            })}
          </div>

          {h.showHelp && (
            <div className="panel help">
              <div className="title">How to play</div>
              <ul>
                <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / arrows — move (workers bump into each other)</li>
                <li><kbd>E</kbd> — tap to pick up / set a box down; <b>hold</b> for work (unpack, stock, scan, drive)</li>
                <li><kbd>Q</kbd> — throw the box you carry about 3 m</li>
                <li><b>Stock chain:</b> van → belt → crate → unpack into the rack → take a tray → fill a shelf</li>
                <li><b>Register:</b> stand behind the counter, hold <kbd>E</kbd> to scan the first customer</li>
                <li><kbd>Esc</kbd> — hide this panel</li>
              </ul>
            </div>
          )}
          {!h.showHelp && <div className="panel mini">Esc · controls</div>}

          {h.taskLabel && (
            <div className="task">
              <span>{h.taskLabel}…</span>
              <div className="bar"><i style={{ width: `${h.taskProgress * 100}%` }} /></div>
            </div>
          )}
          {h.hint && !h.taskLabel && <div className="hint">{h.hint.split(/(\[[A-Z]\])/).map((p, i) => (/^\[[A-Z]\]$/.test(p) ? <kbd key={i}>{p[1]}</kbd> : <span key={i}>{p}</span>))}</div>}
          {h.toast && <div className="toast" key={h.toast.id}>{h.toast.text}</div>}

          {h.awayLeft > 0 && (
            <div className="overlay away">
              <div className="card">
                <h2>Driving to the wholesaler…</h2>
                <p>Back in {h.awayLeft}s with fresh crates. Your crew keeps the shop running!</p>
              </div>
            </div>
          )}

          {h.phase === "summary" && (
            <div className="banner">
              <b>Day {h.day} complete</b>
              <span>Served {h.served} · lost {h.lost} · earned ${h.earned}</span>
              <span>Next day starts in {h.phaseLeft}s — buy upgrades now!</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

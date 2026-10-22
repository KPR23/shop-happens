import { useEffect, useRef, useState } from "react";
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

  const complete = h.round === "complete";
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
            <p>Run a chaotic store with your crew. Grab boxes, ride the belt, deliver the order.</p>
            <label>
              Your name
              <input value={name} maxLength={14} placeholder="Worker" autoFocus onChange={(e) => setName(e.target.value)} />
            </label>
            <button type="submit">Start shift</button>
            <small>Up to 5 players per room · WASD to move · E to pick up / put down</small>
          </form>
        </div>
      )}

      {h.started && (
        <>
          <div className="panel objective">
            <div className="title">Deliver {h.target} boxes</div>
            <div className="count">Boxes delivered: <b>{h.delivered}/{h.target}</b></div>
            <div className="bar"><i style={{ width: `${Math.min(100, (h.delivered / h.target) * 100)}%` }} /></div>
          </div>

          <div className={`panel status ${h.status}`}>
            <span className="dot" />
            <span>{h.statusText || h.status}</span>
            {h.status === "online" && <span className="players">· {h.players} / 5 players</span>}
            {h.status === "offline" && !FORCE_LOCAL && <button onClick={() => void connect()}>Retry</button>}
          </div>

          {h.showHelp && (
            <div className="panel help">
              <div className="title">How to play</div>
              <ul>
                <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / arrows — move</li>
                <li><kbd>E</kbd> — pick up / put down a box</li>
                <li><kbd>Q</kbd> — drop the box you carry</li>
                <li>Put boxes on the conveyor, or carry them to the green <b>delivery zone</b></li>
                <li><kbd>Esc</kbd> — hide this panel</li>
              </ul>
            </div>
          )}
          {!h.showHelp && <div className="panel mini">Esc · controls</div>}

          {h.hint && <div className="hint">{h.hint.split(/(\[[A-Z]\])/).map((p, i) => (/^\[[A-Z]\]$/.test(p) ? <kbd key={i}>{p[1]}</kbd> : <span key={i}>{p}</span>))}</div>}

          {complete && (
            <div className="banner">
              <b>Order complete!</b>
              <span>{h.target} boxes delivered — a fresh shift starts in a few seconds…</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

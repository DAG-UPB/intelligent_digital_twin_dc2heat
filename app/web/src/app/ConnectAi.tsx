/**
 * Connect AI, in the top bar: an AI agent (the MCP server, docs/architecture/mcp.md) works the open pages only once the
 * user lets it. The button shows a one-time code; the user gives it to the agent, which connects with it (its tool
 * connect_app). Connected, the button says so and Disconnect ends it. The shell passes the backend's connect and
 * disconnect events on as AGENT_CHANGED.
 */
import { useEffect, useRef, useState } from "react";
import { disconnectAgent, fetchConnectInfo, newPairCode } from "../api";
import { errorMessage } from "../lib/errors";
import { AGENT_CHANGED } from "../lib/live";
import { hrefOf } from "./routes";

const spaced = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

/** The AI's symbol, a small robot head on a 24 × 24 grid, stroked in currentColor (also in the help's assistant figure). */
export const RobotMark = () => (
  <>
    <rect x="4" y="8" width="16" height="12" rx="3" />
    <path d="M12 8V4M9 4h6M9 13v1M15 13v1M2 13v3M22 13v3" />
  </>
);

/** A small robot head: the AI. */
const Robot = () => (
  <svg
    className="connect-ai__icon"
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <RobotMark />
  </svg>
);

export default function ConnectAi() {
  const [connected, setConnected] = useState(false);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<{ code: string; until: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    fetchConnectInfo()
      .then((i) => setConnected(!!i.agent))
      .catch(() => undefined); // an older backend: no pairing, the button only shows codes
    const on = (e: Event) => {
      const c = (e as CustomEvent<boolean>).detail;
      setConnected(c);
      setCode(null);
    };
    window.addEventListener(AGENT_CHANGED, on);
    return () => window.removeEventListener(AGENT_CHANGED, on);
  }, []);

  // a click elsewhere closes it
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const fresh = async () => {
    setError(null);
    try {
      const r = await newPairCode();
      setCode({ code: r.code, until: Date.now() + r.seconds * 1000 });
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const toggle = () => {
    setOpen(!open);
    if (!open && !connected && (!code || Date.now() > code.until)) void fresh();
  };
  const disconnect = () =>
    disconnectAgent()
      .then(() => setConnected(false))
      .catch((e) => setError(errorMessage(e)));

  return (
    <span className="connect-ai" ref={box}>
      <button
        type="button"
        className={`btn btn--pill connect-ai__btn${connected ? " connect-ai__btn--on" : ""}`}
        aria-expanded={open}
        aria-label={connected ? "AI connected" : "Connect AI"}
        title={connected ? "An AI agent is connected" : "Let an AI agent work on these pages"}
        onClick={toggle}
      >
        <Robot />
        <span className="connect-ai__label">{connected ? "AI connected" : "Connect AI"}</span>
      </button>
      {open && (
        <div className="connect-ai__pop card" role="dialog" aria-label="Connect AI">
          {connected ? (
            <>
              <p>An AI agent can work on the pages of this app, as you do: it sees what you see and presses what you could.</p>
              <button type="button" className="btn btn--sm" onClick={disconnect}>
                Disconnect
              </button>
            </>
          ) : (
            <>
              <p>Give your AI agent this code:</p>
              <p className="mono connect-ai__code" aria-label="Code">
                {code ? spaced(code.code) : "…"}
              </p>
              <p className="muted">
                It works once, for 10 minutes. Tell the agent “connect to the app with code {code ? spaced(code.code) : "…"}”: it calls connect_app with it.
                Until then it cannot see or work your pages.
              </p>
              <span className="connect-ai__row">
                <button type="button" className="btn btn--sm" onClick={fresh}>
                  New code
                </button>
                <a href={hrefOf("help", "assistant")} className="connect-ai__link" onClick={() => setOpen(false)}>
                  Set up the agent →
                </a>
              </span>
            </>
          )}
          {error && <p className="connect-ai__error">{error}</p>}
        </div>
      )}
    </span>
  );
}

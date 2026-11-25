/** Entry point: mounts the app (with a last-resort error boundary) and loads the global styles. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import { openStartCase } from "./app/DataCenterPicker";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { LANG, startGerman } from "./lib/i18n";
import { hasUnsaved } from "./lib/live";
import { reloadForNewBuild } from "./lib/staleBuild";
import "./index.css";
import "./ui/ui.css";
import "./ui/look.css"; // the look on every page: texture, cards, neumorphism as an accent

openStartCase(); // started by start.sh: its case before the first page reads its dataset

// a page file of the build this tab was opened on is gone (the app was rebuilt since): load the new build, once, unless
// the open page has unsaved edits (then the page's error box says so and offers the reload)
addEventListener("vite:preloadError", (e) => {
  if (!hasUnsaved() && reloadForNewBuild()) e.preventDefault();
});

// the app is laid out for a window 1600 px wide and scaled to fit any other (CSS zoom), so it looks the same on every
// screen; --fit lets the CSS undo the zoom on vh (zoomed too): calc(100vh / var(--fit))
const fit = () => {
  const z = Math.min(1.4, Math.max(0.6, innerWidth / 1600));
  document.documentElement.style.zoom = String(z);
  document.documentElement.style.setProperty("--fit", String(z));
};
fit();
addEventListener("resize", fit);

const start = () =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
// in German the dictionary first (its own chunk), so the first page already shows in German
if (LANG === "de")
  import("./lib/i18n.de")
    .then((m) => startGerman(m.default))
    .catch(() => {})
    .finally(start);
else start();

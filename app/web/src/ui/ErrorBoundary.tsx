/**
 * Catches a render error below it and shows it in an error box instead of blanking the whole app (or page).
 * App.tsx keys it by route, so moving to another page starts fresh; "Try again" re-renders the same content.
 */
import { Component, type ReactNode } from "react";
import { isStaleBuild, justReloaded } from "../lib/staleBuild";

export class ErrorBoundary extends Component<{ children: ReactNode; title?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (isStaleBuild(error) && !justReloaded())
      // the app was rebuilt since this tab opened: its page files are gone, only a reload brings the new ones (not
      // reloaded by itself: unsaved edits); still missing right after that reload, it is another fault: the box below
      return (
        <div role="alert" className="error-banner error-boundary">
          <strong>The app was updated since this tab was opened.</strong>
          <span className="error-boundary__actions">
            <button type="button" className="btn btn--pill" onClick={() => location.reload()}>
              Reload the page
            </button>
            <span className="muted">Unsaved edits on another page of this tab would be lost: save them first.</span>
          </span>
        </div>
      );
    return (
      <div role="alert" className="error-banner error-boundary">
        <strong>{this.props.title ?? "This page could not be shown."}</strong>
        <span className="mono">{error.message || String(error)}</span>
        <span className="error-boundary__actions">
          <button type="button" className="btn btn--pill" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <span className="muted">If it keeps failing, reload the page.</span>
        </span>
      </div>
    );
  }
}

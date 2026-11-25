/** An error message box; renders nothing when there is no error. */
export function ErrorBanner({ error }: { error: string | null | undefined }) {
  return error ? (
    <div role="alert" className="error-banner">
      {error}
    </div>
  ) : null;
}

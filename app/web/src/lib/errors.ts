/** The text to show for a caught error (http.ts throws Errors carrying the server's `detail`). */
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * A page that would lose something on leaving (the Site map's unsaved edits) holds the shell for a moment: the shell
 * asks `mayLeave` before it follows a new address, and a page set as the guard says no, puts its own address back and
 * asks the user; it lets the shell go on by setting the address again once answered.
 */
let guard: ((to: string) => boolean) | null = null;

/** Set (or with null clear) the page's guard: false holds the shell on the page. */
export const setLeaveGuard = (g: ((to: string) => boolean) | null) => {
  guard = g;
};

/** Whether the shell may follow the address to `to`. */
export const mayLeave = (to: string) => !guard || guard(to);

/** Leaflet sets tooltip strings with innerHTML: names from OSM, sinks or an opened project go through this first. */
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

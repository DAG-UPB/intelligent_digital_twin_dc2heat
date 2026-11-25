/** Plant graph read from a P&ID drawing (GET /api/datasets/<id>/pid/plant); positions are fractions of the drawing. */
export interface Plant {
  components: { id: string; label: string; x: number; y: number }[];
  links: [string, string][];
  pipes: [number, number][][];
}

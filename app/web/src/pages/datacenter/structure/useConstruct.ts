/** The P&ID's digital construct as the page edits it: loaded once; `dirty` until Save writes it. `onLoaded` hears
 * whether it holds the sheet's own lines (then the P&ID is digital and its picture is not needed). */
import { useEffect, useState } from "react";
import { fetchPidConstruct, type StructureScope } from "../../../api";
import { DATASET } from "../../../dataset";
import { errorMessage } from "../../../lib/errors";
import type { Shape } from "./construct";

export function useConstruct(scope: StructureScope, onError: (message: string) => void, onLoaded: (digital: boolean) => void = () => {}) {
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [firstGuess, setFirstGuess] = useState(false); // read from the drawing, never saved
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    fetchPidConstruct(DATASET, scope)
      .then((c) => {
        setShapes(c.shapes);
        setFirstGuess(!c.saved);
        onLoaded(c.shapes.some((x) => x.role === "drawing"));
      })
      .catch((e) => onError(errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);
  return { shapes, setShapes, firstGuess, setFirstGuess, dirty, setDirty };
}

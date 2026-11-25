/** The step-through page's own data choice: datasets, the chosen dataset/file/signals, and its time series. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchDatasets, fetchTimeSeriesData, type DatasetInfo, type TimeSeriesResponse } from "../../../../api";
import { DATASET } from "../../../../dataset";
import { errorMessage } from "../../../../lib/errors";

/**
 * Starts on the app's data center with its first file and first 3 signals; picking here does not switch the app.
 * `hidden`: columns of the app's data center not offered as signals (the other HEX option, calculated Q).
 */
export function useDatasetSelection(hidden: Set<string> | null = null) {
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<DatasetInfo | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [data, setData] = useState<TimeSeriesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const columns = useMemo(
    () => (selectedDataset?.columns ?? []).filter((c) => selectedDataset?.id !== DATASET || !hidden?.has(c)),
    [selectedDataset, hidden],
  );
  const timestamps = useMemo(() => (data ? data.time.map((t) => new Date(t).getTime() / 1000) : []), [data]);

  const handleSelectDataset = useCallback((ds: DatasetInfo) => {
    setSelectedDataset(ds);
    setSelectedFile(ds.files[0]);
    setSelectedColumns(ds.columns.slice(0, 3)); // the first columns are never HEX ones in the simulations
  }, []);

  useEffect(() => {
    let live = true;
    fetchDatasets()
      .then((res) => {
        if (!live) return;
        setDatasets(res.datasets);
        const current = res.datasets.find((d) => d.id === DATASET);
        if (current) handleSelectDataset(current);
      })
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [handleSelectDataset]);

  useEffect(() => {
    if (!selectedDataset || !selectedFile) return;
    let live = true; // a slower answer for a file left meanwhile is dropped
    setLoading(true);
    setError(null);
    fetchTimeSeriesData(selectedDataset.id, selectedFile)
      .then((res) => live && setData(res))
      .catch((e) => live && setError(errorMessage(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [selectedDataset, selectedFile]);

  const handleToggleColumn = useCallback((col: string) => setSelectedColumns((prev) => (prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col])), []);

  return {
    datasets,
    selectedDataset,
    selectedFile,
    selectedColumns,
    columns,
    data,
    loading,
    error,
    timestamps,
    setSelectedFile,
    setError,
    handleSelectDataset,
    handleToggleColumn,
    handleSelectAll: useCallback(() => setSelectedColumns(columns), [columns]),
    handleDeselectAll: useCallback(() => setSelectedColumns([]), []),
  };
}

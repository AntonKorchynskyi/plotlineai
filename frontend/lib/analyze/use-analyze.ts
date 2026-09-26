"use client";

import { useCallback, useState } from "react";
import {
  checkFile,
  createShare,
  describeChart,
  renderChart,
  suggest,
  uploadCsv,
  type Failure,
  type Suggestion,
  type UploadedDataset,
} from "@/lib/analyze/client";
import type { RenderedData } from "@/lib/chart-config";
import type { ChartSpec } from "@/lib/chart-spec";

/**
 * The analyze flow, as one state machine. Each step is a screen in
 * designs/plotlineai-prototype.html.
 *
 * Failures split in two. A rejected upload replaces the screen, because there is nothing
 * else to show. Anything later (rate limited, AI down, a refused spec) becomes a `notice`
 * beside the chart or suggestions already on screen, so the user does not lose their work.
 */

export type RenderedSuggestion = Suggestion & { rendered: RenderedData | null };

export type AnalyzeState =
  | { step: "idle" }
  | { step: "parsing"; fileName: string }
  | { step: "thinking"; fileName: string; dataset: UploadedDataset }
  | {
      step: "suggestions";
      fileName: string;
      dataset: UploadedDataset;
      suggestions: RenderedSuggestion[];
    }
  | {
      step: "rendering";
      fileName: string;
      dataset: UploadedDataset;
      suggestions: RenderedSuggestion[];
    }
  | {
      step: "chart";
      fileName: string;
      dataset: UploadedDataset;
      suggestions: RenderedSuggestion[];
      spec: ChartSpec;
      rendered: RenderedData;
    }
  | {
      step: "empty";
      fileName: string;
      dataset: UploadedDataset;
      suggestions: RenderedSuggestion[];
      spec: ChartSpec;
    }
  | { step: "rejected"; failure: Failure };

/** A render with no series, or only empty ones, is the designed "nothing left to plot". */
const isEmptyRender = (rendered: RenderedData) =>
  rendered.datasets.length === 0 || rendered.datasets.every((d) => d.data.length === 0);

export function useAnalyze() {
  const [state, setState] = useState<AnalyzeState>({ step: "idle" });
  const [notice, setNotice] = useState<Failure | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const upload = useCallback(async (file: File) => {
    setNotice(null);
    setShareUrl(null);

    const rejected = checkFile(file);
    if (rejected) {
      setState({ step: "rejected", failure: rejected });
      return;
    }

    setState({ step: "parsing", fileName: file.name });
    const uploaded = await uploadCsv(file);
    if (!uploaded.ok) {
      setState({ step: "rejected", failure: uploaded });
      return;
    }

    const dataset = uploaded.value;
    setState({ step: "thinking", fileName: file.name, dataset });

    const suggested = await suggest(dataset.datasetId);
    if (!suggested.ok) {
      setNotice(suggested);
      setState({ step: "suggestions", fileName: file.name, dataset, suggestions: [] });
      return;
    }

    // Thumbnails: one render per suggestion. A refused spec simply loses its thumbnail.
    const suggestions = await Promise.all(
      suggested.value.map(async (suggestion) => {
        const drawn = await renderChart(dataset.datasetId, suggestion.spec);
        return { ...suggestion, rendered: drawn.ok ? drawn.value : null };
      }),
    );
    setState({ step: "suggestions", fileName: file.name, dataset, suggestions });
  }, []);

  /**
   * Renders a spec and moves to the chart, or to the empty screen when nothing is left.
   *
   * From the suggestions, the cards stay up but locked ("rendering"). From a chart or the
   * empty screen, that screen stays up while busy: switching to "rendering" there would
   * flash the suggestions between one chart and the next. A failed render leaves whatever
   * was on screen and adds a notice.
   */
  const render = useCallback(
    async (spec: ChartSpec) => {
      if (!("dataset" in state)) return;
      const { fileName, dataset, suggestions } = {
        suggestions: [] as RenderedSuggestion[],
        ...state,
      };
      const fromResult = state.step === "chart" || state.step === "empty";

      setBusy(true);
      if (!fromResult) setState({ step: "rendering", fileName, dataset, suggestions });

      const drawn = await renderChart(dataset.datasetId, spec);
      setBusy(false);

      if (!drawn.ok) {
        setNotice(drawn);
        if (!fromResult) setState({ step: "suggestions", fileName, dataset, suggestions });
        return;
      }
      setShareUrl(null);
      setNotice(null);
      setState(
        isEmptyRender(drawn.value)
          ? { step: "empty", fileName, dataset, suggestions, spec }
          : { step: "chart", fileName, dataset, suggestions, spec, rendered: drawn.value },
      );
    },
    [state],
  );

  const choose = useCallback(
    async (index: number) => {
      if (!("suggestions" in state)) return;
      const suggestion = state.suggestions[index];
      if (suggestion) await render(suggestion.spec);
    },
    [render, state],
  );

  const describe = useCallback(
    async (instruction: string) => {
      if (!("dataset" in state)) return;
      const currentSpec = "spec" in state ? state.spec : undefined;

      setBusy(true);
      const described = await describeChart(state.dataset.datasetId, instruction, currentSpec);
      setBusy(false);

      if (!described.ok) {
        setNotice(described);
        return;
      }
      setNotice(null);
      await render(described.value);
    },
    [render, state],
  );

  const share = useCallback(async () => {
    if (state.step !== "chart") return;

    setBusy(true);
    const created = await createShare(state.dataset.datasetId, state.spec);
    setBusy(false);

    if (!created.ok) {
      setShareUrl(null);
      setNotice(created);
      return;
    }
    setNotice(null);
    setShareUrl(`${window.location.origin}/s/${created.value}`);
  }, [state]);

  /** The empty screen's way out: the same chart over every row. */
  const dropFilters = useCallback(async () => {
    if (state.step !== "empty") return;
    await render({ ...state.spec, filters: [] });
  }, [render, state]);

  const backToSuggestions = useCallback(() => {
    if (!("suggestions" in state)) return;
    setNotice(null);
    setShareUrl(null);
    setState({
      step: "suggestions",
      fileName: state.fileName,
      dataset: state.dataset,
      suggestions: state.suggestions,
    });
  }, [state]);

  const reset = useCallback(() => {
    setNotice(null);
    setShareUrl(null);
    setState({ step: "idle" });
  }, []);

  return {
    state,
    notice,
    shareUrl,
    busy,
    upload,
    choose,
    describe,
    share,
    dropFilters,
    backToSuggestions,
    reset,
  };
}

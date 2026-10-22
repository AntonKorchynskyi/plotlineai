import type { AiDeps } from "@/lib/ai/structured-call";
import { validateSpecs, type DatasetDetail, type SpecCheckResult } from "@/lib/backend";
import type { ChartSpec } from "@/lib/chart-spec";

/** Which of the model's specs would draw, and why the others were refused. */
export type SpecCheck<T extends { spec: ChartSpec }> = {
  passed: T[];
  refused: { spec: ChartSpec; error: string }[];
};

/** What the model is told about a chart that would render empty. */
export const EMPTY_CHART =
  "The chart has no data to show: its filters match no rows or its columns hold no values";

/**
 * Dry-runs AI output against the dataset before it is shown. `refuseEmpty` also refuses a spec
 * that would draw nothing: right for suggestions the model picks, wrong for a chart the user
 * described, whose empty result is a screen of its own (it offers to drop the filters).
 *
 * If the check itself cannot run (the api is down), everything passes: rendering validates
 * the same rules again, so failing open costs a "Preview unavailable" at worst, never a
 * wrong chart.
 */
export async function checkSpecs<T extends { spec: ChartSpec }>(
  datasetId: DatasetDetail["datasetId"],
  items: T[],
  deps: AiDeps,
  options: { refuseEmpty: boolean },
): Promise<SpecCheck<T>> {
  let results: SpecCheckResult[];
  try {
    results = await (deps.validate ?? validateSpecs)(
      datasetId,
      items.map((i) => i.spec),
    );
  } catch (failure) {
    console.error(
      JSON.stringify({
        event: "spec_check_skipped",
        error: failure instanceof Error ? failure.name : typeof failure,
      }),
    );
    return { passed: items, refused: [] };
  }
  const passed: T[] = [];
  const refused: SpecCheck<T>["refused"] = [];
  items.forEach((item, i) => {
    const { error, empty } = results[i];
    const reason = error ?? (empty && options.refuseEmpty ? EMPTY_CHART : null);
    if (reason) refused.push({ spec: item.spec, error: reason });
    else passed.push(item);
  });
  if (deps.record) deps.record.invalidSpecs += refused.length;
  return { passed, refused };
}

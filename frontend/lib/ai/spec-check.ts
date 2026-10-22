import type { AiDeps } from "@/lib/ai/structured-call";
import { validateSpecs, type DatasetDetail } from "@/lib/backend";
import type { ChartSpec } from "@/lib/chart-spec";

/** Which of the model's specs the api would render, and why the others would be refused. */
export type SpecCheck<T extends { spec: ChartSpec }> = {
  passed: T[];
  refused: { spec: ChartSpec; error: string }[];
};

/**
 * Checks AI output against the dataset's schema before it is shown. If the check itself
 * cannot run (the api is down), everything passes: rendering validates the same rules again,
 * so failing open costs a "Preview unavailable" at worst, never a wrong chart.
 */
export async function checkSpecs<T extends { spec: ChartSpec }>(
  datasetId: DatasetDetail["datasetId"],
  items: T[],
  deps: AiDeps,
): Promise<SpecCheck<T>> {
  let errors: (string | null)[];
  try {
    errors = await (deps.validate ?? validateSpecs)(
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
    const error = errors[i];
    if (error) refused.push({ spec: item.spec, error });
    else passed.push(item);
  });
  if (deps.record) deps.record.invalidSpecs += refused.length;
  return { passed, refused };
}

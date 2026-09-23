import { z } from "zod";
import { suggestCharts } from "@/lib/ai/suggest";
import { handleAiRoute } from "@/lib/api-route";

const Body = z.strictObject({ datasetId: z.uuid() });

/** POST { datasetId } -> { suggestions: [{ rationale, spec }] x3 } */
export async function POST(request: Request) {
  return handleAiRoute(request, "suggest", Body, async (_body, dataset) => ({
    suggestions: await suggestCharts(dataset),
  }));
}

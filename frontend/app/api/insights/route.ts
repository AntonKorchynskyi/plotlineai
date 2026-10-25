import { z } from "zod";
import { generateInsights } from "@/lib/ai/insights";
import { handleAiRoute } from "@/lib/api-route";
import { fetchStoredInsights, storeInsights } from "@/lib/backend";

const Body = z.strictObject({ datasetId: z.uuid() });

/**
 * The insights for an uploaded dataset. Written once by the AI and stored next to the dataset,
 * so asking again (a reload, a second tab) costs no AI call, and a share made later copies them.
 */
export async function POST(request: Request): Promise<Response> {
  return handleAiRoute(request, "insights", Body, async (body, dataset, deps) => {
    const stored = await fetchStoredInsights(body.datasetId);
    if (stored) return { insights: stored };

    const insights = await generateInsights(dataset, deps);
    try {
      await storeInsights(body.datasetId, insights);
    } catch (failure) {
      // The user still sees them; only a share made later goes without.
      console.error(
        JSON.stringify({
          event: "insights_store_failed",
          error: failure instanceof Error ? failure.name : typeof failure,
        }),
      );
    }
    return { insights };
  });
}

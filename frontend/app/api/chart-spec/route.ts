import { z } from "zod";
import { describeChart } from "@/lib/ai/chart-spec";
import { handleAiRoute } from "@/lib/api-route";
import { ChartSpecSchema } from "@/lib/chart-spec";

const MAX_INSTRUCTION_LENGTH = 500;

/** C0 controls (newline and tab included), DEL, and C1 controls. */
const hasControlCharacter = (text: string) =>
  [...text].some((c) => {
    const code = c.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });

const Body = z.strictObject({
  datasetId: z.uuid(),
  instruction: z
    .string()
    .trim()
    .min(1)
    .max(MAX_INSTRUCTION_LENGTH)
    .refine((s) => !hasControlCharacter(s)),
  currentSpec: ChartSpecSchema.optional(),
});

/** POST { datasetId, instruction, currentSpec? } -> { spec } */
export async function POST(request: Request) {
  return handleAiRoute(request, "chart-spec", Body, async (body, dataset) => ({
    spec: await describeChart(dataset, body.instruction, body.currentSpec),
  }));
}

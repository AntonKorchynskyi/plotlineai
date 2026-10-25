import { generateText, isStepCount, tool } from "ai";
import { z } from "zod";
import { dailyBudget } from "@/lib/ai/budget";
import { AiBadOutputError, AiUnavailableError } from "@/lib/ai/errors";
import { Evidence } from "@/lib/ai/insight-check";
import { INSIGHTS_SYSTEM_PROMPT, insightsPrompt, researchPrompt, type Finding } from "@/lib/ai/prompt";
import { insightSettings } from "@/lib/ai/provider";
import {
  logUsage,
  modelId,
  recordUsage,
  structuredCall,
  type AiDeps,
} from "@/lib/ai/structured-call";
import {
  BackendError,
  DatasetNotFoundError,
  QueryRefusedError,
  queryDataset,
  type DatasetDetail,
  type QueryResult,
} from "@/lib/backend";
import { ChartSpecModelSchema, dropNulls } from "@/lib/chart-spec";

export const MAX_INSIGHTS = 10;
/** The api stores insights of up to 240 characters; the model is asked for 200. */
export const MAX_INSIGHT_LENGTH = 240;
/** Model steps of research: each may run several queries at once. */
export const QUERY_ROUNDS = 3;
/**
 * The research call's own budget: every step answers within 15 s and all of them within 30 s,
 * so research and the writing call (20 s, see insightSettings) stay inside web's 60 s.
 */
const RESEARCH_TIMEOUT = { totalMs: 30_000, stepMs: 15_000 };

/**
 * The tool's input: a chart spec's grouping and aggregation fields (the same strict schemas
 * the chart calls use), minus what only drawing needs, and with the dimension optional so the
 * model can ask for a whole-file total.
 */
const QueryInputSchema = z.strictObject({
  dimension: ChartSpecModelSchema.shape.dimension.nullable(),
  measures: ChartSpecModelSchema.shape.measures,
  breakdown: ChartSpecModelSchema.shape.breakdown,
  filters: ChartSpecModelSchema.shape.filters,
  sort: ChartSpecModelSchema.shape.sort,
  limit: ChartSpecModelSchema.shape.limit,
});

const InsightListSchema = z.strictObject({ insights: z.array(z.string()) });

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Seams for tests: production queries the api. */
export type InsightDeps = AiDeps & {
  query?: (datasetId: string, query: unknown) => Promise<QueryResult>;
};

/**
 * Between 1 and 10 insights about a dataset, written by the AI in two calls:
 *
 * 1. Research: the model looks at the same schema and sample rows the chart calls see, and asks
 *    query_data whatever it wants to know; the api answers over every row.
 * 2. Writing: a structured call with no tools, given those questions and answers.
 *
 * Keeping the tools out of the call that must produce JSON is what makes the answer reliable:
 * a model told to stop calling tools mid-conversation can loop instead of answering. Every
 * model step draws from the daily AI budget. An insight with a number none of the research
 * supports is dropped, and none surviving is {@link AiBadOutputError}.
 */
export async function generateInsights(
  dataset: DatasetDetail,
  deps: InsightDeps = {},
): Promise<string[]> {
  const evidence = new Evidence();
  evidence.addValue(dataset.rowCount);
  evidence.addValue(dataset.schema.length);
  for (const column of dataset.schema) {
    evidence.addValue(column.cardinality);
    evidence.addValue(column.nullCount);
  }
  // A sample row is real data: quoting one of its cells is fine, summing them is not.
  for (const row of dataset.sampleRows) Object.values(row).forEach((cell) => evidence.addLabel(cell));

  // Insights run on their own model unless a test hands in settings.
  deps = { ...deps, settings: deps.settings ?? insightSettings };
  const findings = await research(dataset, evidence, deps);

  const output = await structuredCall(
    {
      system: INSIGHTS_SYSTEM_PROMPT,
      schema: InsightListSchema,
      name: "dataset_insights",
      description: "The insights worth telling about the dataset, most interesting first.",
      prompt: insightsPrompt(dataset, findings),
    },
    deps,
  );

  const kept: string[] = [];
  let refused = 0;
  for (const raw of output.insights) {
    const insight = raw.replace(/\s+/g, " ").trim();
    if (!insight || insight.length > MAX_INSIGHT_LENGTH || kept.includes(insight)) {
      refused++;
      continue;
    }
    if (evidence.unsupported(insight).length > 0) {
      refused++;
      continue;
    }
    kept.push(insight);
  }
  if (deps.record) deps.record.invalidSpecs += refused;
  if (kept.length === 0) throw new AiBadOutputError("no insight survived the evidence check");
  return kept.slice(0, MAX_INSIGHTS);
}

/** The research call: what the model asked and what came back, for the writing call. */
async function research(dataset: DatasetDetail, evidence: Evidence, deps: InsightDeps): Promise<Finding[]> {
  const settings = (deps.settings ?? insightSettings)();
  const budget = deps.budget ?? dailyBudget;
  const query = deps.query ?? queryDataset;
  if (deps.record) deps.record.model = modelId(settings);

  const findings: Finding[] = [];
  // A dataset that vanished or an api that failed mid-research ends the request, rather than
  // letting the model write insights about nothing.
  let fatal: Error | null = null;

  const queryData = tool({
    description:
      "Computes aggregates over every row of the dataset. Returns the group labels, one series " +
      "of values per measure (in label order), and totalGroups, the number of groups before the " +
      "limit. A sum or count series also has its total over every group and each group's share " +
      "of that total in percent.",
    inputSchema: QueryInputSchema,
    execute: async (input) => {
      const asked = dropNulls(input);
      try {
        const result = await query(dataset.datasetId, asked);
        // A breakdown splits the one measure into series, so every series shares its kind.
        const additive = (i: number) => {
          const measure = input.measures[input.breakdown ? 0 : i];
          return measure?.aggregation === "sum" || measure?.aggregation === "count";
        };
        const series = result.series.map((s, i) => {
          const total = result.totals[i];
          if (!additive(i) || !total) return { label: s.label, data: s.data };
          const sharePercent = s.data.map((v) => (v === null ? null : round2((v / total) * 100)));
          return { label: s.label, data: s.data, total, sharePercent };
        });
        const answer = { labels: result.labels, series, totalGroups: result.totalGroups };

        result.labels.forEach((label) => evidence.addLabel(label));
        evidence.addValue(result.totalGroups);
        for (const s of series) {
          s.data.forEach((v) => evidence.addValue(v));
          if ("sharePercent" in s) {
            evidence.addValue(s.total);
            s.sharePercent?.forEach((v) => evidence.addValue(v));
          }
        }
        findings.push({ query: asked, result: answer });
        return answer;
      } catch (error) {
        if (error instanceof QueryRefusedError) return { error: error.reason };
        if (error instanceof DatasetNotFoundError || error instanceof BackendError) fatal = error;
        return { error: "The query could not be run." };
      }
    },
  });

  try {
    const result = await generateText({
      ...settings,
      timeout: RESEARCH_TIMEOUT,
      system: INSIGHTS_SYSTEM_PROMPT,
      prompt: researchPrompt(dataset, QUERY_ROUNDS),
      tools: { query_data: queryData },
      stopWhen: isStepCount(QUERY_ROUNDS),
      prepareStep: async () => {
        await budget.consume();
        if (deps.record) deps.record.attempts++;
      },
    });
    logUsage("dataset_research", settings, result.usage);
    recordUsage(deps.record, result.usage);
  } catch (error) {
    if (fatal) throw fatal;
    if (error instanceof AiUnavailableError) throw error;
    if (error instanceof Error && error.cause instanceof AiUnavailableError) throw error.cause;
    throw new AiUnavailableError("model call failed", { cause: error });
  }
  if (fatal) throw fatal;
  return findings;
}

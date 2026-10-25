import { generateText, isStepCount, tool } from "ai";
import { z } from "zod";
import { dailyBudget } from "@/lib/ai/budget";
import { AiBadOutputError, AiBudgetRefusedError, AiUnavailableError } from "@/lib/ai/errors";
import { Evidence, withoutUnnamedCurrency } from "@/lib/ai/insight-check";
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

/**
 * A group label that totals other groups in the same column: "World" and "High income" in a
 * file of countries, "All natural disasters" beside each kind of disaster.
 */
const AGGREGATE_LABEL =
  /^(?:world|total|grand total|all(?: .*)?|.* total|(?:high|low|middle|upper middle|lower middle|low & middle) income|oecd members)$/i;

const round = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;

/**
 * A value as an insight would quote it: at most two decimals, or three significant digits
 * below 1 (0.0118, not 0). The model sees only these, and the evidence check holds it to
 * them, so "73.63886920684212" never reaches a reader.
 */
const tidy = (value: number | null) =>
  value === null || Number.isInteger(value)
    ? value
    : Math.abs(value) >= 1
      ? round(value, 2)
      : Number(value.toPrecision(3));

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
    evidence.addColumnName(column.name);
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

  // What the data itself says, for telling a stated currency from an invented one.
  const context = [
    ...dataset.schema.map((c) => c.name),
    ...dataset.sampleRows.flatMap((row) => Object.values(row)),
    // The group labels the research brought back, in their findings.
    JSON.stringify(findings),
  ].join("\n");

  const kept: string[] = [];
  let refused = 0;
  for (const raw of output.insights) {
    const insight = withoutUnnamedCurrency(raw, context).replace(/\s+/g, " ").trim();
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
      "Computes aggregates over every row of the dataset. Returns one record per group: its " +
      "label (group) beside each measure's value. For a sum or a count, each record also has the " +
      "group's share in percent of the total over every group, and totals holds those totals; " +
      "with a breakdown, a share is instead the series' part of its own group. " +
      "totalGroups is the number of groups before the limit.",
    inputSchema: QueryInputSchema,
    execute: async (input) => {
      const asked = dropNulls(input);
      // A threshold the model chose ("above 250,000") is its own to quote.
      for (const filter of input.filters ?? []) {
        for (const value of [filter.value].flat()) evidence.addLabel(String(value));
      }
      try {
        const result = await query(dataset.datasetId, asked);
        // A breakdown splits the one measure into series, so every series shares its kind.
        const additive = (i: number) => {
          const measure = input.measures[input.breakdown ? 0 : i];
          return measure?.aggregation === "sum" || measure?.aggregation === "count";
        };
        // Each series under a key of its own: a breakdown's labels are cell values, which may
        // repeat one another or the record's "group".
        const used = new Set(["group"]);
        // Rows such as "World" or "High income" beside the countries they total: a share of
        // their sum counts everything twice, and the model gave such shares despite its rules.
        const aggregate = result.labels.find((label) => AGGREGATE_LABEL.test(label.trim()));
        // A breakdown's share is of its own group ("North was 61% of January"): as a share of
        // the series' total over every group the model wrote it up as the group's share.
        const groupTotals = result.labels.map((_, g) =>
          result.series.reduce((sum, s) => sum + (s.data[g] ?? 0), 0),
        );
        const series = result.series.map((s, i) => {
          let key = s.label;
          for (let n = 2; used.has(key); n++) key = `${s.label} (${n})`;
          used.add(key);
          const total = result.totals[i];
          const data = s.data.map(tidy);
          if (!additive(i) || !total || aggregate !== undefined) return { key, data };
          // One decimal, the most a percentage in an insight may show.
          const share = s.data.map((v, g) => {
            const whole = input.breakdown ? groupTotals[g] : total;
            return v === null || !whole ? null : round((v / whole) * 100, 1);
          });
          return { key, data, total: tidy(total), share };
        });
        // One record per group, its label beside its values. With parallel arrays of labels
        // and values the model misread long answers, as in "2009 with 712" for 2011's count.
        const groups = result.labels.map((label, g) => {
          const record: Record<string, string | number | null> = { group: label };
          for (const s of series) {
            record[s.key] = s.data[g] ?? null;
            if (s.share) record[`${s.key} share %`] = s.share[g] ?? null;
          }
          return record;
        });
        const totals = Object.fromEntries(series.flatMap((s) => (s.share ? [[s.key, s.total]] : [])));
        const shown = result.labels.length;
        // Without this the model reads the last group of a cut-off series as its end, as in
        // "rose every year from 1960 to 2009" for a file that runs to 2025.
        const cutOff =
          result.totalGroups > shown
            ? `Only the first ${shown} of ${result.totalGroups} groups are shown, in the order asked for. The data goes on past the last group here: it is not the end of the data, and the groups after it may differ completely.`
            : undefined;
        // Named in code, so "the highest" never rests on the model scanning a long list: it
        // once called 2026 the peak year of a series whose 2012 was higher.
        const extreme = (pick: (a: number, b: number) => boolean) =>
          Object.fromEntries(
            series.flatMap((s) => {
              let best = -1;
              s.data.forEach((v, g) => {
                if (v !== null && (best < 0 || pick(v, s.data[best] as number))) best = g;
              });
              return shown > 2 && best >= 0 ? [[s.key, { group: result.labels[best], value: s.data[best] }]] : [];
            }),
          );
        const highest = extreme((a, b) => a > b);
        const lowest = extreme((a, b) => a < b);
        const answer = {
          groups,
          ...(Object.keys(totals).length > 0 ? { totals } : {}),
          ...(Object.keys(highest).length > 0 ? { highest, lowest } : {}),
          totalGroups: result.totalGroups,
          ...(cutOff ? { cutOff } : {}),
          ...(aggregate !== undefined
            ? {
                note: `Some groups (such as ${JSON.stringify(aggregate)}) look like totals of other groups, so shares and totals are left out: adding these groups up counts rows twice.`,
              }
            : {}),
        };

        result.labels.forEach((label) => evidence.addLabel(label));
        evidence.addValue(result.totalGroups);
        evidence.addValue(shown);
        for (const s of series) {
          s.data.forEach((v) => evidence.addValue(v));
          if (s.share) {
            evidence.addValue(s.total);
            s.share.forEach((v) => evidence.addValue(v));
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
    const refused =
      error instanceof AiBudgetRefusedError ||
      (error instanceof Error && error.cause instanceof AiBudgetRefusedError);
    // A step that timed out or failed after earlier ones answered still leaves real findings:
    // writing from them beats failing the upload. A spent budget would refuse the writing too.
    if (findings.length > 0 && !refused) {
      console.warn(
        JSON.stringify({
          event: "insights_research_cut_short",
          error: error instanceof Error ? error.name : typeof error,
          findings: findings.length,
        }),
      );
      return findings;
    }
    if (error instanceof AiUnavailableError) throw error;
    if (error instanceof Error && error.cause instanceof AiUnavailableError) throw error.cause;
    throw new AiUnavailableError("model call failed", { cause: error });
  }
  if (fatal) throw fatal;
  return findings;
}

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
 * The research call's own budget: all its steps answer within 30 s, so research and the writing
 * call (20 s, see insightSettings) stay inside web's 60 s. The first step asks most of the
 * questions at once and took up to 13.4 s against 3 to 5 s for each later one, so it may take
 * most of the 30: at 15 s, about one upload in thirty lost its insights to that step alone.
 */
export const RESEARCH_TIMEOUT = { totalMs: 30_000, stepMs: 25_000 };
/**
 * Queries of one round that run at once. The first round asks up to about nine, and each is a
 * call to the api, a Lambda of its own: all at once, one upload could take most of the
 * account's 10 concurrent executions, and a throttled query fails the insights. A query takes
 * well under a second, so two at a time costs about one.
 */
const QUERY_CONCURRENCY = 2;

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
  /^(?:world|total|grand total|.* total|(?:high|low|middle|upper middle|lower middle|low & middle) income|oecd members)$/i;
/**
 * "All" alone or before words in lower case ("All natural disasters"). A name that starts with
 * All is capitalised: "All Nippon Airways" read as a total threw out every sum over airlines.
 */
const ALL_LABEL = /^(?:all|All|ALL)(?: [^A-Z]*)?$/;
const isTotalLabel = (label: string) => AGGREGATE_LABEL.test(label.trim()) || ALL_LABEL.test(label.trim());

/**
 * A column name that reads as a rate, a percentage, an average or a level, whose rows do not
 * add up: the model summed such columns despite its rules ("loan_debt_pct climbed to 0.974").
 * "Per" a unit of time is a flow, though, which adds up across rows ("avail_seat_km_per_week"
 * over airlines).
 */
const NOT_ADDITIVE =
  /(?:^|[^a-z])(?:pct|percent|percentage|rate|ratio|avg|average|mean|median|share|index|score|price|per(?![^a-z]+(?:second|minute|hour|day|week|month|quarter|year|annum)s?(?:$|[^a-z]))|age|temp|temperature|expectancy)(?:$|[^a-z])/i;
/** Words of a column name, so "ShareWomen" reads as "Share Women". */
const words = (name: string) => name.replace(/([a-z])([A-Z])/g, "$1 $2");

/** A group label that is a year, from a year column read as numbers. */
const YEAR = /^(?:1[5-9]|20|21)\d{2}$/;
/** A first or last period holding less than this part of a typical one may be incomplete. */
const PARTIAL_SHARE = 2 / 3;

/**
 * Whether an insight reads as a whole sentence: it ends like one and opens every quote it
 * closes. The model once ended a string at the quote around a column name, which split one
 * insight into "The" and the rest of it; 1,813 insights over the evaluation passed.
 */
const isSentence = (insight: string) =>
  /[.!?][)"”’]*$/.test(insight) && (insight.match(/"/g) ?? []).length % 2 === 0;

/**
 * Where a period falls in the year, for comparing like with like: a month bucket's month, a
 * quarter's quarter, and a week's or a day's month. A year has no season, so every year shares
 * one.
 */
const season = (label: string, bucket: string | null | undefined) =>
  bucket === "quarter" ? label.slice(5) : bucket === "month" || bucket === "week" || bucket === "day" ? label.slice(5, 7) : "";

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
    if (!insight || insight.length > MAX_INSIGHT_LENGTH || kept.includes(insight) || !isSentence(insight)) {
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

  // Columns holding rows that total the others ("All natural disasters" beside each kind),
  // from the sample rows and from every answer so far. A sum or a count over the whole file
  // that does not split or filter on such a column counts those rows twice: the model asked
  // for yearly totals in the same round that showed it the total row, and wrote them up.
  const totalRows = new Map<string, string>();
  for (const row of dataset.sampleRows) {
    for (const [column, cell] of Object.entries(row)) {
      if (isTotalLabel(cell)) totalRows.set(column, cell.trim());
    }
  }
  type Asked = {
    dimension?: { column: string };
    breakdown?: { column: string };
    filters?: { column: string }[];
    measures: { aggregation: string }[];
  };
  const countedTwice = (asked: Asked) => {
    if (!asked.measures.some((m) => m.aggregation === "sum" || m.aggregation === "count")) return undefined;
    const split = [asked.dimension?.column, asked.breakdown?.column, ...(asked.filters ?? []).map((f) => f.column)];
    const column = [...totalRows.keys()].find((c) => !split.includes(c));
    return column === undefined
      ? undefined
      : `${column} holds rows that total the others (such as ${JSON.stringify(totalRows.get(column))}), and this answer adds them up with the rows they total, counting them twice: ask again with a filter on ${column}.`;
  };

  const queryData = tool({
    description:
      "Computes aggregates over every row of the dataset. Returns one record per group: its " +
      "label (group) beside each measure's value. For a sum or a count, each record also has the " +
      "group's share in percent of the total over every group, and totals holds those totals; " +
      "with a breakdown, a share is instead the series' part of its own group. " +
      "totalGroups is the number of groups before the limit. When the groups are periods in " +
      "order (a DATE dimension, or years, sorted by them), change gives each series' first and " +
      "last value and the change between them in percent (and, with a breakdown of a sum or a " +
      "count, its share % of the first and last period), and roseMost and fellMost name the " +
      "series that rose and fell most: by share of the period, in points, where there are " +
      "shares. Over more than a year of months, quarters, weeks or days, change ends at the " +
      "latest period in the first one's season (January to a later January), so seasons are " +
      "not compared with each other. A first or last period far smaller than the rest is " +
      "named in partial and left out of change.",
    inputSchema: QueryInputSchema,
    execute: async (input) => {
      const asked = dropNulls(input);
      // A threshold the model chose ("above 250,000") is its own to quote.
      for (const filter of input.filters ?? []) {
        for (const value of [filter.value].flat()) evidence.addLabel(String(value));
      }
      try {
        const result = await query(dataset.datasetId, asked);
        const notes: string[] = [];
        // A breakdown splits the one measure into series, so every series shares its kind.
        const measureOf = (i: number) => input.measures[input.breakdown ? 0 : i];
        const notAdditive = input.measures.filter(
          (m) => m.aggregation === "sum" && m.column !== null && NOT_ADDITIVE.test(words(m.column)),
        );
        for (const m of notAdditive) {
          notes.push(`${m.column} reads as a rate, a percentage, an average or a level: adding its rows up means nothing, so compare it with avg instead.`);
        }
        const additive = (i: number) => {
          const measure = measureOf(i);
          return measure?.aggregation === "count" || (measure?.aggregation === "sum" && !notAdditive.includes(measure));
        };
        // Each series under a key of its own: a breakdown's labels are cell values, which may
        // repeat one another or the record's "group".
        const used = new Set(["group"]);
        // Rows such as "World" or "High income" beside the countries they total, as groups or as
        // a breakdown's series: a share of their sum counts everything twice, and the model gave
        // such shares despite its rules.
        const aggregate = result.labels.find(isTotalLabel);
        const aggregateSeries = input.breakdown
          ? result.series.map((s) => s.label).find(isTotalLabel)
          : undefined;
        if (input.dimension && aggregate !== undefined) totalRows.set(input.dimension.column, aggregate.trim());
        if (input.breakdown && aggregateSeries !== undefined) totalRows.set(input.breakdown.column, aggregateSeries.trim());
        const twice = countedTwice(asked as Asked);
        if (twice) notes.push(twice);
        const inflated = aggregate ?? aggregateSeries ?? (twice ? "" : undefined);
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
          if (!additive(i) || !total || inflated !== undefined) return { key, data };
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
        // Over time, each series' change from its first period to its last, named in code: a
        // total can hide groups that move apart, and the model reads a long breakdown no better
        // than a long list. Left to itself it also compared a partial last period with full
        // ones, and quoted percentages from tiny starts ("rose 600%, from 1 to 7"), so a first or
        // last period far smaller than the rest is set aside, and the series that moved most are
        // ranked by their share of each period where there is one.
        const dimension = dataset.schema.find((c) => c.name === input.dimension?.column);
        const overTime =
          shown >= 2 &&
          !cutOff &&
          (!input.sort || input.sort.by === "dimension") &&
          (dimension?.type === "DATE" || result.labels.every((label) => YEAR.test(label.trim())));
        // Group indexes, oldest first.
        const periods = result.labels.map((_, g) => g);
        if (input.sort?.direction === "desc") periods.reverse();
        // What each period holds in all, for a sum or a count: with a breakdown, its series added,
        // or the series that totals the others where there is one ("all" beside each kind),
        // since adding it to its parts doubles every period.
        const firstAdditive = result.series.findIndex((_, i) => additive(i));
        const totalSeries = result.series.find((s) => s.label === aggregateSeries);
        const held = input.breakdown
          ? additive(0) ? (totalSeries?.data ?? groupTotals) : null
          : firstAdditive >= 0 ? result.series[firstAdditive].data : null;
        const partial: { group: string; holds: number | null; typical: number | null }[] = [];
        let [first, last] = [0, periods.length - 1];
        if (overTime && held && periods.length >= 4) {
          const sorted = periods.map((g) => held[g] ?? 0).sort((a, b) => a - b);
          const typical = sorted[Math.floor(sorted.length / 2)];
          // Small beside its neighbour too: a series that grows tenfold starts far below its
          // typical period without its first period being partial.
          const small = (end: number, neighbour: number) =>
            typical > 0 &&
            (held[periods[end]] ?? 0) < typical * PARTIAL_SHARE &&
            (held[periods[end]] ?? 0) < (held[periods[neighbour]] ?? 0) * PARTIAL_SHARE;
          for (const end of [first, last]) {
            if (!small(end, end === first ? first + 1 : last - 1)) continue;
            partial.push({ group: result.labels[periods[end]], holds: tidy(held[periods[end]]), typical: tidy(typical) });
            if (end === first) first++;
            else last--;
          }
        }
        const changes = overTime
          ? series.flatMap((s) => {
              const points = periods
                .slice(first, last + 1)
                .flatMap((g) => (s.data[g] === null ? [] : [{ g, group: result.labels[g], value: s.data[g] as number }]));
              if (points.length < 2) return [];
              const from = points[0];
              // Over more than a year of months, quarters, weeks or days, the first and last
              // periods fall in different seasons: "rose 77.5% from January 2012 to December 2015"
              // was winter against a wet December. So change ends at the latest period in the
              // first one's season of a later year.
              const to =
                points.findLast(
                  (p) =>
                    p.group.slice(0, 4) > from.group.slice(0, 4) &&
                    season(p.group, input.dimension?.bucket) === season(from.group, input.dimension?.bucket),
                ) ?? points[points.length - 1];
              // A change from zero, or across it, has no percentage.
              const percent =
                from.value > 0 && to.value >= 0
                  ? round(((to.value - from.value) / from.value) * 100, 1)
                  : undefined;
              const shareFrom = s.share?.[from.g] ?? null;
              const shareTo = s.share?.[to.g] ?? null;
              return [
                {
                  key: s.key,
                  from: { group: from.group, value: from.value },
                  to: { group: to.group, value: to.value },
                  percent,
                  points: input.breakdown && shareFrom !== null && shareTo !== null ? { shareFrom, shareTo } : undefined,
                },
              ];
            })
          : [];
        // A series' part of each period moves with it alone: a shrinking or partial period, or a
        // small start, does not swing it the way a percentage change does.
        const ranked = changes.every((c) => c.points)
          ? changes.map((c) => ({ series: c.key, ...c.points!, by: round(c.points!.shareTo - c.points!.shareFrom, 1) }))
          : changes.flatMap((c) => (c.percent === undefined ? [] : [{ series: c.key, percent: c.percent, by: c.percent }]));
        ranked.sort((a, b) => b.by - a.by);
        const rose = ranked[0];
        const fell = ranked[ranked.length - 1];
        const named = ({ by, ...mover }: (typeof ranked)[number]) => ("shareFrom" in mover ? { ...mover, points: by } : mover);
        // With rows that total others among them, no series' movement means what it seems to.
        const movers =
          ranked.length >= 2 && inflated === undefined
            ? { ...(rose.by > 0 ? { roseMost: named(rose) } : {}), ...(fell.by < 0 ? { fellMost: named(fell) } : {}) }
            : {};
        const totalsAmong = aggregate ?? aggregateSeries;
        if (totalsAmong !== undefined) {
          notes.unshift(`Some groups (such as ${JSON.stringify(totalsAmong)}) look like totals of other groups, so shares and totals are left out: adding these groups up counts rows twice.`);
        }
        const answer = {
          groups,
          ...(Object.keys(totals).length > 0 ? { totals } : {}),
          ...(Object.keys(highest).length > 0 ? { highest, lowest } : {}),
          ...(changes.length > 0
            ? {
                change: Object.fromEntries(
                  changes.map(({ key, points, ...change }) => [
                    key,
                    points ? { ...change, "share %": { from: points.shareFrom, to: points.shareTo } } : change,
                  ]),
                ),
                ...movers,
              }
            : {}),
          ...(partial.length > 0
            ? {
                partial: partial
                  .map((p) => `${p.group} holds ${p.holds} against a typical ${p.typical} per period: it may be incomplete, so change leaves it out. Check it before comparing with it.`)
                  .join(" "),
              }
            : {}),
          totalGroups: result.totalGroups,
          ...(cutOff ? { cutOff } : {}),
          ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
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
        changes.forEach((c) => evidence.addValue(c.percent));
        ranked.forEach((m) => evidence.addValue(m.by));
        partial.forEach((p) => {
          evidence.addValue(p.holds);
          evidence.addValue(p.typical);
        });
        findings.push({ query: asked, result: answer });
        return answer;
      } catch (error) {
        if (error instanceof QueryRefusedError) return { error: error.reason };
        if (error instanceof DatasetNotFoundError || error instanceof BackendError) fatal = error;
        return { error: "The query could not be run." };
      }
    },
  });

  // The writing call never sees the figures of an answer that counts total rows twice, only
  // why: with a note beside them, the model still wrote them up ("1931 is the deadliest year"
  // at double the true toll). The total row may only show up in a later answer of the same
  // round, so every answer is checked once research is over.
  const flagged = () => {
    for (const finding of findings) {
      const twice = countedTwice(finding.query as Asked);
      if (twice) finding.result = { note: `${twice.split(":")[0]}, so its figures are left out.` };
    }
    return findings;
  };

  try {
    const result = await generateText({
      ...settings,
      timeout: RESEARCH_TIMEOUT,
      system: INSIGHTS_SYSTEM_PROMPT,
      prompt: researchPrompt(dataset, QUERY_ROUNDS),
      tools: { query_data: queryData },
      toolCallConcurrency: QUERY_CONCURRENCY,
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
      return flagged();
    }
    if (error instanceof AiUnavailableError) throw error;
    if (error instanceof Error && error.cause instanceof AiUnavailableError) throw error.cause;
    throw new AiUnavailableError("model call failed", { cause: error });
  }
  if (fatal) throw fatal;
  return flagged();
}

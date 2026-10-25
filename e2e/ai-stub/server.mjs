// A stand-in for the OpenAI Responses API, for end-to-end tests. web is pointed at it with
// OPENAI_BASE_URL, so the whole AI path runs (prompt, structured output, validation, the
// api's render) with deterministic answers and no network or key.
//
// It reads the dataset's columns out of the prompt, the same text the real model sees, and
// answers with specs the api will accept for that schema. Requests are recognised by the
// structured-output name web asks for: chart_suggestions, chart_spec or dataset_insights.
//
// Insights take two calls. The research call offers the query_data tool: the stub asks for the
// largest groups of the first numeric column, then ends the research with a note once web
// sends the result back. The writing call (dataset_insights) quotes the numbers of the first
// finding in its prompt, so the insights pass web's evidence check the way a real model's do.
//
// Free-text requests understand a few words, so a test can steer the result:
// "line", "doughnut", "pie", "horizontal", "stacked" pick the chart type, and "nothing"
// adds a filter no row matches (the empty-result screen).

import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8787);
const NUMERIC = new Set(["INTEGER", "DECIMAL"]);

function promptText(body) {
  const parts = [];
  for (const item of body.input ?? []) {
    if (typeof item.content === "string") parts.push(item.content);
    else for (const c of item.content ?? []) if (typeof c.text === "string") parts.push(c.text);
  }
  return parts.join("\n");
}

/** The column lines between "Columns:" and "Sample rows" in web's <dataset> block. */
function columnsOf(prompt) {
  const block = prompt.slice(prompt.indexOf("<dataset>"), prompt.indexOf("</dataset>"));
  const lines = block.split("\n");
  const start = lines.findIndex((l) => l.endsWith("Columns:"));
  const columns = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("Sample rows")) break;
    columns.push(JSON.parse(line));
  }
  return columns;
}

const between = (text, open, close) => {
  const a = text.indexOf(open);
  const b = text.indexOf(close);
  return a >= 0 && b > a ? text.slice(a + open.length, b).trim() : null;
};

function pickColumns(columns) {
  const category = columns
    .filter((c) => c.type === "STRING" && c.distinctValues <= 1000)
    .sort((a, b) => a.distinctValues - b.distinctValues)[0];
  const date = columns.find((c) => c.type === "DATE");
  const numeric = columns.find((c) => NUMERIC.has(c.type));
  const dimension = category
    ? { column: category.name, bucket: null }
    : { column: date?.name ?? columns[0].name, bucket: date ? "month" : null };
  const measure = numeric
    ? { column: numeric.name, aggregation: "sum", label: null }
    : { column: null, aggregation: "count", label: "Rows" };
  return { dimension, measure, numeric, category };
}

const spec = (fields) => ({
  chartType: "bar",
  stacked: null,
  title: "Chart",
  dimension: { column: "", bucket: null },
  measures: [],
  breakdown: null,
  filters: null,
  sort: null,
  limit: null,
  ...fields,
});

function suggestions(columns) {
  const { dimension, measure, numeric } = pickColumns(columns);
  const what = numeric ? numeric.name : "rows";
  const by = dimension.column;
  return {
    suggestions: [
      {
        rationale: `Ranks each ${by} by total ${what}.`,
        spec: spec({
          title: `Total ${what} by ${by}`,
          dimension,
          measures: [measure],
          sort: { by: "measure", direction: "desc" },
        }),
      },
      {
        rationale: `The ten biggest ${by} values side by side.`,
        spec: spec({
          chartType: "horizontalBar",
          title: `Top ${by} by ${what}`,
          dimension,
          measures: [measure],
          sort: { by: "measure", direction: "desc" },
          limit: 10,
        }),
      },
      {
        rationale: `Each ${by} as a share of the whole.`,
        spec: spec({
          chartType: "doughnut",
          title: `Share of ${what} by ${by}`,
          dimension,
          measures: [measure],
        }),
      },
    ],
  };
}

function described(columns, request, current) {
  const { dimension, measure } = pickColumns(columns);
  const words = request.toLowerCase();
  // The current spec arrives in contract form, with unused fields left out. Strict mode wants
  // every field present, so put the nulls back.
  const base = current
    ? spec({
        ...current,
        dimension: { bucket: null, ...current.dimension },
        measures: current.measures.map((m) => ({ label: null, column: null, ...m })),
      })
    : spec({ title: request.slice(0, 120), dimension, measures: [measure] });

  const chartType = words.includes("horizontal")
    ? "horizontalBar"
    : (["line", "doughnut", "pie", "area", "bar"].find((t) => words.includes(t)) ?? base.chartType);
  const out = {
    ...base,
    chartType,
    stacked: words.includes("stacked") && (chartType === "bar" || chartType === "area") ? true : null,
    title: current ? `${base.title} (${request.slice(0, 60)})` : base.title,
  };
  if (["pie", "doughnut"].includes(chartType)) out.breakdown = null;
  if (words.includes("nothing")) {
    out.filters = [{ column: out.dimension.column, op: "eq", value: "no row has this value" }];
  }
  return out;
}

/** The query_data result web sent back, or null on the first step of the loop. */
function toolResult(body) {
  const item = (body.input ?? []).find((i) => i.type === "function_call_output");
  if (!item) return null;
  const output = Array.isArray(item.output)
    ? item.output.map((part) => part.text ?? "").join("")
    : item.output;
  return JSON.parse(typeof output === "string" ? output : JSON.stringify(output));
}

function insightsQuery(columns) {
  const { dimension, measure } = pickColumns(columns);
  return {
    dimension,
    measures: [measure],
    breakdown: null,
    filters: null,
    sort: { by: "measure", direction: "desc" },
    limit: 5,
  };
}

const formatted = (value) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });

function insights(result) {
  const values = result.series[0]?.data ?? [];
  const lines = [`${result.labels[0]} leads with ${formatted(values[0])}.`];
  if (result.labels.length > 1) {
    lines.push(`${result.labels[1]} follows with ${formatted(values[1])}.`);
  }
  return { insights: lines };
}

function respond(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

let calls = 0;

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") return respond(res, 200, { ok: true, calls });
  if (req.method !== "POST" || !req.url.endsWith("/responses")) {
    return respond(res, 404, { error: { message: "not stubbed" } });
  }

  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    calls += 1;
    const body = JSON.parse(raw);
    const prompt = promptText(body);
    const columns = columnsOf(prompt);
    const name = body.text?.format?.name;

    const researching = (body.tools ?? []).some((t) => t.name === "query_data");
    if (researching && toolResult(body)) {
      return respond(res, 200, {
        id: `resp_stub_${calls}`,
        object: "response",
        created_at: Math.floor(Date.now() / 1000),
        status: "completed",
        model: body.model,
        output: [
          {
            type: "message",
            id: `msg_stub_${calls}`,
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: "Enough to write.", annotations: [] }],
          },
        ],
        usage: {
          input_tokens: 100,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 5,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 105,
        },
      });
    }
    if (researching) {
      return respond(res, 200, {
        id: `resp_stub_${calls}`,
        object: "response",
        created_at: Math.floor(Date.now() / 1000),
        status: "completed",
        model: body.model,
        output: [
          {
            type: "function_call",
            id: `fc_stub_${calls}`,
            call_id: `call_stub_${calls}`,
            name: "query_data",
            arguments: JSON.stringify(insightsQuery(columns)),
            status: "completed",
          },
        ],
        usage: {
          input_tokens: 100,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 20,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 120,
        },
      });
    }

    const output =
      name === "dataset_insights"
        ? insights(JSON.parse(between(prompt, "<findings>", "</findings>").split("\n")[0]).result)
        : name === "chart_suggestions"
          ? suggestions(columns)
          : described(
              columns,
              between(prompt, "<request>", "</request>") ?? "",
              JSON.parse(between(prompt, "<current-spec>", "</current-spec>") ?? "null"),
            );

    respond(res, 200, {
      id: `resp_stub_${calls}`,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "completed",
      model: body.model,
      output: [
        {
          type: "message",
          id: `msg_stub_${calls}`,
          status: "completed",
          role: "assistant",
          content: [{ type: "output_text", text: JSON.stringify(output), annotations: [] }],
        },
      ],
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 50,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 150,
      },
    });
  });
});

server.listen(PORT, () => console.log(`ai-stub listening on ${PORT}`));

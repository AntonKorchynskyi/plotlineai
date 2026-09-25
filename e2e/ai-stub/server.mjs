// A stand-in for the OpenAI Responses API, for end-to-end tests. web is pointed at it with
// OPENAI_BASE_URL, so the whole AI path runs (prompt, structured output, validation, the
// api's render) with deterministic answers and no network or key.
//
// It reads the dataset's columns out of the prompt, the same text the real model sees, and
// answers with specs the api will accept for that schema. Requests are recognised by the
// structured-output name web asks for: chart_suggestions or chart_spec.
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

    const output =
      name === "chart_suggestions"
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

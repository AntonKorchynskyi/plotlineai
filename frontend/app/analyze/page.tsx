"use client";

import PageShell from "@/components/PageShell";
import ChartPanel from "@/components/analyze/ChartPanel";
import DatasetSummary from "@/components/analyze/DatasetSummary";
import Dropzone from "@/components/analyze/Dropzone";
import InstructionForm from "@/components/analyze/InstructionForm";
import SuggestionCards from "@/components/analyze/SuggestionCards";
import {
  EmptyResult,
  Notice,
  Parsing,
  RejectedFile,
  Thinking,
} from "@/components/analyze/states";
import { useAnalyze } from "@/lib/analyze/use-analyze";

/**
 * The analyze flow: upload, suggestions, chart, refine, share. One state machine
 * (useAnalyze) decides which screen is on show; the screens themselves are dumb.
 */
export default function AnalyzePage() {
  const flow = useAnalyze();
  const { state, notice, shareUrl, busy } = flow;

  if (state.step === "idle") {
    return (
      <PageShell className="pt-16 pb-30">
        <h2 className="mb-2 text-page">Start with a CSV</h2>
        <p className="mb-8 text-[16px] text-ink-muted">
          One file, comma separated, with a header row. Nothing is stored beyond seven days.
        </p>
        <Dropzone onFile={flow.upload} />
        <div className="mt-10 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
          {[
            ["1. Parse", "The Java service streams your file, infers each column's type and counts distinct values."],
            ["2. Suggest", "The agent sees the schema and twenty sample rows, never the whole file, and returns three chart specs."],
            ["3. Render", "Each spec is checked against the real schema, then aggregated over every row before it is drawn."],
          ].map(([heading, body]) => (
            <div key={heading}>
              <div className="mb-1 font-heading text-card">{heading}</div>
              <p className="m-0 text-small text-ink-muted">{body}</p>
            </div>
          ))}
        </div>
      </PageShell>
    );
  }

  if (state.step === "rejected") {
    return <RejectedFile failure={state.failure} onRetry={flow.reset} />;
  }

  if (state.step === "parsing") {
    return <Parsing fileName={state.fileName} />;
  }

  const onChart = state.step === "chart";

  return (
    <PageShell className="pt-13 pb-30">
      {state.step !== "thinking" && (
        <DatasetSummary
          fileName={state.fileName}
          dataset={state.dataset}
          onReplace={flow.reset}
        />
      )}

      {notice && <Notice failure={notice} />}

      {state.step === "thinking" && <Thinking />}

      {(state.step === "suggestions" || state.step === "rendering") && (
        <>
          <h2 className="mb-2 text-page">Three charts worth a look</h2>
          <p className="mb-6 text-body text-ink-muted">
            Pick one to render it over every row, or describe the chart you had in mind.
          </p>
          {state.suggestions.length > 0 ? (
            <SuggestionCards
              suggestions={state.suggestions}
              onChoose={flow.choose}
              disabled={busy}
            />
          ) : (
            <p className="text-body text-ink-faint">
              No suggestions this time. Describe the chart you want below.
            </p>
          )}

          <div className="card elev-sm mt-6 gap-3 px-5 py-5">
            <span className="font-heading text-[18px]">Or describe it yourself</span>
            <InstructionForm
              placeholder="e.g. revenue by region as a doughnut, biggest first"
              submitLabel="Draw it"
              busy={busy}
              onSubmit={flow.describe}
            />
            <span className="text-meta text-ink-faint">
              500 characters max. Column names and cell values are treated as data, never as
              instructions.
            </span>
          </div>
        </>
      )}

      {state.step === "empty" && (
        <EmptyResult
          title={state.spec.title}
          onBack={flow.backToSuggestions}
          onSuggestions={flow.backToSuggestions}
        />
      )}

      {onChart && (
        <ChartPanel
          spec={state.spec}
          rendered={state.rendered}
          shareUrl={shareUrl}
          busy={busy}
          onRefine={flow.describe}
          onShare={flow.share}
        />
      )}
    </PageShell>
  );
}

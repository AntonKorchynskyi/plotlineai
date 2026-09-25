"use client";

import { useState } from "react";
import ChartRenderer, { type DrawnChart } from "@/components/ChartRenderer";
import { DownloadIcon, ShareIcon } from "@/components/icons";
import InstructionForm from "@/components/analyze/InstructionForm";
import { formatSpec, pngFileName } from "@/lib/analyze/labels";
import type { RenderedData } from "@/lib/chart-config";
import type { ChartSpec } from "@/lib/chart-spec";

const REFINE_CHIPS = [
  "Make it a doughnut",
  "Top five only",
  "Sort ascending",
  "Show it as a line",
];

/** The chart screen: the drawn chart, its actions, the refine box and the spec panel. */
export default function ChartPanel({
  spec,
  rendered,
  shareUrl,
  busy,
  onRefine,
  onShare,
  onBack,
}: {
  spec: ChartSpec;
  rendered: RenderedData;
  shareUrl: string | null;
  busy: boolean;
  onRefine: (instruction: string) => void;
  onShare: () => void;
  onBack: () => void;
}) {
  const [chart, setChart] = useState<DrawnChart | null>(null);
  const [copied, setCopied] = useState(false);

  const downloadPng = () => {
    if (!chart) return;
    const link = document.createElement("a");
    link.href = chart.toBase64Image();
    link.download = pngFileName(spec.title);
    link.click();
  };

  const copyShareUrl = async () => {
    if (!shareUrl) return;
    await navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-5">
        <h2 className="m-0 text-page">{rendered.title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {/* Last on a phone, so Download and Share keep a row together; first once they fit. */}
          <button type="button" className="btn btn-ghost order-last px-0 md:order-first md:mr-2" onClick={onBack}>
            Back to suggestions
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={downloadPng}
            disabled={!chart}
          >
            <DownloadIcon />
            Download PNG
          </button>
          <button type="button" className="btn btn-primary" onClick={onShare} disabled={busy}>
            <ShareIcon />
            Share
          </button>
        </div>
      </div>

      <div className="card elev-md p-6">
        <ChartRenderer data={rendered} height={400} onReady={setChart} />
      </div>

      {shareUrl && (
        <div className="card elev-sm mt-5 flex-row flex-wrap items-center gap-3 px-5 py-4">
          <span className="tag tag-accent">Read only</span>
          <a className="font-mono text-small" href={shareUrl}>
            {shareUrl}
          </a>
          <button type="button" className="btn btn-ghost ml-auto text-small" onClick={copyShareUrl}>
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      )}

      <div className="mt-5 grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
        <div className="card elev-sm gap-3 px-5 py-5">
          <span className="font-heading text-[18px]">Refine it</span>
          <InstructionForm
            placeholder="make it a doughnut, top five only…"
            submitLabel="Send"
            busy={busy}
            onSubmit={onRefine}
          />
          <div className="flex flex-wrap gap-2">
            {REFINE_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                className="btn btn-secondary text-small"
                disabled={busy}
                onClick={() => onRefine(chip)}
              >
                {chip}
              </button>
            ))}
          </div>
        </div>

        <div className="card elev-sm gap-2 bg-neutral-100 px-5 py-5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-heading text-[18px]">ChartSpec</span>
            <span className="tag tag-accent-2">validated</span>
          </div>
          <pre className="m-0 overflow-x-auto font-mono text-[12px] leading-relaxed whitespace-pre text-ink-muted">
            {formatSpec(spec)}
          </pre>
          <span className="text-meta text-ink-faint">
            Every column checked against the stored schema before rendering.
          </span>
        </div>
      </div>
    </>
  );
}

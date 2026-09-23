import Link from "next/link";
import { AlertTriangleIcon, BarChartIcon } from "@/components/icons";
import type { Failure } from "@/lib/analyze/client";
import { noticeCopy, rejectionCopy } from "@/lib/analyze/messages";

/** The waiting, empty and rejected screens. Design section 6. */

const shimmer = (width: string, delay: number, accent = false) => (
  <div
    key={`${width}-${delay}`}
    className={`h-3 rounded-pill ${accent ? "bg-accent-200" : "bg-neutral-200"}`}
    style={{ width, animation: `plShimmer 1.4s ease-in-out ${delay}ms infinite` }}
  />
);

export function Spinner({ size = 54 }: { size?: number }) {
  return (
    <span
      role="status"
      aria-label="Working"
      className="inline-block rounded-pill border-accent-200"
      style={{
        width: size,
        height: size,
        borderWidth: size > 30 ? 4 : 3,
        borderStyle: "solid",
        borderTopColor: "var(--accent)",
        animation: "plSpin 900ms linear infinite",
      }}
    />
  );
}

export function Parsing({ fileName }: { fileName: string }) {
  return (
    <div className="mx-auto max-w-upload px-6 pt-22 pb-32 text-center">
      <Spinner />
      <h2 className="mt-6 mb-2 text-section">Parsing {fileName}</h2>
      <p className="mb-8 text-body text-ink-muted">Streaming rows, inferring column types.</p>
      <div className="card elev-sm gap-3 p-5 text-left">
        {[shimmer("42%", 0, true), shimmer("78%", 120), shimmer("61%", 240)]}
      </div>
    </div>
  );
}

export function Thinking() {
  return (
    <>
      <div className="mb-2 flex items-center gap-3">
        <Spinner size={22} />
        <h2 className="m-0 text-section">Reading your columns</h2>
      </div>
      <p className="mb-7 text-body text-ink-muted">One structured call, usually a few seconds.</p>
      <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
        {[0, 1, 2].map((card) => (
          <div key={card} className="card elev-sm gap-3 p-5">
            {[
              shimmer(`${55 + card * 6}%`, card * 160, true),
              shimmer(`${92 - card * 4}%`, card * 160 + 100),
              shimmer(`${70 - card * 3}%`, card * 160 + 200),
            ]}
          </div>
        ))}
      </div>
    </>
  );
}

export function EmptyResult({
  title,
  onBack,
  onSuggestions,
}: {
  title: string;
  onBack: () => void;
  onSuggestions: () => void;
}) {
  return (
    <div className="card elev-md items-center gap-3 px-8 py-13 text-center">
      <span className="inline-flex size-22 items-center justify-center rounded-pill bg-accent-2-200 text-accent-2-800">
        <BarChartIcon size={40} />
      </span>
      <span className="font-heading text-[24px]">Nothing left to plot</span>
      <p className="m-0 max-w-[34em] text-body text-ink-muted">
        {title} matched no rows once the filters were applied. Loosen them, or start from a
        different chart.
      </p>
      <div className="mt-1 flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary px-5 py-3" onClick={onBack}>
          Try another request
        </button>
        <button type="button" className="btn btn-ghost px-4 py-3" onClick={onSuggestions}>
          Back to suggestions
        </button>
      </div>
    </div>
  );
}

export function RejectedFile({ failure, onRetry }: { failure: Failure; onRetry: () => void }) {
  const copy = rejectionCopy(failure);
  return (
    <div className="mx-auto max-w-notice px-6 pt-20 pb-32">
      <div className="card elev-md gap-4 p-7">
        <span className="inline-flex size-12 items-center justify-center rounded-pill bg-accent-200 text-accent-700">
          <AlertTriangleIcon size={24} />
        </span>
        <h2 className="m-0 text-section">{copy.heading}</h2>
        <p className="m-0 text-body text-ink-muted">{copy.detail}</p>
        <div className="flex flex-col gap-2 text-small text-ink-faint">
          <span>· .csv extension and text/csv content type</span>
          <span>· 5 MB, 100,000 rows, 256 columns</span>
          <span>· UTF-8 text with one header row</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary px-5 py-3" onClick={onRetry}>
            Pick another file
          </button>
          <Link className="btn btn-secondary px-5 py-3" href="/#gallery">
            Browse the examples
          </Link>
        </div>
      </div>
    </div>
  );
}

/** A failure that does not take the screen away: shown beside whatever is already there. */
export function Notice({ failure }: { failure: Failure }) {
  return (
    <div
      role="status"
      className="card elev-sm mb-5 flex-row items-center gap-3 border border-accent-300 px-5 py-3"
    >
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-pill bg-accent-200 text-accent-700">
        <AlertTriangleIcon size={15} />
      </span>
      <span className="text-small">{noticeCopy(failure)}</span>
    </div>
  );
}

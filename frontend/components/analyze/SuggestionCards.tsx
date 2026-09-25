"use client";

import ChartRenderer from "@/components/ChartRenderer";
import type { RenderedSuggestion } from "@/lib/analyze/use-analyze";
import { chartTypeName } from "@/lib/analyze/labels";

/** The three suggestion cards. Each is one click away from the full chart. */
export default function SuggestionCards({
  suggestions,
  onChoose,
  disabled,
}: {
  suggestions: RenderedSuggestion[];
  onChoose: (index: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
      {suggestions.map((suggestion, index) => (
        <button
          key={`${suggestion.spec.title}-${index}`}
          type="button"
          disabled={disabled}
          onClick={() => onChoose(index)}
          className="card elev-sm cursor-pointer gap-3 border border-transparent p-5 text-left hover:border-accent hover:shadow-md"
        >
          <span className="flex items-center justify-between gap-2">
            <span className="card-kicker">Suggestion {index + 1}</span>
            <span className="tag tag-accent">{chartTypeName(suggestion.spec)}</span>
          </span>
          <span className="card-title text-card">{suggestion.spec.title}</span>
          <p className="card-body text-small">{suggestion.rationale}</p>
          {suggestion.rendered ? (
            <span className="mt-1 block rounded-[18px] bg-background p-2">
              <ChartRenderer data={suggestion.rendered} height={104} compact />
            </span>
          ) : (
            <span className="mt-1 block rounded-[18px] bg-background p-2 text-center text-meta text-ink-faint leading-[104px]">
              Preview unavailable
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

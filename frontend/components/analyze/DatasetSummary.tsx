import { CheckIcon } from "@/components/icons";
import type { UploadedDataset } from "@/lib/analyze/client";

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

/** The card above the suggestions: what was parsed, and what each column was read as. */
export default function DatasetSummary({
  fileName,
  dataset,
  onReplace,
}: {
  fileName: string;
  dataset: UploadedDataset;
  onReplace: () => void;
}) {
  const nulls = dataset.schema.reduce((sum, c) => sum + c.nullCount, 0);

  return (
    <div className="card elev-sm mb-9 gap-3 px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex size-8 items-center justify-center rounded-pill bg-accent-2-200 text-accent-2-800">
          <CheckIcon size={17} />
        </span>
        <span className="font-heading text-card">{fileName}</span>
        <span className="tag tag-neutral">{plural(dataset.rowCount, "row")}</span>
        <span className="tag tag-neutral">{plural(dataset.schema.length, "column")}</span>
        <span className="tag tag-neutral">{plural(nulls, "null")}</span>
        <button type="button" className="btn btn-ghost ml-auto text-small" onClick={onReplace}>
          Replace file
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {dataset.schema.map((column) => (
          <span key={column.name} className="tag tag-accent-2">
            {column.name} · {column.type.toLowerCase()} ·{" "}
            {plural(column.cardinality, "distinct value")}
          </span>
        ))}
      </div>
    </div>
  );
}

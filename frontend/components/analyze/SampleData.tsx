"use client";

import { useRef, type MouseEvent } from "react";
import { XIcon } from "@/components/icons";
import { sampleFile, sampleTable } from "@/lib/analyze/sample-data";

const { header, rows } = sampleTable();
const NUMBER = /^-?\d+(\.\d+)?$/;
/** Numbers sit right-aligned, so the columns read like a spreadsheet. */
const numeric = header.map((_, i) => rows.every((row) => NUMBER.test(row[i])));

/**
 * The upload screen's way in without a file: a link under the dropzone that opens a preview
 * of the sample, and "Use this data" hands the sample to the same upload as a dropped file.
 * A native modal <dialog> brings the focus trap, Escape and the backdrop.
 */
export default function SampleData({ onUse }: { onUse: (file: File) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  const close = () => dialog.current?.close();

  // A click on the backdrop lands on the dialog itself, outside its box.
  const onBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target !== e.currentTarget) return;
    const box = e.currentTarget.getBoundingClientRect();
    const inside =
      e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom;
    if (!inside) close();
  };

  return (
    <>
      <p className="mt-5 mb-0 text-center text-small text-ink-muted">
        No CSV handy?{" "}
        <button
          type="button"
          className="cursor-pointer font-semibold text-accent-700 underline underline-offset-3 hover:text-accent-600"
          onClick={() => dialog.current?.showModal()}
        >
          Try our sample data
        </button>
      </p>

      <dialog
        ref={dialog}
        aria-labelledby="sample-title"
        className="dialog w-[880px] gap-4 p-5"
        onClick={onBackdrop}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="sample-title" className="dialog-title m-0">
              Sample: coffee shop sales
            </h2>
            <p className="m-0 mt-1 text-small text-ink-muted">
              {rows.length} rows · {header.length} columns · made-up data from six months at three
              stores
            </p>
          </div>
          <button
            type="button"
            // Pulled out by the icon's inset, so the glyph lines up with the table's edge.
            className="btn btn-ghost btn-icon -mt-1 -mr-[9px] shrink-0"
            aria-label="Close"
            onClick={close}
          >
            <XIcon />
          </button>
        </div>

        <div
          className="max-h-[min(60vh,480px)] min-h-0 overflow-auto rounded-[var(--radius-md)] bg-background"
          // Focusable, so the rows scroll from the keyboard too.
          tabIndex={0}
          role="region"
          aria-label="Sample rows"
        >
          <table className="table whitespace-nowrap">
            <thead>
              <tr>
                {header.map((name, i) => (
                  // A collapsed border stays with the table, so the stuck header draws its
                  // own rule.
                  <th
                    key={name}
                    className={`sticky top-0 border-b-0 bg-background px-3 shadow-[inset_0_-1px_0_var(--divider)] ${numeric[i] ? "text-right" : ""}`}
                  >
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((value, i) => (
                    <td key={i} className={`px-3 ${numeric[i] ? "text-right tabular-nums" : ""}`}>
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="dialog-actions m-0 flex-wrap">
          <button type="button" className="btn btn-secondary px-5 py-3" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary px-5 py-3"
            onClick={() => {
              close();
              onUse(sampleFile());
            }}
          >
            Use this data
          </button>
        </div>
      </dialog>
    </>
  );
}

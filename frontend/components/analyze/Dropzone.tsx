"use client";

import { useRef, useState } from "react";
import { UploadIcon } from "@/components/icons";

/** The upload screen's dashed target. Design section 6, "/analyze upload". */
export default function Dropzone({ onFile }: { onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFile(file);
  };

  return (
    <div className="card elev-md p-3">
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        aria-label="CSV file"
        className="hidden"
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files);
        }}
        className="flex w-full cursor-pointer flex-col items-center gap-3 rounded-[30px] border-2 border-dashed bg-accent-100 px-8 py-13 text-foreground"
        style={{
          borderColor: over
            ? "var(--accent)"
            : "color-mix(in srgb, var(--accent) 45%, transparent)",
        }}
      >
        <span className="inline-flex size-13 items-center justify-center rounded-pill bg-accent text-background">
          <UploadIcon size={26} />
        </span>
        <span className="font-heading text-[21px]">Drop a CSV here</span>
        <span className="text-small text-ink-faint">
          or click to browse · up to 5 MB and 100,000 rows
        </span>
      </button>
    </div>
  );
}

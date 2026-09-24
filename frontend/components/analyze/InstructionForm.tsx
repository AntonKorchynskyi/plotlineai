"use client";

import { useState } from "react";

/** The free-text box, used for both "describe it yourself" and "refine it". */
export const MAX_INSTRUCTION_LENGTH = 500;

export default function InstructionForm({
  placeholder,
  submitLabel,
  busy,
  onSubmit,
}: {
  placeholder: string;
  submitLabel: string;
  busy: boolean;
  onSubmit: (instruction: string) => void;
}) {
  const [value, setValue] = useState("");
  const instruction = value.trim();

  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!instruction || busy) return;
        onSubmit(instruction);
        setValue("");
      }}
    >
      <input
        className="input min-h-10 min-w-[220px] flex-1"
        placeholder={placeholder}
        aria-label={placeholder}
        maxLength={MAX_INSTRUCTION_LENGTH}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" className="btn btn-primary px-5 py-2" disabled={!instruction || busy}>
        {submitLabel}
      </button>
    </form>
  );
}

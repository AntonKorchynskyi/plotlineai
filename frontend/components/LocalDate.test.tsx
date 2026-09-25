import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LocalDate from "@/components/LocalDate";

describe("LocalDate", () => {
  it("prints the day in the reader's zone, with the instant in dateTime", () => {
    const iso = "2026-09-17T10:30:00Z";
    render(<LocalDate iso={iso} />);

    const expected = new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const time = screen.getByText(expected);
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("dateTime", iso);
  });
});

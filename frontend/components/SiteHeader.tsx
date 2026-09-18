import Link from "next/link";
import { BarChartIcon } from "@/components/icons";

/** The header every screen sits under. docs/design-system.md section 4, `.nav`. */
export default function SiteHeader() {
  return (
    <header className="nav mx-auto w-full max-w-landing px-6 pt-5 pb-1">
      <span className="nav-brand flex items-center gap-2">
        <span className="inline-flex size-6 items-center justify-center rounded-pill bg-accent text-background">
          <BarChartIcon />
        </span>
        PlotlineAI
      </span>
      <Link href="/">Home</Link>
      <Link href="/analyze">Analyze</Link>
    </header>
  );
}

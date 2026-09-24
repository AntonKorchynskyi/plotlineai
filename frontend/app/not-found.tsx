import Link from "next/link";
import PageShell from "@/components/PageShell";
import { AlertTriangleIcon } from "@/components/icons";

/** The 404 page. Reached by an unknown URL, and by a share id that does not exist. */
export default function NotFound() {
  return (
    <PageShell className="pt-20 pb-32">
      <div className="card elev-md gap-4 p-7">
        <span className="inline-flex size-12 items-center justify-center rounded-pill bg-accent-200 text-accent-700">
          <AlertTriangleIcon size={24} />
        </span>
        <h2 className="m-0 text-section">That page does not exist</h2>
        <p className="m-0 max-w-[46em] text-body text-ink-muted">
          The link may have been mistyped. Shared charts keep working after their dataset
          expires, so a link that once worked will not go stale.
        </p>
        <div className="mt-1 flex flex-wrap gap-2">
          <Link className="btn btn-primary px-5 py-3" href="/analyze">
            Make your own chart
          </Link>
          <Link className="btn btn-secondary px-5 py-3" href="/#gallery">
            Browse the examples
          </Link>
        </div>
      </div>
    </PageShell>
  );
}

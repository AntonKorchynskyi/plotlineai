import Link from "next/link";
import { notFound } from "next/navigation";
import ChartRenderer from "@/components/ChartRenderer";
import { fetchShare } from "@/lib/backend";

// Shares are read per request: the snapshot is immutable, but a link may be opened at any
// time and the api is the one holding it.
export const dynamic = "force-dynamic";

const shareDate = (createdAt: string) =>
  new Date(createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/** The read-only shared chart, rendered from the stored snapshot. */
export default async function SharePage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  const share = await fetchShare(shareId);

  // A share id that does not exist is a 404, not a 200 with an apology: app/not-found.tsx
  // carries the copy.
  if (!share) notFound();

  return (
    <main className="mx-auto w-full max-w-share px-6 pt-13 pb-30">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="tag tag-accent">Read only</span>
        <span className="font-mono text-small text-ink-faint">/s/{share.shareId}</span>
      </div>
      <h2 className="mb-1 text-page">{share.renderedData.title}</h2>
      <p className="mb-6 text-small text-ink-muted">
        Shared {shareDate(share.createdAt)} · a snapshot of the rendered numbers, so this link
        keeps working after the dataset expires.
      </p>

      <div className="card elev-md p-6">
        <ChartRenderer data={share.renderedData} height={380} />
      </div>

      <div className="card elev-sm mt-5 flex-row flex-wrap items-center gap-4 px-5 py-5">
        <span className="font-heading text-card">Got a CSV of your own?</span>
        <Link className="btn btn-primary ml-auto px-5 py-3" href="/analyze">
          Make your own chart
        </Link>
      </div>
    </main>
  );
}

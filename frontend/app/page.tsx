import Link from "next/link";
import PageShell from "@/components/PageShell";
import ChartRenderer from "@/components/ChartRenderer";
import { AlertTriangleIcon, ArrowRightIcon, DownloadIcon } from "@/components/icons";
import { chartTypeLabel, csvHref, getGallery, type GalleryExample } from "@/lib/gallery";

// The gallery is read per request. Rendering it at build time would bake in whatever the
// api returned during `docker build`, when it is not yet running.
export const dynamic = "force-dynamic";

const HERO_SLUG = "monthly-signups";

const FACTS = ["5 MB · 100k rows", "Files deleted within 2 days", "PNG export and share links"];

export default async function LandingPage() {
  const gallery = await getGallery();
  const hero = gallery?.find((e) => e.slug === HERO_SLUG) ?? gallery?.[0];

  return (
    <PageShell className="pt-11 pb-22">
      <section className="grid items-center gap-12 [grid-template-columns:repeat(auto-fit,minmax(min(360px,100%),1fr))]">
        <div>
          <h1 className="mb-4 max-w-[13em] text-hero">
            Hand it a spreadsheet. Get the chart you meant to make.
          </h1>
          <p className="mb-6 max-w-[34em] text-lg/relaxed text-ink-muted">
            Upload a CSV and an AI agent reads the column types, picks the three charts worth
            looking at, and explains why. The numbers are aggregated on the server against your
            whole file, so what you see is the real data, not a sample.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link className="btn btn-primary px-5 py-3 text-body" href="/analyze">
              Upload a CSV
              <ArrowRightIcon />
            </Link>
            <a className="btn btn-secondary px-5 py-3 text-body" href="#gallery">
              See six examples
            </a>
          </div>
          <div className="mt-8 flex flex-wrap gap-6 text-small text-ink-faint">
            {FACTS.map((fact) => (
              <span key={fact} className="whitespace-nowrap">
                {fact}
              </span>
            ))}
          </div>
        </div>

        <div className="relative">
          <div
            aria-hidden
            className="washed absolute -top-10 -right-8 size-52 rounded-pill bg-accent-2-200"
          />
          <div
            aria-hidden
            className="washed absolute -bottom-8 -left-9 size-27 rounded-pill bg-accent-200"
          />
          {hero ? (
            <div className="card elev-md relative p-5">
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="card-kicker">Rendered from {hero.slug}.csv</span>
                <span className="tag tag-neutral">{chartTypeLabel(hero)}</span>
              </div>
              <div className="card-title text-card">{hero.renderedData.title}</div>
              <ChartRenderer data={hero.renderedData} height={240} className="mt-2" />
            </div>
          ) : (
            <HeroFallback />
          )}
        </div>
      </section>

      <section id="gallery" className="mt-24 scroll-mt-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-6">
          <div>
            <h2 className="mb-2 text-page">Six charts, six CSVs</h2>
            <p className="m-0 text-body text-ink-muted">
              Every example below was rendered by the same pipeline your upload goes through.
              Take the CSV and try it yourself.
            </p>
          </div>
          <span className="tag tag-outline">GET /api/backend/gallery</span>
        </div>

        {gallery && gallery.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {gallery.map((example) => (
              <GalleryCard key={example.slug} example={example} />
            ))}
          </div>
        ) : (
          <GalleryUnavailable />
        )}
      </section>
    </PageShell>
  );
}

function GalleryCard({ example }: { example: GalleryExample }) {
  return (
    <article className="card elev-sm gap-3 p-5">
      <div className="rounded-well bg-background p-3">
        <ChartRenderer data={example.renderedData} height={240} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <h3 className="card-title">{example.title}</h3>
        <span className="tag tag-neutral">{chartTypeLabel(example)}</span>
      </div>
      <p className="card-body text-small">{example.description}</p>
      <div className="mt-px flex items-center">
        <a className="btn btn-ghost text-small" href={csvHref(example.csvPath)} download>
          <DownloadIcon />
          Download CSV
        </a>
      </div>
    </article>
  );
}

/** The hero without its chart: the api is unreachable, so nothing has been rendered. */
function HeroFallback() {
  return (
    <div className="card elev-md relative items-start gap-3 p-5">
      <span className="inline-flex size-8 items-center justify-center rounded-pill bg-accent-200 text-accent-800">
        <AlertTriangleIcon size={18} />
      </span>
      <div className="card-title text-card">Examples are offline</div>
      <p className="card-body text-small">
        The rendering service is not answering right now. Uploading your own CSV still works.
      </p>
    </div>
  );
}

function GalleryUnavailable() {
  return (
    <div className="card elev-sm max-w-[46em] items-start gap-3 p-5">
      <span className="inline-flex size-8 items-center justify-center rounded-pill bg-accent-200 text-accent-800">
        <AlertTriangleIcon size={18} />
      </span>
      <div className="card-title text-card">No examples to show</div>
      <p className="card-body text-small">
        The gallery could not be loaded. It will come back on its own once the rendering
        service is up; nothing on your side is wrong.
      </p>
      <Link className="btn btn-secondary text-small" href="/analyze">
        Upload a CSV instead
      </Link>
    </div>
  );
}

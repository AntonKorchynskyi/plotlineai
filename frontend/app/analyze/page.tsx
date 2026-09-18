import Link from "next/link";

/**
 * Placeholder. The designed upload flow (dropzone, suggestions, chart view) is phase 8;
 * this exists so the landing page's calls to action lead somewhere real in the meantime.
 */
export default function AnalyzePage() {
  return (
    <main className="mx-auto w-full max-w-upload px-6 pt-16 pb-28 text-center">
      <h2 className="mb-2 text-section">Not wired up yet</h2>
      <p className="mb-6 text-body text-ink-muted">
        Uploading your own CSV arrives with the analyze flow. The six worked examples on the
        landing page run through the same pipeline.
      </p>
      <Link className="btn btn-primary px-5 py-3 text-body" href="/#gallery">
        See the examples
      </Link>
    </main>
  );
}

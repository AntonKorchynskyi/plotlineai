/**
 * What the AI found in the whole file, as a numbered list: under the chart on the analyze
 * screen and on a share. It is page content beside the chart, so the PNG export (which draws
 * only the chart's canvas) never includes it.
 */
export default function InsightsCard({
  items,
  loading = false,
}: {
  items: string[];
  /** Still being written: a placeholder line instead of the list. */
  loading?: boolean;
}) {
  if (!loading && items.length === 0) return null;

  return (
    <section
      className="card elev-sm gap-3 px-5 py-5"
      aria-labelledby="insights-heading"
      aria-busy={loading}
    >
      <h3 id="insights-heading" className="m-0 font-heading text-[18px] font-normal">
        What stands out
      </h3>
      {loading ? (
        <p className="m-0 animate-pulse text-small text-ink-muted">Writing data insights…</p>
      ) : (
        // The numbers are a CSS counter, not text, so each item reads as just the insight.
        // role="list" because Safari drops a list's semantics along with its list-style.
        <ol role="list" className="m-0 flex list-none flex-col gap-3 p-0 [counter-reset:insight]">
          {items.map((item) => (
            <li
              key={item}
              className="flex items-start gap-3 text-body leading-relaxed [counter-increment:insight] before:mt-px before:inline-flex before:size-6 before:shrink-0 before:items-center before:justify-center before:rounded-pill before:bg-accent before:font-sans before:text-[12.5px] before:font-semibold before:leading-none before:text-background before:content-[counter(insight)]"
            >
              {item}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

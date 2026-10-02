/**
 * Every page sits in this. One gutter, no width cap, so screens use the width they are given
 * rather than framing a narrow column in empty margins. The header uses the same gutter, so
 * page content lines up with the brand.
 *
 * Reading width is handled per block (a paragraph caps its own line length), never by
 * squeezing the whole page.
 *
 * Decorations may bleed into the gutter, but never past the screen edge: overflow-x-clip
 * stops them widening the page on a phone without making main a scroll container.
 */
export default function PageShell({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <main className={`w-full overflow-x-clip px-6 lg:px-12 ${className}`}>{children}</main>;
}

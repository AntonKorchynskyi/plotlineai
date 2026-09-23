/**
 * Every page sits in this. One gutter, no width cap, so screens use the width they are given
 * rather than framing a narrow column in empty margins. The header uses the same gutter, so
 * page content lines up with the brand.
 *
 * Reading width is handled per block (a paragraph caps its own line length), never by
 * squeezing the whole page.
 */
export default function PageShell({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <main className={`w-full px-6 lg:px-12 ${className}`}>{children}</main>;
}

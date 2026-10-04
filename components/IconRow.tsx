import Link from "next/link";
import type { Rect } from "./stipple/stipple";
import { ICON_LINKS } from "./links";

/**
 * The icons themselves are drawn in dots by the stipple canvas; these are the
 * links laid over them, invisible apart from the focus ring. Until the canvas
 * has laid them out they stay in the document, visually hidden.
 */
export default function IconRow({ rects, onHover }: { rects: Rect[]; onHover?: (index: number | null) => void }) {
  const placed = rects.length === ICON_LINKS.length;
  return (
    <nav aria-label="Elsewhere">
      <ul>
        {ICON_LINKS.map(({ id, label, href }, i) => {
          const r = rects[i];
          // Pad the hit area a little past the drawn icon.
          const pad = placed ? r.width * 0.18 : 0;
          const style = placed
            ? { left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 }
            : undefined;
          // Hover and keyboard focus both swell the stippled icon underneath.
          const events = {
            onPointerEnter: () => onHover?.(i),
            onPointerLeave: () => onHover?.(null),
            onFocus: () => onHover?.(i),
            onBlur: () => onHover?.(null),
          };
          const className = placed
            ? "fixed z-10 rounded-full outline-none focus-visible:ring-1 focus-visible:ring-ink/60"
            : "sr-only";
          return (
            <li key={id}>
              {href.startsWith("/") ? (
                <Link href={href} aria-label={label} title={label} className={className} style={style} {...events} />
              ) : (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  title={label}
                  className={className}
                  style={style}
                  {...events}
                />
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

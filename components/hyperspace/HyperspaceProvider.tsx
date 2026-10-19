"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, use, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { Hyperspace } from "./starfield";

/** How to navigate, as on next/link. */
export interface JumpOptions {
  replace?: boolean;
  scroll?: boolean;
  transitionTypes?: string[];
}

interface HyperspaceApi {
  /**
   * Jumps to a page on this site, navigating under cover of the effect.
   * Returns true if it took the navigation over (or one is already under
   * way, which swallows this one); false to let it happen as usual.
   */
  jump(href: string, options?: JumpOptions): boolean;
}

// Outside the provider, links just navigate.
const HyperspaceContext = createContext<HyperspaceApi>({ jump: () => false });

export function useHyperspace(): HyperspaceApi {
  return use(HyperspaceContext);
}

/**
 * Owns the page-transition overlay. Lives in the root layout so it outlasts
 * the pages it moves between: the old page's dots launch from its canvas,
 * the route changes behind it, and it drops out over the new page.
 */
export default function HyperspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Hyperspace | null>(null);
  // The committed path, as of the commit's effects: by then the old page has let go of its dots.
  const pathRef = useRef(pathname);
  // The path a jump left whose route was still loading when the jump gave up on it.
  const lateRef = useRef<string | null>(null);

  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  // That late route committing now: cover it before it paints.
  useLayoutEffect(() => {
    const from = lateRef.current;
    if (from === null || pathname === from) return;
    lateRef.current = null;
    engineRef.current?.land({ navigate: () => {}, path: () => pathRef.current });
  }, [pathname]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const engine = new Hyperspace(host);
    engineRef.current = engine;
    // Back/forward takes the visitor elsewhere: whatever was loading no longer matters.
    const forget = () => {
      lateRef.current = null;
    };
    window.addEventListener("popstate", forget);
    return () => {
      window.removeEventListener("popstate", forget);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const api = useMemo<HyperspaceApi>(
    () => ({
      jump(href, { replace, scroll, transitionTypes } = {}) {
        const engine = engineRef.current;
        if (!engine) return false;
        if (engine.busy) return true;
        let url: URL;
        try {
          url = new URL(href, window.location.href);
        } catch {
          return false;
        }
        const from = pathRef.current;
        // Elsewhere, or only a hash or query away on the same page: no jump.
        if (url.origin !== window.location.origin || url.pathname === from) return false;
        const to = url.pathname + url.search + url.hash;
        const options: NonNullable<Parameters<typeof router.push>[1]> = {};
        if (scroll !== undefined) options.scroll = scroll;
        if (transitionTypes) options.transitionTypes = transitionTypes;
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const started = engine.start(
          {
            navigate: () => (replace ? router.replace(to, options) : router.push(to, options)),
            // Landed once this moves: on the target, or wherever a back/forward took us.
            path: () => pathRef.current,
            // Still loading when the jump gave up: cover it when it does land.
            abandoned: () => {
              lateRef.current = from;
            },
          },
          reduced,
        );
        if (started) {
          // A newer jump supersedes a late one.
          lateRef.current = null;
          router.prefetch(to);
        }
        return started;
      },
    }),
    [router],
  );

  return (
    <HyperspaceContext value={api}>
      {children}
      {/* The overlay's canvas goes in here (made by the engine, so each one gets a fresh canvas to hand to its worker). */}
      <div ref={hostRef} />
    </HyperspaceContext>
  );
}

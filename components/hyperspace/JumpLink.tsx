"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { useHyperspace } from "./HyperspaceProvider";

type JumpLinkProps = Omit<ComponentProps<typeof Link>, "href" | "onNavigate"> & { href: string };

/**
 * A link to another page of the site that gets there by hyperspace. Only
 * plain in-app navigations jump: modified and middle clicks, new tabs and
 * downloads stay the browser's (next/link never calls onNavigate for them).
 * `replace`, `scroll` and `transitionTypes` carry over to the jump's navigation.
 */
export default function JumpLink({ href, replace, scroll, transitionTypes, ...props }: JumpLinkProps) {
  const { jump } = useHyperspace();
  return (
    <Link
      href={href}
      replace={replace}
      scroll={scroll}
      transitionTypes={transitionTypes}
      {...props}
      onNavigate={(event) => {
        if (jump(href, { replace, scroll, transitionTypes })) event.preventDefault();
      }}
    />
  );
}

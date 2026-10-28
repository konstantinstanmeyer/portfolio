"use client";

// Runs while the HTML is parsed, before first paint: arm the load sweep once
// per session by setting data-play on the page root. Without JavaScript, under
// reduced motion, or on a repeat visit, the staff is simply already written.
// On the client the tag renders as text/plain, so it never runs twice and React
// never warns about it (the pattern from Next's "preventing flash" guide).
const PLAY_ONCE = `try{var r=document.currentScript.parentNode;if(matchMedia("(prefers-reduced-motion: no-preference)").matches&&!sessionStorage.getItem("ks-strings")){sessionStorage.setItem("ks-strings","1");r.setAttribute("data-play","")}}catch(e){}`;

export function PlayOnce() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: PLAY_ONCE }}
    />
  );
}

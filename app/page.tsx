import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import Image from "next/image";
import { Fragment_Mono, Inter } from "next/font/google";
import portrait from "@/public/konstantin-portrait.webp";
import { PHOTOGRAPHS } from "@/app/photographs";
import { Coincidence } from "@/components/focus/Coincidence";
import { Contact } from "@/components/focus/Contact";
import { Ground } from "@/components/focus/Ground";
import { MessageForm } from "@/components/focus/MessageForm";
import { Parallax } from "@/components/focus/Parallax";
import { Space } from "@/components/focus/Space";
import { Spill } from "@/components/focus/Spill";
import s from "@/components/focus/focus.module.css";

const inter = Inter({
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
  variable: "--f-sans",
});

const mono = Fragment_Mono({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--f-mono",
});

export const metadata: Metadata = {
  title: "Konstantin Stanmeyer",
  description: "Building and designing at Myrtle Street Media. Developer and photographer in Boston.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#100f0d" },
  ],
  colorScheme: "light dark",
};

const NAME = "Konstantin Stanmeyer";
const LINE = "Building and designing at Myrtle Street Media.";

// Elsewhere, in the footer: the bio itself carries no links.
const LINKS = [
  { href: "https://www.myrtlestreetmedia.com", label: "Myrtle Street Media" },
  { href: "https://www.linkedin.com/in/konstantin-stanmeyer/", label: "LinkedIn" },
];

// Twenty frames for the sheet, five by four: the ones that still read when small.
const PICKS = [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 17, 18, 20, 22, 25, 27];
const FRAMES = PICKS.map((i) => PHOTOGRAPHS[i]);

// The sheet in miniature, by the line: each frame as its tone, five across.
// Two are too dark to read as frames at that size, so they are lifted: the
// black and white one to a slightly lighter grey, and the market to the
// maroon of its red umbrellas.
const LIFTED: Record<number, string> = { 7: "#3e3e3e", 17: "#672f39" };
const INDEX = PICKS.map((i) => LIFTED[i] ?? PHOTOGRAPHS[i].tone);

// When each cell of the miniature appears on load, in ms, by its place on the
// sheet. The order is fixed but reads as shuffled: no cell follows a
// neighbour, none follow in a line, no row or column fills ahead of the rest,
// and the intervals between them are uneven.
const REVEAL = [555, 265, 480, 750, 365, 435, 780, 850, 605, 250, 640, 540, 300, 400, 825, 315, 455, 695, 200, 520];

// The loading placeholder: a flat tone (ink at 6% into paper) that follows the
// colour scheme, in place of a blurred preview.
const TONE: `data:image/${string}` = `data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg'><style>rect{fill:#ebeae8}@media(prefers-color-scheme:dark){rect{fill:#1a1917}}</style><rect width='100%' height='100%'/></svg>",
)}`;

export default function Home() {
  return (
    <div className={`${s.root} ${inter.variable} ${mono.variable}`} data-draft="focus">
      <a className={s.skip} href="#photography">
        Skip to photographs
      </a>

      <div className={s.frame}>
        <main id="top">
          {/* The opening frame: the subject on the focus line, the About as its caption. */}
          <div className={s.opening}>
            {/* --portrait, the photograph's height over its width, sets where the hero sits. */}
            <header
              className={`${s.grid} ${s.hero}`}
              style={{ "--portrait": (portrait.height / portrait.width).toFixed(4) } as CSSProperties}
            >
              <div className={s.portrait} data-plane="" data-rest="">
                <Image
                  src={portrait}
                  alt="Konstantin Stanmeyer in low light, a band of warm sunlight falling across one eye."
                  loading="eager"
                  fetchPriority="high"
                  placeholder={TONE}
                  sizes="(min-width: 1440px) 216px, (min-width: 960px) calc(14.4vw - 20px), clamp(144px, 42vw, 216px)"
                />
              </div>
              <div className={s.intro} data-plane="" data-rest="">
                {/* data-text is each line's echo: the second image that shrinks onto it on load. */}
                <h1 className={s.name} data-text={NAME}>
                  {NAME}
                </h1>
                <p className={s.line} data-text={LINE}>
                  {LINE}
                </p>
                {/* What the photographs are, said once and quietly, beside the sheet in
                    miniature (INDEX). */}
                <p className={s.note}>
                  <span className={s.index} aria-hidden="true">
                    {INDEX.map((tone, i) => (
                      <i key={i} style={{ background: tone, "--at": `${REVEAL[i]}ms` } as CSSProperties} />
                    ))}
                  </span>
                  Photography from the off-hours
                </p>
              </div>
            </header>

            {/* No visible heading: the sections name themselves. Screen readers still get one. */}
            <section className={`${s.grid} ${s.about}`} aria-labelledby="about-heading">
              <h2 className={s.vh} id="about-heading">
                About
              </h2>
              {/* Placeholder until the bio is final; the last one is kept in drafts/bio.md. */}
              <div className={s.text} data-plane="">
                <p>
                  Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore
                  et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut
                  aliquip ex ea commodo consequat.
                </p>
                <p>
                  Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla
                  pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit
                  anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium,
                  totam rem aperiam.
                </p>
                <p>
                  Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur
                  magni dolores eos qui ratione voluptatem sequi nesciunt.
                </p>
              </div>
            </section>
          </div>

          <section className={`${s.grid} ${s.photography}`} id="photography" aria-labelledby="photography-heading">
            <h2 className={s.vh} id="photography-heading">
              Photography
            </h2>
            <Contact frames={FRAMES} />
          </section>

          {/* The page's last word, at the scale of its first. */}
          {/* One plane, so the question and the form come into focus together. */}
          <section className={`${s.grid} ${s.write}`} id="contact" aria-labelledby="contact-heading" data-plane="">
            <h2 className={s.ask} id="contact-heading" data-focus="">
              Tell me what you&rsquo;re working on, <span className={s.aside}>or thinking about.</span>
            </h2>
            <div className={s.letter}>
              <MessageForm />
            </div>
          </section>
        </main>

        <footer className={`${s.grid} ${s.footer}`}>
          {/* data-column: the type's column, edge to edge, which the ground's figures stand a gutter clear of. */}
          <div className={s.links} data-focus="" data-plane="" data-column="">
            <span className={s.elsewhere}>
              {LINKS.map(({ href, label }) => (
                <a key={href} href={href}>
                  {label}
                </a>
              ))}
            </span>
            <a href="#top">Back to top</a>
          </div>
        </footer>
      </div>

      <Coincidence />
      <Parallax />
      <Space />
      <Ground />
      <Spill tones={FRAMES.map((f) => f.tone)} />
    </div>
  );
}

import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import Image from "next/image";
import { Fragment_Mono, Inter } from "next/font/google";
import portrait from "@/public/KonstantinPortrait.webp";
import { PHOTOGRAPHS } from "@/app/photographs";
import { Coincidence } from "@/components/focus/Coincidence";
import { Contact } from "@/components/focus/Contact";
import { MessageForm } from "@/components/focus/MessageForm";
import { Parallax } from "@/components/focus/Parallax";
import { Space } from "@/components/focus/Space";
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
  description: "Founder and head of marketing at Myrtle Street Media. Developer and photographer in Boston.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#100f0d" },
  ],
  colorScheme: "light dark",
};

const NAME = "Konstantin Stanmeyer";
const LINE = "Founder and head of marketing at Myrtle Street Media.";

// Elsewhere, in the footer: the bio itself carries no links.
const LINKS = [
  { href: "https://www.myrtlestreetmedia.com", label: "Myrtle Street Media" },
  { href: "https://www.linkedin.com/in/konstantin-stanmeyer/", label: "LinkedIn" },
];

// Twenty frames for the sheet, five by four: the ones that still read when small.
const FRAMES = [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 17, 18, 20, 22, 25, 27].map((i) => PHOTOGRAPHS[i]);

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
              <div className={s.portrait} data-plane="">
                <Image
                  src={portrait}
                  alt="Konstantin Stanmeyer in low light, a band of warm sunlight falling across one eye."
                  loading="eager"
                  fetchPriority="high"
                  placeholder={TONE}
                  sizes="(min-width: 1440px) 216px, (min-width: 960px) calc(14.4vw - 20px), clamp(144px, 42vw, 216px)"
                />
              </div>
              <div className={s.intro} data-plane="">
                {/* data-text is each line's echo: the second image that shrinks onto it on load. */}
                <h1 className={s.name} data-text={NAME}>
                  {NAME}
                </h1>
                <p className={s.line} data-text={LINE}>
                  {LINE}
                </p>
              </div>
            </header>

            {/* No visible heading: the sections name themselves. Screen readers still get one. */}
            <section className={`${s.grid} ${s.about}`} aria-labelledby="about-heading">
              <h2 className={s.vh} id="about-heading">
                About
              </h2>
              <div className={s.text} data-plane="">
                <p>
                  I build for people I believe in, and I keep the work within their reach: fairly priced, simple to
                  run, usable by anyone. At Myrtle Street Media that means websites for local businesses, and making
                  sure people find them.
                </p>
                <p>
                  There have never been more good tools to build with, and they keep getting cheaper. Clients should
                  see that in what they pay and in how much we can do for them. All of this should be getting easier,
                  not more expensive and more tangled.
                </p>
                <p>I&rsquo;m a developer in Boston. Before I wrote any code, I was taking photographs.</p>
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
              Tell me what you&rsquo;re working on.
            </h2>
            <div className={s.letter}>
              <MessageForm />
            </div>
          </section>
        </main>

        <footer className={`${s.grid} ${s.footer}`}>
          <div className={s.links} data-focus="" data-plane="">
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
    </div>
  );
}

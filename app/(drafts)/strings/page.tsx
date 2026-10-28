import type { Metadata, Viewport } from "next";
import Image from "next/image";
import { DM_Mono, Familjen_Grotesk } from "next/font/google";
import portrait from "@/images/portrait.jpg";
import { PHOTOGRAPHS } from "@/app/photographs";
import { PlayOnce } from "./PlayOnce";
import { Strum } from "./Strum";
import s from "./strings.module.css";

// Six Strings: the page is set like guitar tab. Type sits on 1px strings and
// breaks them, the way a fret number does; on the first visit of a session a
// playhead transcribes the name and line onto the staff.

const mono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--ks-mono",
  display: "swap",
});

const sans = Familjen_Grotesk({
  subsets: ["latin"],
  variable: "--ks-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Konstantin Stanmeyer",
  description: "Photographer and developer in Boston.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f3f1" },
    { media: "(prefers-color-scheme: dark)", color: "#100f0d" },
  ],
  colorScheme: "light dark",
};

const LINKS = {
  studio: "https://www.myrtlestreetmedia.com",
  intabulate: "https://intabulate.com",
  github: "https://github.com/konstantinstanmeyer",
  linkedin: "https://www.linkedin.com/in/konstantin-stanmeyer/",
};

const TUNING = ["e", "B", "G", "D", "A", "E"];

/** One string's worth of line, drawn with a border so it survives forced colours. */
function Seg({ draw, className }: { draw?: boolean; className?: string }) {
  return <span className={className ? `${s.seg} ${className}` : s.seg} data-seg="" data-draw={draw ? "" : undefined} aria-hidden />;
}

export default function StringsPage() {
  return (
    <div className={`${s.root} ${mono.variable} ${sans.variable}`} data-draft="strings" suppressHydrationWarning>
      <PlayOnce />
      <a className={s.skip} href="#photography">
        Skip to photographs
      </a>

      <div className={s.page}>
        <header className={s.head}>
          <div className={s.staff} data-staff="">
            <div className={s.tuning} aria-hidden>
              {TUNING.map((t, i) => (
                <span key={i}>{t}</span>
              ))}
            </div>

            {/* Blank strings: only shown ahead of the playhead during the sweep. */}
            <div className={s.blank} aria-hidden>
              {TUNING.map((_, i) => (
                <Seg key={i} />
              ))}
            </div>

            {/* The score: name and line written onto strings 2–5, in reading order. */}
            <div className={s.score}>
              <span className={`${s.row} ${s.r1}`} data-string="" aria-hidden>
                <Seg />
              </span>
              <h1 className={`${s.row} ${s.note} ${s.n1}`} data-string="">
                <Seg className={s.lead} />
                <span className={s.word}>Konstantin Stanmeyer</span>
                <Seg />
              </h1>
              <p className={s.line}>
                <span className={`${s.row} ${s.note} ${s.n2}`} data-string="">
                  <Seg className={s.lead} />
                  <span className={s.word}>Photographer</span>
                  <Seg />
                </span>{" "}
                <span className={`${s.row} ${s.note} ${s.n3}`} data-string="">
                  <Seg className={s.lead} />
                  <span className={s.word}>and developer</span>
                  <Seg />
                </span>{" "}
                <span className={`${s.row} ${s.note} ${s.n4}`} data-string="">
                  <Seg className={s.lead} />
                  <span className={s.word}>in Boston.</span>
                  <Seg />
                </span>
              </p>
              <span className={`${s.row} ${s.r6}`} data-string="" aria-hidden>
                <Seg />
              </span>
            </div>

            <span className={s.barOpen} aria-hidden />
            <span className={s.barEnd} aria-hidden />
            <span className={s.track} aria-hidden>
              <span className={s.playhead} />
            </span>
          </div>
        </header>

        <main className={s.main}>
          <section className={s.about} id="about" aria-labelledby="about-label">
            <div className={s.str} data-string="">
              <h2 className={s.label} id="about-label">
                About
              </h2>
              <Seg draw />
            </div>
            <Image
              src={portrait}
              alt="Konstantin Stanmeyer raising a camera to his eye."
              loading="eager"
              fetchPriority="high"
              sizes="(min-width: 1696px) 247px, (min-width: 1024px) calc(16.67vw - 36px), (min-width: 640px) calc(25vw - 28px), calc(50vw - 30px)"
              className={`${s.img} ${s.portrait}`}
            />
            <p className={s.text}>
              I&rsquo;m Konstantin, a freelance developer who designs and builds applications and sites that just
              work, for businesses and for my own interests. Before I wrote my first line of code, I was{" "}
              <a href="#photography">composing frames</a>. These days I run <a href={LINKS.studio}>Myrtle Street Media</a>
              , a studio for local search and websites, and I&rsquo;m building <a href={LINKS.intabulate}>Intabulate</a>,
              which turns guitar audio into tab. Find me on <a href={LINKS.github}>GitHub</a> or{" "}
              <a href={LINKS.linkedin}>LinkedIn</a>.
            </p>
          </section>

          <section className={s.photos} id="photography" aria-labelledby="photography-label">
            <div className={s.str} data-string="">
              <h2 className={s.label} id="photography-label">
                Photography
              </h2>
              <Seg draw />
              <span className={s.count} aria-hidden>
                {PHOTOGRAPHS.length}
              </span>
            </div>
            <ol className={s.plates}>
              {PHOTOGRAPHS.map(({ src, alt }, i) => (
                <li key={src.src} className={i === 0 ? `${s.plate} ${s.wide}` : s.plate}>
                  <div className={s.str} data-string="" aria-hidden>
                    <span className={s.num}>{i + 1}</span>
                    <Seg draw />
                  </div>
                  <Image
                    src={src}
                    alt={alt}
                    loading="lazy"
                    sizes={
                      i === 0
                        ? "(min-width: 1696px) 1600px, (min-width: 1024px) calc(100vw - 96px), (min-width: 640px) calc(100vw - 64px), calc(100vw - 48px)"
                        : "(min-width: 1696px) 788px, (min-width: 1024px) calc(50vw - 60px), (min-width: 640px) calc(50vw - 40px), calc(100vw - 48px)"
                    }
                    className={s.img}
                  />
                </li>
              ))}
            </ol>
          </section>
        </main>

        <footer className={s.foot} data-string="" aria-hidden>
          <Seg draw />
          <span className={s.fin} />
        </footer>
      </div>

      <Strum />
    </div>
  );
}

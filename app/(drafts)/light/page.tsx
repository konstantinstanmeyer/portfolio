import type { Metadata, Viewport } from "next";
import Image from "next/image";
import { Azeret_Mono, Hanken_Grotesk } from "next/font/google";
import portrait from "@/images/portrait.jpg";
import { PHOTOGRAPHS } from "@/app/photographs";
import { sunkit } from "./sun";
import { LiveClause, LiveSignoff } from "./live";
import s from "./light.module.css";

const sans = Hanken_Grotesk({ subsets: ["latin"], variable: "--kl-sans", display: "swap" });
const mono = Azeret_Mono({ subsets: ["latin"], variable: "--kl-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Konstantin Stanmeyer",
  description: "Photographer and developer in Boston.",
};

// Static fallbacks; the pre-paint script prepends a live theme-color equal to the lit ground.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fbfe" },
    { media: "(prefers-color-scheme: dark)", color: "#100f0d" },
  ],
};

// Runs before first paint: compute Boston's sun and light the ground, so there is no flash.
const BOOT = `try{(${sunkit.toString()})().boot()}catch(e){}`;

const LINKS = {
  studio: "https://www.myrtlestreetmedia.com",
  intabulate: "https://intabulate.com",
  github: "https://github.com/konstantinstanmeyer",
  linkedin: "https://www.linkedin.com/in/konstantin-stanmeyer/",
};

const pad = (n: number) => String(n).padStart(2, "0");

export default function BostonLight() {
  return (
    <div className={`${s.root} ${sans.variable} ${mono.variable}`} data-draft="light" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: BOOT }} />
      <a href="#photography" className={s.skip}>
        Skip to photographs
      </a>

      <div className={s.page}>
        <header className={s.head}>
          <h1 className={s.name}>Konstantin Stanmeyer</h1>
          <p className={s.line}>
            Photographer and developer in Boston
            <LiveClause />
          </p>
        </header>

        <main className={s.main}>
          <section className={s.about} aria-labelledby="about-heading">
            <h2 id="about-heading" className={s.hidden}>
              About
            </h2>
            <div className={s.portrait}>
              <Image
                src={portrait}
                alt="Konstantin Stanmeyer raising a small silver camera to his eye."
                loading="eager"
                fetchPriority="high"
                sizes="(max-width: 767px) 168px, 220px"
              />
            </div>
            <p className={s.bio}>
              I&rsquo;m Konstantin, a freelance developer who designs and builds applications and sites that just work, for
              businesses and for my own interests. Before I wrote my first line of code, I was{" "}
              <a href="#photography">composing frames</a>. These days I run <a href={LINKS.studio}>Myrtle Street Media</a>,
              a studio for local search and websites, and I&rsquo;m building <a href={LINKS.intabulate}>Intabulate</a>,
              which turns guitar audio into tab. Find me on <a href={LINKS.github}>GitHub</a> or{" "}
              <a href={LINKS.linkedin}>LinkedIn</a>.
            </p>
          </section>

          <section id="photography" className={s.photography} aria-labelledby="photography-heading">
            <h2 id="photography-heading" className={s.hidden}>
              Photography
            </h2>
            <ol className={s.photos}>
              {PHOTOGRAPHS.map(({ src, alt }, i) => (
                <li key={src.src} className={s.photo}>
                  <span className={s.index} aria-hidden="true">
                    {pad(i + 1)}
                  </span>
                  <Image
                    src={src}
                    alt={alt}
                    loading={i === 0 ? "eager" : "lazy"}
                    sizes="(max-width: 767px) calc(100vw - 40px), (max-width: 1679px) calc(75vw - 66px), 1194px"
                    style={{ "--r": (src.width / src.height).toFixed(4) } as React.CSSProperties}
                  />
                </li>
              ))}
            </ol>
          </section>
        </main>

        <footer className={s.foot}>
          <p className={s.place}>42.36° N, 71.06° W</p>
          <p className={s.signoff}>
            <LiveSignoff />
          </p>
        </footer>
      </div>
    </div>
  );
}

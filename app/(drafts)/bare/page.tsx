import Image from "next/image";
import portrait from "@/public/KonstantinPortrait.webp";
import { PHOTOGRAPHS } from "@/app/photographs";

const link =
  "underline decoration-neutral-500 underline-offset-[0.2em] transition-[text-decoration-color] hover:decoration-current";

const LINKS = {
  studio: "https://www.myrtlestreetmedia.com",
  intabulate: "https://intabulate.com",
  github: "https://github.com/konstantinstanmeyer",
  linkedin: "https://www.linkedin.com/in/konstantin-stanmeyer/",
};

// The bare one-pager this site briefly was (2026-10-27), kept as a draft.
export default function Bare() {
  return (
    <main className="mx-auto max-w-[73rem] px-5 pt-12 pb-24 sm:px-10 sm:pt-20">
      <header>
        <Image
          src={portrait}
          alt="Konstantin Stanmeyer in low light, a band of warm sunlight falling across one eye."
          placeholder="blur"
          loading="eager"
          fetchPriority="high"
          sizes="(min-width: 360px) 320px, calc(100vw - 40px)"
          className="h-auto w-full max-w-80"
        />
        <h1 className="mt-8 font-medium">Konstantin Stanmeyer</h1>
        <p className="text-neutral-500 dark:text-neutral-400">Photographer and developer in Boston.</p>
        <nav aria-label="Sections" className="mt-6 flex gap-5">
          <a href="#about" className={link}>
            About
          </a>
          <a href="#photography" className={link}>
            Photography
          </a>
        </nav>
      </header>

      <section id="about" aria-labelledby="about-heading" className="mt-24 scroll-mt-12">
        <h2 id="about-heading" className="font-medium">
          About
        </h2>
        <p className="mt-4 max-w-[60ch] leading-relaxed text-pretty">
          I&rsquo;m Konstantin, a freelance developer who designs and builds applications and sites that just work,
          for businesses and for my own interests. Before I wrote my first line of code, I was{" "}
          <a href="#photography" className={link}>
            composing frames
          </a>
          . These days I run{" "}
          <a href={LINKS.studio} className={link}>
            Myrtle Street Media
          </a>
          , a studio for local search and websites, and I&rsquo;m building{" "}
          <a href={LINKS.intabulate} className={link}>
            Intabulate
          </a>
          , which turns guitar audio into tab. Find me on{" "}
          <a href={LINKS.github} className={link}>
            GitHub
          </a>{" "}
          or{" "}
          <a href={LINKS.linkedin} className={link}>
            LinkedIn
          </a>
          .
        </p>
      </section>

      <section id="photography" aria-labelledby="photography-heading" className="mt-24 scroll-mt-12">
        <h2 id="photography-heading" className="font-medium">
          Photography
        </h2>
        {/* Two columns from tablet width; the first photograph, and a last one left alone in its row, span both. */}
        <div className="mt-6 grid items-start gap-4 md:grid-cols-2 md:[&>*:first-child]:col-span-2 md:[&>*:last-child:nth-child(even)]:col-span-2">
          {PHOTOGRAPHS.map(({ src, alt }, i) => (
            <Image
              key={src.src}
              src={src}
              alt={alt}
              placeholder="blur"
              // The first photograph can be the largest thing on screen on tall displays.
              loading={i === 0 ? "eager" : "lazy"}
              sizes={
                i === 0 || (i === PHOTOGRAPHS.length - 1 && i % 2 === 1)
                  ? "(min-width: 1168px) 1088px, (min-width: 640px) calc(100vw - 80px), calc(100vw - 40px)"
                  : "(min-width: 1168px) 536px, (min-width: 768px) calc(50vw - 48px), (min-width: 640px) calc(100vw - 80px), calc(100vw - 40px)"
              }
              className="h-auto w-full"
            />
          ))}
        </div>
      </section>
    </main>
  );
}

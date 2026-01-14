import Image from 'next/image'
import { FadeIn } from '@/components/FadeIn'
import PhotoGallery from '@/components/PhotoGallery'

const GEAR = [
  { category: 'Digital Camera Body', name: 'Fujifilm XS-10' },
  { category: 'Primary Lens', name: '23mm f/1.4 R LM WR' },
  { category: 'Zoom', name: '16-80mm f/4 R OIS WR' },
  { category: 'Film Camera', name: '1963 Rollei 35' },
]

export default function PhotographyPage() {
  return (
    <div className="bg-[#0a0a0a]">
      <section className="min-h-screen grid grid-cols-1 lg:grid-cols-2">
        <div className="flex flex-col justify-center px-8 lg:px-16 pt-40 pb-12 lg:pt-0 lg:pb-0 z-10">
          <FadeIn>
            <div className="section-label">
              <span className="section-label-line" />
              <span className="section-label-text">Visual Stories</span>
            </div>
          </FadeIn>
          <FadeIn delay={0.1}>
            <h1 className="font-display text-5xl md:text-6xl lg:text-7xl font-normal text-[--color-text-primary] leading-none mb-6">
              Through<br/>the Lens
            </h1>
          </FadeIn>
          <FadeIn delay={0.2}>
            <p className="text-[--color-text-secondary] leading-relaxed max-w-[400px]">
              Capturing moments that speak. Photography has always been my first creative language—a 
              way of seeing the world that influences everything I design and build.
            </p>
          </FadeIn>
        </div>

        <div className="relative h-[50vh] lg:h-auto overflow-hidden">
          <Image
            src="/photos/photo-21.jpg"
            alt="Featured photography"
            fill
            className="object-cover scale-100"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0a0a0a] to-[rgb(0,0,0,0.1)] lg:block hidden" />
          <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0a] to-[rgb(0,0,0,0.1)] lg:hidden" />
        </div>
      </section>

      <PhotoGallery />

      <section className="py-24 bg-gradient-to-b from-transparent via-[rgba(201,162,39,0.02)] to-transparent">
        <div className="max-w-[1100px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <FadeIn>
              <h2 className="font-display text-4xl font-normal text-[--color-text-primary] mb-6">
                On Seeing
              </h2>
              <blockquote className="font-accent text-2xl italic text-[--color-text-primary] leading-relaxed mb-3">
                "Photography is a way of feeling, of touching, of loving. What you have caught on film is captured forever..."
              </blockquote>
              <cite className="text-[--color-accent] text-sm not-italic block mb-6">
                — Aaron Siskind
              </cite>
              <p className="text-[--color-text-secondary] leading-relaxed mb-4">
                For me, photography has never been about the gear or the technical perfection. It's about 
                that split second when light, emotion, and composition align into something that resonates. 
                The same principles guide my approach to design: every interface is a composition, every 
                interaction a moment to be captured.
              </p>
              <p className="text-[--color-text-secondary] leading-relaxed">
                I learned patience behind the viewfinder—waiting for the right moment rather than forcing it. 
                That patience translates directly to how I approach problem-solving in development: taking time 
                to understand the challenge before rushing to code.
              </p>
            </FadeIn>

            <FadeIn delay={0.2}>
              <div className="relative rounded-lg overflow-hidden">
                <div className="absolute -inset-4 border border-[--color-accent] opacity-20 rounded-xl -z-10" />
                <Image
                  src="/photos/essay-image.jpg"
                  alt="Behind the scenes"
                  width={600}
                  height={400}
                  className="w-full h-auto grayscale-[20%] hover:grayscale-0 transition-all duration-500"
                />
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      <section className="max-w-[1100px] mx-auto px-6 py-16">
        <FadeIn>
          <div className="text-center mb-10">
            <h2 className="font-display text-3xl font-normal text-[--color-text-primary] mb-2">
              Gear
            </h2>
            <p className="font-accent text-lg italic text-[--color-text-secondary]">
              The tools I use to capture these moments
            </p>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {GEAR.map((item) => (
              <div
                key={item.name}
                className="text-center p-6 bg-[rgba(255,255,255,0.02)] rounded-lg border border-[rgba(138,138,133,0.1)] hover:border-[--color-accent] hover:-translate-y-1 transition-all duration-200"
              >
                <span className="text-xs tracking-wider uppercase text-[--color-text-secondary] block mb-2">
                  {item.category}
                </span>
                <span className="font-display text-lg text-[--color-text-primary]">
                  {item.name}
                </span>
              </div>
            ))}
          </div>
        </FadeIn>
      </section>
    </div>
  )
}

import Image from 'next/image'
import Link from 'next/link'
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/FadeIn'
import { SocialLinks } from '@/components/SocialLinks'
import { SkillIcon } from '@/components/SkillIcon'
import { featuredProjects } from '@/lib/projects'
import { PhotoCarousel } from '@/components/PhotoCarousel'

const skills = [
  { name: 'React', icon: '/react.png' },
  { name: 'JavaScript', icon: '/javascript.png' },
  { name: 'TypeScript', icon: '/typescript.png' },
  { name: 'Node.js', icon: '/nodejs.png' },
  { name: 'Next.js', icon: '/nextjs.png' },
  { name: 'Redux', icon: '/redux.png' },
  { name: 'PostgreSQL', icon: '/postgresql.png' },
  { name: 'Rails', icon: '/rails.png' },
  { name: 'AWS', icon: '/aws.png' },
]

export default function Home() {
  return (
    <>
      <section className="max-w-275 mx-auto px-6 pt-40 pb-24 min-h-screen flex items-center">
        <div className="flex flex-col lg:flex-row justify-between items-center gap-12 w-full">
          <FadeIn className="max-w-125 lg:text-left text-center">
            <h1 className="font-display text-4xl md:text-5xl font-normal leading-tight tracking-tight text-[--color-text-primary] mb-6">
              Konstantin builds full-stack solutions that just work.
            </h1>
            <div className="w-15 h-px bg-[--color-accent] mb-6 lg:mx-0 mx-auto" />
            <p className="font-accent text-xl italic text-[--color-text-secondary] leading-relaxed mb-6">
              I design applications and sites for businesses and personal interests as a{' '}
              <span className="text-[--color-accent] not-italic font-medium">freelance developer</span>
            </p>
            <SocialLinks className="lg:justify-start justify-center" />
          </FadeIn>

          <FadeIn delay={0.2} className="relative">
            <div className="relative w-[300px] h-[400px] lg:w-[380px] lg:h-[500px] overflow-hidden">
              <div className="absolute inset-0 border border-[--color-accent] opacity-30 translate-x-4 translate-y-4 -z-10" />
              <Image
                src="/portrait.jpeg"
                alt="Konstantin Stanmeyer"
                fill
                className="object-cover grayscale-[20%] hover:grayscale-0 transition-all duration-500"
                priority
              />
            </div>
          </FadeIn>
        </div>
      </section>
      <section id="skills" className="max-w-[1100px] mx-auto px-6 py-24">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16">
          <FadeIn>
            <h2 className="font-display text-2xl md:text-3xl font-normal leading-snug text-[--color-text-primary] mb-4">
              I've built solutions with technologies you may recognize.
            </h2>
            <p className="text-[--color-text-secondary] leading-relaxed">
              People, performance, and problem-solving. In that order. I focus on writing clean, 
              efficient code while leveraging modern frameworks and tools to build seamless digital experiences.
            </p>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="grid grid-cols-3 gap-6 p-6">
              {skills.map((skill) => (
                <SkillIcon key={skill.name} name={skill.name} icon={skill.icon} />
              ))}
            </div>
          </FadeIn>

          <FadeIn delay={0.2}>
            <h2 className="font-display text-2xl md:text-3xl font-normal leading-snug text-[--color-text-primary] mb-4">
              Great products start with people.
            </h2>
            <p className="text-[--color-text-secondary] leading-relaxed">
              Understanding user motivations, frustrations, and behaviors guides every decision I make. 
              I believe in building solutions that create genuine value—not just features.
            </p>
          </FadeIn>

          <FadeIn delay={0.3}>
            <h2 className="font-display text-2xl md:text-3xl font-normal leading-snug text-[--color-text-primary] mb-4">
              Maintained Creative + Technical Focus.
            </h2>
            <p className="text-[--color-text-secondary] leading-relaxed">
              Working behind a camera trained me to pay attention to spacing, contrast, and detail. 
              Those habits still guide the way I structure layouts and evaluate interface clarity.
            </p>
          </FadeIn>
        </div>
      </section>
      <section className="max-w-[1100px] mx-auto px-6 py-24">
        <FadeIn>
          <div className="section-label">
            <span className="section-label-line" />
            <span className="section-label-text">Selected Work</span>
          </div>
          <h2 className="font-display text-3xl md:text-4xl font-normal text-[--color-text-primary] mb-12">
            Featured Projects
          </h2>
        </FadeIn>

        <StaggerContainer className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {featuredProjects.map((project) => (
            <StaggerItem key={project.id}>
              <Link
                href={`/projects#${project.id}`}
                className="group block rounded-lg overflow-hidden"
              >
                <div className="relative aspect-[4/3] overflow-hidden">
                  <Image
                    src={project.image}
                    alt={project.title}
                    fill
                    className="object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[rgba(15,15,15,0.9)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end justify-center pb-6">
                    <span className="text-sm font-medium tracking-wide text-[--color-text-primary] px-4 py-2 border border-[--color-accent] rounded transform translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
                      View Project
                    </span>
                  </div>
                </div>
                <div className="p-4 bg-[rgba(15,15,15,0.5)]">
                  <h3 className="font-display text-xl font-normal text-[--color-text-primary] mb-1">
                    {project.title}
                  </h3>
                  <p className="text-sm text-[--color-text-secondary]">{project.type}</p>
                </div>
              </Link>
              
            </StaggerItem>
          ))}
        </StaggerContainer>
        <div className="flex justify-center">
          <Link href="/projects" className="btn-primary group">
            <span>View All Projects</span>
            <svg 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1"
            >
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </Link>
        </div>
      </section>
      <section className="py-24 bg-gradient-to-b from-transparent via-[rgba(201,162,39,0.03)] to-transparent">
  <div className="max-w-[1400px] mx-auto px-6">
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
      <FadeIn className="max-w-[480px] lg:text-left text-center lg:mx-0 mx-auto">
        <div className="section-label lg:justify-start justify-center">
          <span className="section-label-line" />
          <span className="section-label-text">Beyond Code</span>
        </div>
        <h2 className="font-display text-3xl md:text-4xl font-normal text-[--color-text-primary] mb-6">
          Through the Lens
        </h2>
        <p className="text-[--color-text-secondary] leading-relaxed mb-6">
          Before I wrote my first line of code, I was composing frames. Photography taught me 
          that every pixel matters—that the space between elements tells a story just as 
          much as the elements themselves. This perspective shapes how I approach design: 
          with intention, with patience, and with an eye for the moments that make interfaces 
          feel alive.
        </p>
        <Link 
          href="/photography" 
          className="inline-flex items-center gap-2 text-[--color-accent] font-medium hover:gap-4 transition-all duration-200"
        >
          <span>Explore Gallery</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </Link>
      </FadeIn>

      <FadeIn delay={0.2} className="relative">
        <PhotoCarousel />
        <div className="absolute -bottom-5 -right-5 w-[120px] h-[120px] border border-[--color-accent] opacity-20 rounded-full -z-10" />
      </FadeIn>
    </div>
  </div>
</section>
    </>
  )
}

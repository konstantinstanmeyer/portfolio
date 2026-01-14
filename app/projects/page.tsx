'use client'

import Image from 'next/image'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/FadeIn'
import { projects } from '@/lib/projects'

export default function ProjectsPage() {
  return (
    <>
      <section className="pt-40 pb-16 px-6">
        <div className="max-w-[800px] mx-auto text-center">
          <FadeIn>
            <div className="section-label justify-center">
              <span className="section-label-line" />
              <span className="section-label-text">Portfolio</span>
            </div>
          </FadeIn>
          <FadeIn delay={0.1}>
            <h1 className="font-display text-5xl md:text-6xl font-normal text-[--color-text-primary] mb-4">
              Selected Works
            </h1>
          </FadeIn>
          <FadeIn delay={0.2}>
            <p className="font-accent text-xl italic text-[--color-text-secondary] leading-relaxed">
              a collection of full-stack development, 
              creative design, and seamless user experiences.
            </p>
          </FadeIn>
        </div>
      </section>
      <section className="max-w-[1200px] mx-auto px-6 pb-24">
        <StaggerContainer className="space-y-8" staggerDelay={0.1}>
          {projects.map((project, index) => (
            <StaggerItem key={project.id}>
              <motion.article
                id={project.id}
                className="group relative grid grid-cols-1 lg:grid-cols-2 gap-8 p-6 lg:p-8 rounded-2xl bg-[rgba(255,255,255,0.02)] border border-[rgba(138,138,133,0.1)] hover:border-[rgba(201,162,39,0.3)] transition-all duration-300"
                whileHover={{ y: -4 }}
              >
                <div className={`relative aspect-video lg:aspect-[4/3] rounded-lg overflow-hidden ${
                  index % 2 === 1 ? 'lg:order-2' : ''
                }`}>
                  <Image
                    src={project.image}
                    alt={project.title}
                    fill
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[rgba(15,15,15,0.5)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                </div>
                <div className={`flex flex-col justify-center ${index % 2 === 1 ? 'lg:order-1' : ''}`}>
                  <div className="flex items-center gap-4 mb-3">
                    <span className="text-[--color-accent] text-sm font-semibold tracking-wider">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="text-xs tracking-wider uppercase text-[--color-text-secondary]">
                      {project.type}
                    </span>
                    <span className="text-xs tracking-wider text-[--color-text-secondary]">
                      {project.year}
                    </span>
                  </div>
                  <h2 className="font-display text-3xl md:text-4xl font-normal text-[--color-text-primary] mb-1">
                    {project.title}
                  </h2>
                  <p className="font-accent text-lg italic text-[--color-text-secondary] mb-4">
                    {project.subtitle}
                  </p>
                  <p className="text-[--color-text-secondary] leading-relaxed mb-6 line-clamp-3">
                    {project.description}
                  </p>
                  <div className="flex flex-wrap gap-2 mb-6">
                    {project.technologies.map((tech) => (
                      <span
                        key={tech}
                        className="text-xs text-[--color-text-secondary] bg-[rgba(138,138,133,0.1)] px-3 py-1 rounded-full"
                      >
                        {tech}
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-4">
                    {project.liveUrl && (
                      <a
                        href={project.liveUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-sm font-medium tracking-wide text-[--color-text-primary] px-4 py-2 border border-[--color-text-secondary] rounded hover:border-[--color-accent] hover:text-[--color-accent] transition-all duration-200"
                      >
                        <span>View Live</span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                          <path d="M7 17L17 7M17 7H7M17 7V17"/>
                        </svg>
                      </a>
                    )}
                    {project.githubUrl && (
                      <a
                        href={project.githubUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-sm font-medium tracking-wide text-[--color-text-secondary] hover:text-[--color-accent] transition-colors duration-200"
                      >
                        <span>Source</span>
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                        </svg>
                      </a>
                    )}
                  </div>
                </div>
              </motion.article>
            </StaggerItem>
          ))}
        </StaggerContainer>
      </section>
    </>
  )
}

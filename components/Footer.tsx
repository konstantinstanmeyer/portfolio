import Link from 'next/link'

const footerLinks = [
  { href: '/', label: 'Home' },
  { href: '/projects', label: 'Projects' },
  { href: '/photography', label: 'Photography' },
]

export function Footer() {
  return (
    <footer id="contact" className="max-w-[1100px] mx-auto px-6 py-24 text-center">
      <div className="mb-16">
        <h2 className="font-display text-4xl md:text-5xl font-normal text-[--color-text-primary] mb-4">
          Let's work together
        </h2>
        <p className="font-accent text-xl italic text-[--color-text-secondary] mb-8">
          Have a project in mind? I'd love to hear about it.
        </p>
        <a
          href="mailto:konstantin@stanmeyer.com"
          className="btn-primary"
        >
          Get in touch
        </a>
      </div>

      <div className="pt-6 border-t border-[rgba(138,138,133,0.2)] flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex gap-6">
          {footerLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-[--color-text-secondary] hover:text-[--color-accent] transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </div>
        <span className="text-sm text-[--color-text-secondary]">
          © 2026 Konstantin Stanmeyer
        </span>
      </div>
    </footer>
  )
}

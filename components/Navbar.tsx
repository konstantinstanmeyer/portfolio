'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navLinks = [
  { href: '/#skills', label: 'Skills' },
  { href: '/projects', label: 'Projects' },
  { href: '/photography', label: 'Photography' },
  { href: '/#contact', label: 'Contact' },
]

export function Navbar() {
  const pathname = usePathname()

  return (
    <nav className="fixed top-0 left-0 right-0 h-20 flex items-center justify-between px-6 md:px-12 z-50 bg-gradient-to-b from-[rgba(15,15,15,0.9)] to-transparent backdrop-blur-md">
      <Link href="/" className="flex flex-col gap-0.5 group">
        <span className="text-xs font-medium tracking-[0.2em] text-[--color-text-primary] transition-colors group-hover:text-[--color-accent]">
          KONSTANTIN
        </span>
        <span className="text-xs font-medium tracking-[0.2em] text-[--color-text-primary] transition-colors group-hover:text-[--color-accent]">
          STANMEYER
        </span>
      </Link>

      <div className="flex gap-6 md:gap-10 relative">
        {navLinks.map((link) => {
          const isActive = pathname === link.href || 
            (link.href !== '/' && pathname.startsWith(link.href.split('#')[0]))
          
          return (
            <Link
                key={link.href}
                href={link.href}
                className={`relative inline-block text-sm font-medium tracking-wide
                            ${isActive ? 'text-[--color-text-primary]' : 'text-[--color-text-secondary]'}
                            hover:text-[--color-text-primary]

                            bg-[linear-gradient(currentColor,currentColor)]
                            bg-[length:0%_1px]
                            bg-left-bottom
                            bg-no-repeat

                            transition-[background-size,color] duration-200 ease-out
                            hover:bg-[length:100%_1px]
                `}
            >
                {link.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

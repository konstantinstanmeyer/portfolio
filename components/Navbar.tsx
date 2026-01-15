'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NeonName } from './NeonName'

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
      <NeonName />

      <div className="flex gap-6 md:gap-10 relative">
        {navLinks.map((link) => {
          const isActive = !link.href.includes('#') && pathname === link.href
          
          return (
            <Link
                key={link.href}
                href={link.href}
                className={`relative inline-block text-[13px] font-semibold tracking-[1px]
                  ${isActive ? 'text-primary' : 'text-secondary'}
                  hover:text-primary

                  bg-[linear-gradient(#c9a227,#c9a227)]
                  bg-[length:0%_1px]
                  bg-left-bottom
                  bg-no-repeat

                  hover:text-white

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

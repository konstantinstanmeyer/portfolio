'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { NeonName } from './NeonName'

const navLinks = [
  { href: '/#skills', label: 'Skills' },
  { href: '/projects', label: 'Projects' },
  { href: '/photography', label: 'Photography' },
  { href: '/#contact', label: 'Contact' },
]

export function Navbar() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)

  // Close menu on route change
  useEffect(() => {
    setIsOpen(false)
  }, [pathname])

  // Prevent body scroll when menu is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 h-20 flex items-center justify-between px-6 md:px-12 z-50 bg-gradient-to-b from-[rgba(15,15,15,0.9)] to-transparent backdrop-blur-md">
        <NeonName />
        <div className="hidden md:flex gap-6 md:gap-10 relative">
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
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="md:hidden relative w-8 h-8 flex items-center justify-center z-50"
          aria-label={isOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={isOpen}
        >
          <div className="relative w-6 h-4 flex flex-col justify-between">
            <span
              className={`w-full h-[2px] bg-secondary transition-all duration-300 ease-[cubic-bezier(0.68,-0.6,0.32,1.6)] origin-center
                ${isOpen 
                  ? 'translate-y-[7px] rotate-45' 
                  : 'translate-y-0 rotate-0'
                }`}
            />
            <span
              className={`w-full h-[2px] bg-secondary transition-all duration-300 ease-out
                ${isOpen 
                  ? 'opacity-0 scale-x-0' 
                  : 'opacity-100 scale-x-100'
                }`}
            />
            <span
              className={`w-full h-[2px] bg-secondary transition-all duration-300 ease-[cubic-bezier(0.68,-0.6,0.32,1.6)] origin-center
                ${isOpen 
                  ? '-translate-y-[7px] -rotate-45' 
                  : 'translate-y-0 rotate-0'
                }`}
            />
          </div>
        </button>
      </nav>

      {/* Mobile */}
      <div
        className={`fixed inset-0 bg-[rgba(15,15,15,0.98)] backdrop-blur-xl z-40 md:hidden transition-all duration-500 ease-out
          ${isOpen 
            ? 'opacity-100 visible' 
            : 'opacity-0 invisible'
          }`}
      >
        <div className="flex flex-col items-center justify-center h-full pt-20">
          {navLinks.map((link, index) => {
            const isActive = !link.href.includes('#') && pathname === link.href
            
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsOpen(false)}
                className={`relative text-2xl font-semibold tracking-[2px] py-4
                  transition-all duration-500 ease-out
                  ${isActive ? 'text-[#c9a227]' : 'text-[#a0a0a0]'}
                  hover:text-white
                  ${isOpen 
                    ? 'opacity-100 translate-y-0' 
                    : 'opacity-0 translate-y-8'
                  }`}
                style={{
                  transitionDelay: isOpen ? `${150 + index * 75}ms` : '0ms',
                }}
              >
                <span className="relative">
                  {link.label}
                  <span
                    className={`absolute -bottom-1 left-0 h-[2px] bg-[#c9a227] transition-all duration-300 ease-out
                      ${isActive ? 'w-full' : 'w-0'}
                      group-hover:w-full
                    `}
                  />
                </span>
              </Link>
            )
          })}
        </div>
      </div>
    </>
  )
}
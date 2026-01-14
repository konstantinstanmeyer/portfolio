'use client'

import Image from 'next/image'
import { useState } from 'react'

interface SkillIconProps {
  name: string
  icon: string
}

export function SkillIcon({ name, icon }: SkillIconProps) {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <div
      className="relative w-14 h-14 flex items-center justify-center border border-[rgba(138,138,133,0.2)] rounded-xl cursor-default transition-all duration-200 hover:border-[--color-accent] hover:-translate-y-1"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Image
        src={icon}
        alt={name}
        width={32}
        height={32}
        className={`object-contain transition-all duration-200 ${
          isHovered ? '' : 'grayscale brightness-[0.7]'
        }`}
      />
      <div
        className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 text-[11px] tracking-wide text-[--color-text-primary] bg-[rgba(15,15,15,0.95)] rounded whitespace-nowrap transition-all duration-200 ${
          isHovered ? 'opacity-100 visible' : 'opacity-0 invisible'
        }`}
      >
        {name}
      </div>
    </div>
  )
}

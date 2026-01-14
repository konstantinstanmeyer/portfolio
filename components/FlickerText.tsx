'use client'

import { forwardRef } from 'react'

type FlickerTextProps = {
  text: string
  className?: string
}

export const FlickerText = forwardRef<HTMLSpanElement, FlickerTextProps>(function FlickerText({ text, className }, ref) {
    return (
        <span
            ref={ref}
            className={`inline-flex ${className}`}
        >
            {text.split('').map((char, i) => (
                <span
                key={i}
                className="transition-[color,text-shadow] duration-75 will-change-[color,text-shadow]"
                >
                {char === ' ' ? '\u00A0' : char}
                </span>
            ))}
        </span>
    )
})
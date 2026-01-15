'use client'

import { useRef } from 'react'
import Link from 'next/link'
import { FlickerText } from '@/components/FlickerText'

export function NeonName() {
    const groupRef = useRef<HTMLDivElement>(null)
    const intervalRef = useRef<number | null>(null)

    const startFlicker = () => {
        if (!groupRef.current || intervalRef.current) return

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

        const letters = Array.from(
            groupRef.current.querySelectorAll<HTMLSpanElement>('span span')
        )

        intervalRef.current = window.setInterval(() => {
            for (const l of letters) {
                l.classList.remove('flicker-on')
            }

            const count = Math.min(
                letters.length,
                Math.floor(Math.random() * 3) + 2
            )

            for (let i = 0; i < count; i++) {
                const random = letters[Math.floor(Math.random() * letters.length)];
                random.classList.add('flicker-on');
            }
        }, 200)
    }

    const stopFlicker = () => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
        }

        if (!groupRef.current) return

        groupRef.current
        .querySelectorAll('span span')
        .forEach((l) => l.classList.remove('flicker-on'))
    }

    return (
        <Link
            href="/"
            className="flex flex-col gap-0.5 group"
            onMouseEnter={startFlicker}
            onMouseLeave={stopFlicker}
        >
            <div className="flex flex-col gap-0.5" ref={groupRef}>
                <FlickerText
                text="KONSTANTIN"
                className="text-xs font-bold tracking-[2px] text-primary"
                />
                <FlickerText
                text="STANMEYER"
                className="text-xs font-bold tracking-[2px] text-primary"
                />
            </div>
        </Link>
    )
}
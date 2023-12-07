'use client';

import { useState, useEffect } from 'react';

export default function Loader() {
    const [isLoading, setIsLoading] = useState(true);
    const [isFading, setIsFading] = useState(false);

    useEffect(() => {
        const fadeTimer = setTimeout(() => {
        setIsFading(true);
        setTimeout(() => setIsLoading(false), 500);
        }, 750);

        return () => clearTimeout(fadeTimer);
    }, []);

    if (!isLoading) return null;

    return (
        <div
        className={`fixed inset-0 z-9999 flex items-center justify-center bg-bg transition-opacity duration-500 ${
            isFading ? 'opacity-0 pointer-events-none' : ''
        }`}
        >
        <div className="w-12.5 h-12.5 border-[3px] border-[rgba(245,245,240,0.1)] border-t-primary rounded-full animate-spin" />
        </div>
    );
}
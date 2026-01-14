'use client'

import { useState, useCallback } from 'react'
import Image from 'next/image'
import Masonry from 'react-masonry-css'
import { motion, AnimatePresence } from 'framer-motion'
import { photos, categories, type Photo } from '@/lib/photos'

const breakpointColumns = {
  default: 3,
  1100: 3,
  768: 2,
  500: 1,
}

export default function PhotoGallery() {
  const [activeFilter, setActiveFilter] = useState<any>('all')
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null)

  const filteredPhotos = activeFilter === 'all' 
    ? photos 
    : photos.filter(photo => photo.category === activeFilter)

  const openLightbox = useCallback((photo: Photo) => {
    setSelectedPhoto(photo)
    document.body.style.overflow = 'hidden'
  }, [])

  const closeLightbox = useCallback(() => {
    setSelectedPhoto(null)
    document.body.style.overflow = ''
  }, [])

  const navigatePhoto = useCallback((direction: 'prev' | 'next') => {
    if (!selectedPhoto) return
    const currentIndex = filteredPhotos.findIndex(p => p.id === selectedPhoto.id)
    const newIndex = direction === 'next'
      ? (currentIndex + 1) % filteredPhotos.length
      : (currentIndex - 1 + filteredPhotos.length) % filteredPhotos.length
    setSelectedPhoto(filteredPhotos[newIndex])
  }, [selectedPhoto, filteredPhotos])

  return (
    <>
      <div className="top-20 z-40 py-6 px-6 bg-gradient-to-b from-[#0a0a0a] via-[rgba(10,10,10,0.95)] to-transparent backdrop-blur-sm">
        <div className="max-w-[1100px] mx-auto flex justify-center gap-2 flex-wrap">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setActiveFilter(category)}
              className={`px-4 py-2 text-sm font-medium tracking-wide rounded-full border transition-all duration-200 ${
                activeFilter === category
                  ? 'text-[--color-text-primary] border-[--color-accent] bg-[--color-accent-muted]'
                  : 'text-[--color-text-secondary] border-transparent hover:text-[--color-text-primary]'
              }`}
            >
              {category.charAt(0).toUpperCase() + category.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="max-w-[1400px] mx-auto px-6 pb-24">
        <Masonry
          breakpointCols={breakpointColumns}
          className="masonry-grid"
          columnClassName="masonry-grid-column"
        >
          {filteredPhotos.map((photo) => (
            <motion.div
              key={photo.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.3 }}
              className="group relative cursor-pointer overflow-hidden rounded"
              onClick={() => openLightbox(photo)}
            >
              <div className={`relative ${
                photo.aspectRatio === 'portrait' ? 'aspect-[3/4]' :
                photo.aspectRatio === 'landscape' ? 'aspect-[4/3]' :
                'aspect-square'
              }`}>
                <Image
                  src={photo.src}
                  alt={photo.title}
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                  sizes="(max-width: 500px) 100vw, (max-width: 768px) 50vw, 33vw"
                />
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-[rgba(10,10,10,0.9)] via-[rgba(10,10,10,0.3)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
                <motion.div
                  initial={{ y: 10, opacity: 0 }}
                  whileInView={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.1 }}
                  className="transform translate-y-2 group-hover:translate-y-0 transition-transform duration-300"
                >
                  <h3 className="font-display text-xl text-[--color-text-primary] mb-1">
                    {photo.title}
                  </h3>
                  <p className="text-sm text-[--color-text-secondary]">
                    {photo.location}
                  </p>
                </motion.div>
              </div>
            </motion.div>
          ))}
        </Masonry>
      </div>
      <AnimatePresence>
        {selectedPhoto && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-[rgba(10,10,10,0.98)] flex items-center justify-center"
            onClick={closeLightbox}
          >
            <button
              onClick={closeLightbox}
              className="absolute top-6 right-6 w-12 h-12 flex items-center justify-center border border-[--color-text-secondary] rounded-full text-[--color-text-primary] hover:border-[--color-accent] hover:text-[--color-accent] transition-colors z-10"
              aria-label="Close lightbox"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); navigatePhoto('prev') }}
              className="absolute left-6 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center border border-[--color-text-secondary] rounded-full text-[--color-text-primary] hover:border-[--color-accent] hover:text-[--color-accent] transition-colors z-10 hidden md:flex"
              aria-label="Previous photo"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6">
                <path d="M15 18l-6-6 6-6"/>
              </svg>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); navigatePhoto('next') }}
              className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center border border-[--color-text-secondary] rounded-full text-[--color-text-primary] hover:border-[--color-accent] hover:text-[--color-accent] transition-colors z-10 hidden md:flex"
              aria-label="Next photo"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </button>
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="max-w-[90vw] max-h-[90vh] text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative">
                <Image
                  src={selectedPhoto.src}
                  alt={selectedPhoto.title}
                  width={1200}
                  height={800}
                  className="max-h-[80vh] w-auto object-contain rounded"
                />
              </div>
              <div className="mt-4">
                <h3 className="font-display text-2xl text-[--color-text-primary]">
                  {selectedPhoto.title}
                </h3>
                <p className="text-[--color-text-secondary]">
                  {selectedPhoto.location}
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

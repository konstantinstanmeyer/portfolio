export interface Project {
  id: string
  title: string
  subtitle: string
  type: 'Client' | 'Personal' | 'Application'
  year: string
  description: string
  challenge?: string
  solution?: string
  technologies: string[]
  timeline?: string
  role?: string
  liveUrl?: string
  githubUrl?: string
  image: string
  images?: string[]
}

export const projects: Project[] = [
    {   
        id: 'gerald',
        title: 'Gerald Elias',
        subtitle: 'Mystery Author & Musician',
        type: 'Client',
        year: '2023',
        description: 'An extensive site created for mystery author and musician Gerald Elias. The platform serves as a comprehensive hub for marketing books and events, while providing visitors with an immersive experience to explore the life and work of this accomplished creator.',
        challenge: 'Gerald needed a digital presence that could elegantly showcase two distinct creative careers—as a mystery novelist and as a professional violinist—while maintaining a cohesive brand identity.',
        solution: 'Designed an interface that weaves together literary and musical themes through thoughtful typography, a sophisticated color palette, and intuitive navigation.',
        technologies: ['Next.js', 'React', 'Tailwind CSS', 'Vercel'],
        timeline: '8 weeks',
        role: 'Design & Development',
        liveUrl: 'https://www.mysteriesandmusic.com/',
        image: '/projects/gerald-1.png',
        images: ['/projects/gerald-1.png', '/projects/gerald-2.jpg', '/projects/gerald-3.jpg'],
    },
    {
        id: 'mira-okonkwo',
        title: 'Mira Okonkwo',
        subtitle: 'Author Website Prototype',
        type: 'Personal',
        year: '2024',
        description: 'Designed and implemented an interactive UI prototype for a hypothetical author website. This project served as an exploration of animation techniques and modern CSS capabilities.',
        challenge: 'Creating engaging, smooth animations and interactions using only vanilla JavaScript and CSS—proving that powerful user experiences don\'t always require heavy framework dependencies.',
        solution: 'Leveraged CSS custom properties, keyframe animations, and intersection observers to create a fluid, responsive experience.',
        technologies: ['HTML', 'CSS', 'Vanilla JavaScript'],
        timeline: '3 weeks',
        role: 'Design & Development',
        liveUrl: 'https://local-author.vercel.app/',
        image: '/projects/maria-okonkwo.png',
        images: ['/projects/mira-1.jpg', '/projects/mira-2.jpg', '/projects/mira-3.jpg'],
    },
    {
        id: 'sm-2',
        title: 'SM-2 Learner',
        subtitle: 'Spaced Repetition Language Learning',
        type: 'Application',
        year: '2024',
        description: 'A language-learning platform inspired by Anki, implementing the SuperMemo 2 (SM-2) spaced repetition algorithm. The application provides a more aesthetic, cohesive experience while addressing language concepts that traditional flashcard apps overlook.',
        challenge: 'While Anki is powerful, its interface can feel dated and overwhelming. The goal was to retain the proven effectiveness of spaced repetition while creating an experience that learners actually enjoy using daily.',
        solution: 'Built a full-stack application with a clean, modern interface that makes daily practice feel rewarding.',
        technologies: ['Next.js 14', 'PostgreSQL', 'Prisma', 'TypeScript'],
        timeline: '12 weeks',
        role: 'Full-Stack Development',
        liveUrl: 'https://sm2-next-14.vercel.app',
        image: '/projects/sm-2.png',
        images: ['/projects/sm2-1.jpg', '/projects/sm2-2.jpg', '/projects/sm2-3.jpg'],
    },
    {
        id: 'weather',
        title: 'Weather Dashboard',
        subtitle: 'Real-time Weather Visualization',
        type: 'Personal',
        year: '2024',
        description: 'A weather visualization dashboard with location-based forecasting, featuring beautiful data visualizations and responsive design.',
        technologies: ['React', 'OpenWeather API', 'Chart.js'],
        timeline: '2 weeks',
        role: 'Development',
        image: '/projects/weather.png',
    },
    {
        id: 'marketplace',
        title: 'Artisan Marketplace',
        subtitle: 'E-Commerce Platform',
        type: 'Personal',
        year: '2023',
        description: 'Full-featured online store with Stripe integration, user authentication, and inventory management.',
        technologies: ['Next.js', 'Stripe', 'PostgreSQL', 'Prisma'],
        timeline: '6 weeks',
        role: 'Full-Stack Development',
        image: '/projects/marketplace.png',
    },
    {
        id: 'markdown',
        title: 'Markdown Editor',
        subtitle: 'Minimalist Writing Environment',
        type: 'Application',
        year: '2023',
        description: 'A clean, distraction-free markdown editor with live preview and export capabilities.',
        technologies: ['TypeScript', 'CodeMirror', 'React'],
        timeline: '3 weeks',
        role: 'Development',
        image: '/projects/markdown.png',
    },
]

export const featuredProjects = projects.slice(0, 3)
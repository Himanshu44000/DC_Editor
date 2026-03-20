import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import LandingFooter from '../components/LandingFooter'
import Navbar from '../components/Navbar'

const featureItems = [
  {
    title: 'Collaborative Browser IDE',
    text: 'Bring files, folders, Monaco editing, terminal access, previews, chat, voice, and activity into one shared workspace that lives in the browser.',
  },
  {
    title: 'Practice + Full Project Modes',
    text: 'Run quick DSA sessions or launch full-stack project rooms with templates for React, Next.js, Node, Vue, FastAPI, Python CLI, TypeScript, and more.',
  },
  {
    title: 'Built For Real Team Flow',
    text: 'Invite collaborators by code, manage owner or viewer access, stream AI responses, sync cursors live, and keep execution feedback close to the code.',
  },
]

const workflowItems = [
  {
    title: 'Start In Minutes',
    text: 'Create a workspace, choose practice or project mode, and launch from a ready-made template.',
  },
  {
    title: 'Collaborate In Context',
    text: 'Edit live, follow remote cursors, use built-in chat and voice, and keep discussion attached to the code.',
  },
  {
    title: 'Build, Run, Ship',
    text: 'Run code, use the terminal, preview frontend work, and push projects forward without leaving the workspace.',
  },
]

const statItems = [
  { value: '2', label: 'workspace modes for practice and projects' },
  { value: '10+', label: 'starter templates across frontend and backend stacks' },
  { value: '1', label: 'browser workspace for coding, chat, voice, and AI' },
  { value: 'Live', label: 'multiplayer editing, execution, and teamwork' },
]

const quoteItems = [
  {
    quote: 'Students and interview partners can solve problems together without juggling a code runner, chat app, and separate video room.',
    name: 'Practice Sessions',
    role: 'DSA, interviews, mentorship',
  },
  {
    quote: 'Product teams can spin up a real project room with files, terminals, GitHub upload, AI help, and shared context from day one.',
    name: 'Team Projects',
    role: 'Pair programming, shipping features',
  },
]

const faqs = [
  {
    q: 'Who is DC Editor built for?',
    a: 'Students, developers, teams, mentors, interview pairs, and collaborative builders who want coding, communication, and execution in one browser tab.',
  },
  {
    q: 'What makes it different from a plain online editor?',
    a: 'DC Editor combines real-time editing, project roles, shared terminal access, live chat, voice rooms, AI assistance, templates, previews, and GitHub workflows in one product.',
  },
]

const videoSlides = [
  {
    src: '/branding/video.mp4',
    title: 'Shared editor workflow',
    text: 'A fast look at the collaborative workspace, real-time editing, and the coding surface your team uses together.',
  },
  {
    src: '/branding/video2.mp4',
    title: 'Project room in motion',
    text: 'See how DC Editor supports richer team flow with live activity, communication, and project execution inside one product.',
  },
]

const glassPanel =
  'rounded-2xl border border-slate-300/40 bg-white/75 p-6 shadow-xl shadow-slate-300/25 backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/60 dark:shadow-black/40'

const LandingPage = () => {
  const { isAuthenticated } = useAuth()
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0)
  const videoNodesRef = useRef([])
  const [theme, setTheme] = useState(() => {
    const saved = window.localStorage.getItem('dc-landing-theme')
    return saved === 'light' ? 'light' : 'dark'
  })

  const goToNextVideo = () => {
    setCurrentVideoIndex((prev) => (prev + 1) % videoSlides.length)
  }

  const goToPreviousVideo = () => {
    setCurrentVideoIndex((prev) => (prev - 1 + videoSlides.length) % videoSlides.length)
  }

  useEffect(() => {
    window.localStorage.setItem('dc-landing-theme', theme)
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [theme])

  useEffect(() => {
    videoNodesRef.current.forEach((node, index) => {
      if (!node) return
      node.muted = true
      node.defaultMuted = true
      node.volume = 0
      if (index !== currentVideoIndex) {
        node.pause()
      }
    })
  }, [currentVideoIndex])

  return (
    <div
      id="home"
      className={`${theme === 'dark' ? 'dark' : ''} scroll-smooth bg-slate-100 font-['Questrial',sans-serif] text-slate-900 antialiased dark:bg-[#05070d] dark:text-slate-100`}
    >
      <div className="relative overflow-hidden bg-[radial-gradient(circle_at_14%_16%,rgba(15,23,42,0.16),transparent_36%),radial-gradient(circle_at_86%_8%,rgba(71,85,105,0.16),transparent_42%),linear-gradient(165deg,#f8fafc_0%,#ffffff_53%,#f1f5f9_100%)] dark:bg-[radial-gradient(circle_at_14%_16%,rgba(148,163,184,0.14),transparent_36%),radial-gradient(circle_at_86%_8%,rgba(71,85,105,0.14),transparent_42%),linear-gradient(165deg,#03060d_0%,#06080e_58%,#020308_100%)]">
        <Navbar variant="landing" theme={theme} setTheme={setTheme} />

        <section className="relative mx-auto flex min-h-screen w-full max-w-7xl items-center px-4 pb-16 pt-36 xl:pr-[23rem] md:px-6">
          <div className="absolute -right-20 top-20 hidden h-96 w-96 rounded-full bg-slate-300/30 blur-3xl dark:block" />
          <div className="relative max-w-4xl">
            <p className="font-['Manrope',sans-serif] text-xs font-extrabold uppercase tracking-[0.2em] text-slate-700 dark:text-slate-300">
              REAL-TIME COLLABORATION PLATFORM
            </p>
            <h1 className="mt-4 max-w-4xl text-4xl font-medium uppercase leading-[1.05] tracking-[0.03em] sm:text-5xl lg:text-7xl">
              Code. Talk. Build together with speed and clarity.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-slate-700 dark:text-slate-300">
              DC Editor is a real-time collaborative coding platform where teams can create workspaces, edit together live, chat, join voice,
              run code, use AI, and manage full projects without leaving the browser.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to={isAuthenticated ? '/dashboard' : '/auth'}
                className="launch-editor-btn rounded-full px-6 py-3 text-xs font-bold uppercase tracking-[0.12em] text-white transition hover:-translate-y-0.5"
              >
                {isAuthenticated ? 'Launch Editor' : 'Create Workspace'}
              </Link>
              <a
                href="#about"
                className="landing-secondary-btn rounded-full px-6 py-3 text-xs font-bold uppercase tracking-[0.12em]"
              >
                Explore Features
              </a>
            </div>
          </div>
          <div className="hero-side-badge pointer-events-none absolute right-0 top-1/2 hidden -translate-y-1/2 flex-col items-end xl:flex ">
            <div className="hero-side-visual pointer-events-auto ">
              <img
                src="/branding/pic1.png"
                alt="DC Editor workspace preview"
                className="hero-side-image h-auto w-[285px] object-contain"
              />
            </div>
            <a
              href="#about"
              className="pointer-events-auto text-[10px] font-bold uppercase tracking-[0.2em] text-slate-600 dark:text-slate-400"
            >
              Scroll Down
            </a>
          </div>
        </section>

        <section id="about" className="mx-auto w-full max-w-7xl px-4 py-20 md:px-6">
          <p className="font-['Manrope',sans-serif] text-xs font-extrabold uppercase tracking-[0.2em] text-slate-700 dark:text-slate-300">
            ABOUT DC EDITOR
          </p>
          <h2 className="mt-4 max-w-3xl text-3xl font-medium uppercase tracking-[0.03em] sm:text-4xl">
            One browser workspace for coding, communication, execution, and teamwork.
          </h2>
          <p className="mt-5 max-w-4xl text-sm leading-relaxed text-slate-700 dark:text-slate-300 sm:text-base">
            DC Editor is designed for collaborative software building. Teams can create workspaces, invite members with share codes, choose
            between quick practice rooms or full project environments, and keep editing, execution, AI help, chat, voice, and project context
            inside a single interface.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {featureItems.map((item) => (
              <article key={item.title} className={`${glassPanel} about-feature-card`}>
                <h3 className="text-xl font-medium uppercase tracking-[0.03em]">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{item.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="workflow" className="mx-auto grid w-full max-w-7xl items-center gap-8 px-4 py-20 md:grid-cols-[1.12fr_0.88fr] md:px-6">
          <div className={`${glassPanel}  overflow-hidden p-0`}>
            <img
              src="/branding/picture.png"
              alt="How teams use DC Editor"
              className="h-full min-h-[18rem] w-full object-cover "
            />
          </div>
          <div>
            <p className="font-['Manrope',sans-serif] text-xs font-extrabold uppercase tracking-[0.2em] text-slate-700 dark:text-slate-300">
              HOW TEAMS USE IT
            </p>
            <h2 className="mt-4 text-2xl font-medium uppercase tracking-[0.03em] sm:text-3xl">
              From interview prep to full product builds, work in one continuous flow.
            </h2>
            <div className="mt-5 space-y-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {workflowItems.map((item) => (
                <article key={item.title} className="rounded-2xl border border-slate-300/60 bg-white/60 px-5 py-3.5 shadow-lg shadow-slate-300/15 dark:border-slate-700/70 dark:bg-slate-950/35 dark:shadow-black/20">
                  <h3 className="font-['Manrope',sans-serif] text-sm font-extrabold uppercase tracking-[0.12em] text-slate-900 dark:text-white">
                    {item.title}
                  </h3>
                  <p className="mt-2">{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="demo" className="mx-auto w-full max-w-7xl px-4 py-20 md:px-6">
          <p className="font-['Manrope',sans-serif] text-xs font-extrabold uppercase tracking-[0.2em] text-slate-700 dark:text-slate-300">
            LIVE PRODUCT DEMO
          </p>
          <h2 className="mt-4 text-3xl font-medium uppercase tracking-[0.03em] sm:text-4xl">
            Watch the editor workflow in motion.
          </h2>
          <p className="mt-5 max-w-3xl text-sm leading-relaxed text-slate-700 dark:text-slate-300 sm:text-base">
            Flip through two product views to see how DC Editor presents collaborative coding, workspace activity, and team-ready project flow.
          </p>
          <div className="video-showcase-shell mt-8">
            <div className="video-showcase__glow video-showcase__glow--left" />
            <div className="video-showcase__glow video-showcase__glow--right" />
            <div className={`${glassPanel} video-showcase p-0`}>
            <button
              type="button"
              onClick={goToPreviousVideo}
              className="landing-icon-btn landing-icon-btn--left"
              aria-label="Show previous demo video"
            >
              ←
            </button>
            <button
              type="button"
              onClick={goToNextVideo}
              className="landing-icon-btn landing-icon-btn--right"
              aria-label="Show next demo video"
            >
              →
            </button>
            <div className="video-slider-viewport">
            <div className="video-slider-track" style={{ transform: `translateX(-${currentVideoIndex * 100}%)` }}>
              {videoSlides.map((slide, index) => (
                <article key={slide.src} className="video-slide">
                      <video
                        ref={(node) => {
                          videoNodesRef.current[index] = node
                        }}
                        controls={index === currentVideoIndex}
                        autoPlay={index === currentVideoIndex}
                        muted
                        loop
                        playsInline
                        preload="metadata"
                        controlsList="nodownload noplaybackrate noremoteplayback"
                        disablePictureInPicture
                        onVolumeChange={(event) => {
                          event.currentTarget.muted = true
                          event.currentTarget.volume = 0
                        }}
                        className="video-slide__media"
                      >
                    <source src={slide.src} type="video/mp4" />
                  </video>
                  <div className="video-slide__caption">
                    <p className="font-['Manrope',sans-serif] text-[11px] font-extrabold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      Demo {index + 1}
                    </p>
                    <h3 className="mt-3 text-xl font-medium uppercase tracking-[0.03em]">{slide.title}</h3>
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-700 dark:text-slate-300">{slide.text}</p>
                  </div>
                </article>
              ))}
            </div>
            </div>
            <div className="video-slider-dots">
              {videoSlides.map((slide, index) => (
                <button
                  key={slide.src}
                  type="button"
                  aria-label={`Go to demo video ${index + 1}`}
                  aria-pressed={index === currentVideoIndex}
                  className={`video-slider-dot ${index === currentVideoIndex ? 'is-active' : ''}`}
                  onClick={() => setCurrentVideoIndex(index)}
                />
              ))}
            </div>
          </div>
          </div>
        </section>

        <section id="metrics" className="mx-auto w-full max-w-7xl px-4 py-20 md:px-6">
          <p className="font-['Manrope',sans-serif] text-xs font-extrabold uppercase tracking-[0.2em] text-slate-700 dark:text-slate-300">
            TEAM IMPACT
          </p>
          <h2 className="mt-4 text-3xl font-medium uppercase tracking-[0.03em] sm:text-4xl">
            Built for teams that care about velocity and code quality.
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {statItems.map((item) => (
              <article key={item.label} className={`${glassPanel} text-center`}>
                <h3 className="text-4xl font-medium uppercase tracking-[0.04em]">{item.value}</h3>
                <p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-700 dark:text-slate-300">{item.label}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="voices" className="mx-auto w-full max-w-7xl px-4 py-20 md:px-6">
          <p className="font-['Manrope',sans-serif] text-xs font-extrabold uppercase tracking-[0.2em] text-slate-700 dark:text-slate-300">
            TEAM VOICES
          </p>
          <h2 className="mt-4 text-3xl font-medium uppercase tracking-[0.03em] sm:text-4xl">
            People who build together, stay together.
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {quoteItems.map((item) => (
              <article key={item.name} className={glassPanel}>
                <p className="text-base leading-relaxed text-slate-800 dark:text-slate-100">"{item.quote}"</p>
                <p className="mt-4 font-['Manrope',sans-serif] text-sm font-extrabold uppercase tracking-[0.08em]">{item.name}</p>
                <p className="text-sm text-slate-600 dark:text-slate-400">{item.role}</p>
              </article>
            ))}
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {faqs.map((item) => (
              <article key={item.q} className={glassPanel}>
                <h3 className="text-xl font-medium uppercase tracking-[0.03em]">{item.q}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{item.a}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="join" className="mx-auto w-full max-w-7xl px-4 pb-24 pt-16 text-center md:px-6">
          <p className="font-['Manrope',sans-serif] text-xs font-extrabold uppercase tracking-[0.2em] text-slate-700 dark:text-slate-300">
            READY TO BUILD
          </p>
          <h2 className="mx-auto mt-4 max-w-2xl text-3xl font-medium uppercase tracking-[0.03em] sm:text-4xl">
            Bring your team into DC Editor and ship together.
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to={isAuthenticated ? '/dashboard' : '/auth'}
              className="landing-primary-btn rounded-full px-6 py-3 text-xs font-bold uppercase tracking-[0.12em]"
            >
              {isAuthenticated ? 'Go to Dashboard' : 'Get Started'}
            </Link>
            <a
              href="#home"
              className="landing-secondary-btn rounded-full px-6 py-3 text-xs font-bold uppercase tracking-[0.12em]"
            >
              Back to Top
            </a>
          </div>
        </section>
      </div>


      <LandingFooter theme={theme} />
    </div>
  )
}

export default LandingPage

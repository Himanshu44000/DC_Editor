import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const featureItems = [
  {
    title: 'Live Multiplayer Editing',
    text: 'See every cursor in real time, pair program without lag, and ship features together.',
  },
  {
    title: 'Built-In Team Chat',
    text: 'Keep technical discussion in context so decisions stay close to the code they affect.',
  },
  {
    title: 'Project Rooms & Roles',
    text: 'Create private rooms, invite teammates, and manage who can edit, run, and review.',
  },
]

const workflowItems = [
  'Create a project room and invite teammates with one share link.',
  'Code together with synced files, terminal actions, and activity updates.',
  'Review changes in real time and move from idea to deploy-ready code faster.',
]

const statItems = [
  { value: '10x', label: 'faster feedback loops' },
  { value: '99.9%', label: 'session sync reliability' },
  { value: '<120ms', label: 'cursor broadcast latency' },
  { value: '24/7', label: 'global team collaboration' },
]

const quoteItems = [
  {
    quote: 'Pair programming finally feels native. We moved from endless calls to live building.',
    name: 'Aarav Shah',
    role: 'Engineering Lead, FluxStack',
  },
  {
    quote: 'The shared editor + chat + activity stream made our sprint reviews dramatically cleaner.',
    name: 'Nina Patel',
    role: 'Product Engineer, LoopForge',
  },
]

const faqs = [
  {
    q: 'Can we use DC Editor for interviews and mentorship?',
    a: 'Yes. Use project rooms for coding sessions, watch live cursor movement, and communicate inside the same workspace.',
  },
  {
    q: 'Does DC Editor support team onboarding?',
    a: 'Yes. New members can join rooms, inspect activity logs, and understand project context without multiple tools.',
  },
]

const footerGroups = [
  ['Pre-Owned', 'Find a Dealer', 'Privacy', 'Language'],
  ['Cookies', 'EU Tyre Labels', 'Careers', 'Press Kit'],
  ['Pressclub', 'Battery Regulation', 'Site Map', 'Roadmap'],
  ['Legal', 'FAQs', 'Whispers', 'Security'],
  ['Complaints', 'Contact', 'Sustainability', 'Support'],
]

const socialLinks = ['YouTube', 'Facebook', 'Instagram', 'LinkedIn', 'X']

const glassPanel =
  'rounded-2xl border border-slate-300/40 bg-white/75 p-6 shadow-xl shadow-slate-300/25 backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/60 dark:shadow-black/40'

const LandingPage = () => {
  const { isAuthenticated } = useAuth()
  const [theme, setTheme] = useState(() => {
    const saved = window.localStorage.getItem('dc-landing-theme')
    return saved === 'light' ? 'light' : 'dark'
  })

  useEffect(() => {
    window.localStorage.setItem('dc-landing-theme', theme)
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [theme])

  return (
    <div
      id="home"
      className={`${theme === 'dark' ? 'dark' : ''} scroll-smooth bg-slate-100 font-['Questrial',sans-serif] text-slate-900 antialiased dark:bg-[#05070d] dark:text-slate-100`}
    >
      <div className="relative overflow-hidden bg-[radial-gradient(circle_at_14%_16%,rgba(15,23,42,0.16),transparent_36%),radial-gradient(circle_at_86%_8%,rgba(71,85,105,0.16),transparent_42%),linear-gradient(165deg,#f8fafc_0%,#ffffff_53%,#f1f5f9_100%)] dark:bg-[radial-gradient(circle_at_14%_16%,rgba(148,163,184,0.14),transparent_36%),radial-gradient(circle_at_86%_8%,rgba(71,85,105,0.14),transparent_42%),linear-gradient(165deg,#03060d_0%,#06080e_58%,#020308_100%)]">
        <header className="fixed inset-x-0 top-0 z-40 px-3 py-3">
          <nav className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 rounded-full border border-slate-300/70 bg-white/80 px-4 py-2 shadow-lg shadow-slate-300/40 backdrop-blur-lg dark:border-slate-700/70 dark:bg-black dark:shadow-black/50">
          <img src={theme === 'dark' ? '/branding/logo1.png' : '/branding/logo2.png'} alt="Logo" className="h-12 w-22 rounded-full" />
          

            <div className="flex flex-wrap items-center justify-center gap-4 text-xs font-bold uppercase tracking-[0.14em] text-slate-600 dark:text-slate-300">
              <a href="#about" className="hover:text-slate-900 dark:hover:text-white">About</a>
              <a href="#workflow" className="hover:text-slate-900 dark:hover:text-white">Workflow</a>
              <a href="#demo" className="hover:text-slate-900 dark:hover:text-white">Demo</a>
              <a href="#voices" className="hover:text-slate-900 dark:hover:text-white">Voices</a>
              <a href="#join" className="hover:text-slate-900 dark:hover:text-white">Join</a>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
                className="rounded-full border border-slate-300 bg-white px-3 py-2 text-[11px] font-bold uppercase tracking-[0.11em] text-slate-800 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
              </button>
              <Link
                to={isAuthenticated ? '/dashboard' : '/auth'}
                className="rounded-full border border-zinc-900 bg-zinc-900 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-white transition hover:bg-black dark:border-zinc-200 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                {isAuthenticated ? 'Open Dashboard' : 'Start Coding'}
              </Link>
            </div>
          </nav>
        </header>

        <section className="relative mx-auto flex min-h-screen w-full max-w-7xl items-center px-4 pb-16 pt-36 md:px-6">
          <div className="absolute -right-20 top-20 hidden h-96 w-96 rounded-full bg-slate-300/30 blur-3xl dark:block" />
          <div className="relative">
            <p className="font-['Manrope',sans-serif] text-xs font-extrabold uppercase tracking-[0.2em] text-slate-700 dark:text-slate-300">
              REAL-TIME COLLABORATION PLATFORM
            </p>
            <h1 className="mt-4 max-w-4xl text-4xl font-medium uppercase leading-[1.05] tracking-[0.03em] sm:text-5xl lg:text-7xl">
              Code. Talk. Build together with speed and clarity.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-slate-700 dark:text-slate-300">
              DC Editor brings your team into one live workspace where ideas, code, and feedback move in sync.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to={isAuthenticated ? '/dashboard' : '/auth'}
                className="rounded-full border border-zinc-900 bg-zinc-900 px-6 py-3 text-xs font-bold uppercase tracking-[0.12em] text-white transition hover:-translate-y-0.5 hover:bg-black dark:border-zinc-200 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                {isAuthenticated ? 'Launch Editor' : 'Create Workspace'}
              </Link>
              <a
                href="#about"
                className="rounded-full border border-slate-300 px-6 py-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-800 transition hover:bg-white dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-900"
              >
                Explore Features
              </a>
            </div>
          </div>
          <a href="#about" className="absolute bottom-8 right-6 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-600 dark:text-slate-400">
            Scroll Down
          </a>
        </section>

        <section id="about" className="mx-auto w-full max-w-7xl px-4 py-20 md:px-6">
          <p className="font-['Manrope',sans-serif] text-xs font-extrabold uppercase tracking-[0.2em] text-slate-700 dark:text-slate-300">
            ABOUT DC EDITOR
          </p>
          <h2 className="mt-4 max-w-3xl text-3xl font-medium uppercase tracking-[0.03em] sm:text-4xl">
            One workspace for builders who move fast.
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {featureItems.map((item) => (
              <article key={item.title} className={glassPanel}>
                <h3 className="text-xl font-medium uppercase tracking-[0.03em]">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{item.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="workflow" className="mx-auto grid w-full max-w-7xl items-center gap-6 px-4 py-20 md:grid-cols-2 md:px-6">
          <div className={`${glassPanel} relative min-h-[320px]`}>
            <div className="h-52 rounded-xl border border-slate-300/50 bg-slate-100 p-3 dark:border-slate-700 dark:bg-slate-950">
              <div className="h-6 rounded-md bg-gradient-to-r from-slate-300/70 to-slate-500/50 dark:from-slate-300/30 dark:to-slate-500/20" />
              <div className="mt-3 space-y-2">
                <div className="h-3 rounded bg-slate-300 dark:bg-slate-700" />
                <div className="h-3 rounded bg-slate-300/70 dark:bg-slate-700/80" />
                <div className="h-3 rounded bg-slate-300/50 dark:bg-slate-700/60" />
                <div className="h-3 rounded bg-slate-300/50 dark:bg-slate-700/60" />
              </div>
            </div>
            <div className="absolute bottom-6 right-6 w-52 space-y-2 rounded-xl border border-slate-300/50 bg-white/95 p-3 dark:border-slate-700 dark:bg-slate-900/95">
              <div className="h-7 rounded bg-slate-300/70 dark:bg-slate-500/20" />
              <div className="h-7 rounded bg-slate-300/50 dark:bg-slate-500/15" />
              <div className="h-7 rounded bg-slate-300/40 dark:bg-slate-500/10" />
            </div>
          </div>
          <div>
            <p className="font-['Manrope',sans-serif] text-xs font-extrabold uppercase tracking-[0.2em] text-slate-700 dark:text-slate-300">
              HOW TEAMS USE IT
            </p>
            <h2 className="mt-4 text-3xl font-medium uppercase tracking-[0.03em] sm:text-4xl">
              From quick fixes to full features, collaborate without context switching.
            </h2>
            <ol className="mt-6 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {workflowItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </div>
        </section>

        <section id="demo" className="mx-auto w-full max-w-7xl px-4 py-20 md:px-6">
          <p className="font-['Manrope',sans-serif] text-xs font-extrabold uppercase tracking-[0.2em] text-slate-700 dark:text-slate-300">
            LIVE PRODUCT DEMO
          </p>
          <h2 className="mt-4 text-3xl font-medium uppercase tracking-[0.03em] sm:text-4xl">
            Watch the editor workflow in motion.
          </h2>
          <div className={`${glassPanel} mt-8 p-0`}>
            <video
              controls
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              className="max-h-[68vh] min-h-64 w-full rounded-2xl object-cover"
              poster="https://images.unsplash.com/photo-1515879218367-8466d910aaa4?auto=format&fit=crop&w=1400&q=80"
            >
              <source src="https://cdn.pixabay.com/video/2022/10/15/134903-760542063_large.mp4" type="video/mp4" />
            </video>
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
              className="rounded-full border border-zinc-900 bg-zinc-900 px-6 py-3 text-xs font-bold uppercase tracking-[0.12em] text-white transition hover:-translate-y-0.5 hover:bg-black dark:border-zinc-200 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              {isAuthenticated ? 'Go to Dashboard' : 'Get Started'}
            </Link>
            <a
              href="#home"
              className="rounded-full border border-slate-300 px-6 py-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-800 transition hover:bg-white dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-900"
            >
              Back to Top
            </a>
          </div>
        </section>
      </div>


      <footer className="border-slate-300 bg-slate-100 px-4  dark:border-slate-800 dark:bg-[#07090f] md:px-6">
        <div className="mx-auto w-full max-w-7xl">
          <div className=" grid gap-10 border-b border-slate-300 pb-10 dark:border-slate-800 md:grid-cols-2">
            <p className="max-w-xl text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              DC Editor is built for collaborative software teams. Performance values may vary depending on network and project size,
              but the experience is designed to keep code, communication, and momentum in one shared workspace.
            </p>
            <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              Need custom setup support for schools, teams, or enterprise? Reach out and we can configure secure workspaces, role-based
              collaboration, and guided onboarding for your developers.
            </p>
          </div>


          <div className="flex flex-col items-center justify-center border-b border-slate-300 py-10 text-center ">
            <img src={theme === 'dark' ? '/branding/logo1.png' : '/branding/logo2.png'} alt="Logo" className="h-50 w-50 object-contain" />
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-600 dark:text-slate-400">Collaborative Code Studio</p>
          </div>

          <div className="grid gap-8 py-10 md:grid-cols-[1fr_auto]">
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
              {footerGroups.map((group) => (
                <div key={group[0]} className="space-y-3">
                  {group.map((item) => (
                    <a
                      key={item}
                      href="#"
                      className="block font-['Manrope',sans-serif] text-sm font-bold uppercase tracking-[0.12em] text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                    >
                      {item}
                    </a>
                  ))}
                </div>
              ))}
            </div>

            <div className="flex items-end gap-3">
              {socialLinks.map((item) => (
                <a
                  key={item}
                  href="#"
                  className="text-xs font-bold uppercase tracking-[0.1em] text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                >
                  {item}
                </a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default LandingPage

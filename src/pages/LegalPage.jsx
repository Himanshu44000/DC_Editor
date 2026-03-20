import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import Navbar from '../components/Navbar'
import LandingFooter from '../components/LandingFooter'

const legalContent = {
  'privacy-policy': {
    eyebrow: 'Privacy Policy',
    title: 'How DC Editor handles account, workspace, and collaboration data.',
    sections: [
      {
        heading: 'Information we collect',
        body:
          'DC Editor may store account details, workspace membership, project metadata, profile information, invite relationships, and collaboration activity that is required to keep the platform working across shared coding sessions.',
      },
      {
        heading: 'Workspace data',
        body:
          'Project files, execution metadata, chat history, AI conversation history, and activity events can be stored so users can reopen workspaces and continue collaboration without losing context.',
      },
      {
        heading: 'Third-party services',
        body:
          'Authentication, media storage, voice, AI, and infrastructure services may process limited data needed to deliver product features. Service choices and exact retention rules can evolve as the platform grows.',
      },
    ],
  },
  'terms-and-conditions': {
    eyebrow: 'Terms and Conditions',
    title: 'The basic rules for using DC Editor responsibly and safely.',
    sections: [
      {
        heading: 'Account responsibility',
        body:
          'Users are responsible for activity that happens inside their account and workspaces, including project sharing, invite usage, and the content they upload or execute.',
      },
      {
        heading: 'Acceptable use',
        body:
          'DC Editor should be used for legitimate coding, learning, collaboration, mentorship, and software building. Abuse, unauthorized access attempts, malicious execution, or harmful content may lead to removal of access.',
      },
      {
        heading: 'Service evolution',
        body:
          'The platform is actively evolving. Features, templates, limits, integrations, and infrastructure choices may change over time as the product improves.',
      },
    ],
  },
  'cookies-policy': {
    eyebrow: 'Cookies Policy',
    title: 'How session and preference storage may be used inside the product.',
    sections: [
      {
        heading: 'Essential usage',
        body:
          'Session-related storage may be used to keep users signed in, preserve theme preferences, and maintain a smoother navigation experience across the landing page and product workspace.',
      },
      {
        heading: 'Product experience',
        body:
          'Interface preferences and lightweight local settings may be stored so the editor, dashboard, and collaborative environment feel consistent across visits.',
      },
      {
        heading: 'Future analytics',
        body:
          'As the product grows, analytics or performance tooling may be introduced to understand reliability, onboarding flow, and feature usage. This page can be expanded later with those exact details.',
      },
    ],
  },
  security: {
    eyebrow: 'Security',
    title: 'A high-level view of how DC Editor approaches collaboration security.',
    sections: [
      {
        heading: 'Access control',
        body:
          'Workspace ownership, collaborator roles, viewer restrictions, and invite flows are designed to help teams control who can edit, run code, or access project resources.',
      },
      {
        heading: 'Infrastructure awareness',
        body:
          'The platform can run with environment-based configuration, persistent storage, queued execution, and optional isolated execution infrastructure depending on deployment setup.',
      },
      {
        heading: 'Ongoing hardening',
        body:
          'Security is an ongoing process. Logging, validation, service configuration, and operational safeguards should continue evolving as the product scales and new integrations are added.',
      },
    ],
  },
  contact: {
    eyebrow: 'Contact',
    title: 'Ways teams, schools, and collaborators can reach out about DC Editor.',
    sections: [
      {
        heading: 'Product support',
        body:
          'Use this page for future support channels covering onboarding, workspace help, template setup, account issues, and collaborative project troubleshooting.',
      },
      {
        heading: 'Partnerships',
        body:
          'Schools, coding communities, mentorship programs, and software teams can use this space later for partnership requests, demos, or rollout discussions.',
      },
      {
        heading: 'Enterprise or custom setup',
        body:
          'If you plan to offer custom deployment, secure classroom environments, or enterprise collaboration packages, this page is ready to hold those contact paths.',
      },
    ],
  },
}

const glassPanel =
  'rounded-2xl border border-slate-300/40 bg-white/75 p-6 shadow-xl shadow-slate-300/25 backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/60 dark:shadow-black/40'

const LegalPage = () => {
  const { slug = 'privacy-policy' } = useParams()
  const [theme, setTheme] = useState(() => {
    const saved = window.localStorage.getItem('dc-landing-theme')
    return saved === 'light' ? 'light' : 'dark'
  })

  const content = useMemo(() => legalContent[slug] || legalContent['privacy-policy'], [slug])

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
    window.scrollTo(0, 0)
  }, [slug])

  return (
    <div
      className={`${theme === 'dark' ? 'dark' : ''} min-h-screen bg-slate-100 font-['Questrial',sans-serif] text-slate-900 antialiased dark:bg-[#05070d] dark:text-slate-100`}
    >
      <div className="relative overflow-hidden bg-[radial-gradient(circle_at_14%_16%,rgba(15,23,42,0.16),transparent_36%),radial-gradient(circle_at_86%_8%,rgba(71,85,105,0.16),transparent_42%),linear-gradient(165deg,#f8fafc_0%,#ffffff_53%,#f1f5f9_100%)] dark:bg-[radial-gradient(circle_at_14%_16%,rgba(148,163,184,0.14),transparent_36%),radial-gradient(circle_at_86%_8%,rgba(71,85,105,0.14),transparent_42%),linear-gradient(165deg,#03060d_0%,#06080e_58%,#020308_100%)]">
        <Navbar variant="landing" theme={theme} setTheme={setTheme} />

        <section className="mx-auto flex min-h-[70vh] w-full max-w-5xl flex-col justify-center px-4 pb-20 pt-36 md:px-6">
          <p className="font-['Manrope',sans-serif] text-xs font-extrabold uppercase tracking-[0.2em] text-slate-700 dark:text-slate-300">
            {content.eyebrow}
          </p>
          <h1 className="mt-4 max-w-4xl text-4xl font-medium uppercase leading-[1.05] tracking-[0.03em] sm:text-5xl">
            {content.title}
          </h1>
          <p className="mt-6 max-w-3xl text-sm leading-relaxed text-slate-700 dark:text-slate-300 sm:text-base">
            This page provides starter legal and informational content for DC Editor. You can replace or expand these sections with final
            policy language later while keeping the same landing-style navigation and footer.
          </p>

          <div className="mt-10 grid gap-4">
            {content.sections.map((section) => (
              <article key={section.heading} className={glassPanel}>
                <h2 className="text-xl font-medium uppercase tracking-[0.03em]">{section.heading}</h2>
                <p className="mt-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{section.body}</p>
              </article>
            ))}
          </div>
        </section>
      </div>

      <LandingFooter theme={theme} compact />
    </div>
  )
}

export default LegalPage

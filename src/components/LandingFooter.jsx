import { Link } from 'react-router-dom'

const footerGroups = [
  {
    title: 'Platform',
    items: [
      { label: 'Live editing', href: '/#about' },
      { label: 'Practice workspaces', href: '/#workflow' },
      { label: 'Project IDE', href: '/#demo' },
      { label: 'AI assistant', href: '/#about' },
    ],
  },
  {
    title: 'Collaboration',
    items: [
      { label: 'Team chat', href: '/#workflow' },
      { label: 'Voice rooms', href: '/#workflow' },
      { label: 'Activity feed', href: '/#demo' },
      { label: 'Invite codes', href: '/#workflow' },
    ],
  },
  {
    title: 'Build Tools',
    items: [
      { label: 'Terminal tabs', href: '/#demo' },
      { label: 'Code execution', href: '/#demo' },
      { label: 'Live preview', href: '/#demo' },
      { label: 'GitHub upload', href: '/#metrics' },
    ],
  },
  {
    title: 'Legal',
    items: [
      { label: 'Privacy policy', href: '/legal/privacy-policy' },
      { label: 'Terms and conditions', href: '/legal/terms-and-conditions' },
      { label: 'Cookies policy', href: '/legal/cookies-policy' },
      { label: 'Security', href: '/legal/security' },
    ],
  },
  {
    title: 'Support',
    items: [
      { label: 'Contact', href: '/legal/contact' },
      { label: 'Mentorship', href: '/#voices' },
      { label: 'Interview prep', href: '/#voices' },
      { label: 'Team onboarding', href: '/#voices' },
    ],
  },
]

const socialLinks = ['YouTube', 'Facebook', 'Instagram', 'LinkedIn', 'X']

const LandingFooter = ({ theme, compact = false }) => {
  return (
    <footer className="border-slate-300 bg-slate-100 px-4 dark:border-slate-800 dark:bg-[#07090f] md:px-6">
      <div className="mx-auto w-full max-w-7xl">
        {!compact ? (
          <>
            <div className="grid gap-10 border-b border-slate-300 pb-10 dark:border-slate-800 md:grid-cols-2">
              <p className="max-w-xl text-xs leading-relaxed text-slate-700 dark:text-slate-300 sm:text-sm">
                DC Editor is an all-in-one collaborative coding environment for teams, students, and builders who want editing, execution,
                communication, and project flow to stay inside one browser workspace.
              </p>
              <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300 sm:text-sm">
                From practice rooms and interview sessions to real project collaboration with AI, voice, templates, and GitHub integration,
                the platform is built to reduce context switching and increase team momentum.
              </p>
            </div>

            <div className="flex flex-col items-center justify-center border-b border-slate-300 py-10 text-center dark:border-slate-800">
              <img src={theme === 'dark' ? '/branding/logo1.png' : '/branding/logo2.png'} alt="Logo" className="h-50 w-50 object-contain" />
              <p className="mt-2 text-[13px] font-semibold uppercase tracking-[0.2em] text-slate-600 dark:text-slate-400">Dynamic Collaborative Editor</p>
            </div>
          </>
        ) : null}

        <div className={`grid gap-8 ${compact ? 'py-8' : 'py-10'} md:grid-cols-[1fr_auto]`}>
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
            {footerGroups.map((group) => (
              <div key={group.title} className="space-y-3">
                <p className="font-['Manrope',sans-serif] text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  {group.title}
                </p>
                {group.title === 'Legal'
                  ? group.items.map((item) => (
                      <Link
                        key={item.label}
                        to={item.href}
                        className="block font-['Manrope',sans-serif] text-[11px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                      >
                        {item.label}
                      </Link>
                    ))
                  : group.items.map((item) => (
                      <span
                        key={item.label}
                        className="block font-['Manrope',sans-serif] text-[11px] font-bold uppercase tracking-[0.1em] text-slate-700 dark:text-slate-300"
                      >
                        {item.label}
                      </span>
                    ))}
              </div>
            ))}
          </div>

          <div className="flex items-end gap-3">
            {socialLinks.map((item) => (
              <a
                key={item}
                href="#"
                className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              >
                {item}
              </a>
            ))}
          </div>
        </div>
        <div className="border-t border-slate-300 py-4 text-center text-[10px] uppercase tracking-[0.16em] text-slate-500 dark:border-slate-800 dark:text-slate-500">
          (c) 2026 DC Editor. DC Editor TM. All rights reserved.
        </div>
      </div>
    </footer>
  )
}

export default LandingFooter

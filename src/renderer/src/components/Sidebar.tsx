import { NavLink } from 'react-router-dom'

// Visible build stamp — bump on every deploy so you can CONFIRM you're running the newest
// code (not a stale taskbar-pinned temp extraction). Read this back to verify a deploy landed.
const BUILD_TAG = 'v0.1.1 · build 2026-07-19-C'

const links = [
  { to: '/', label: 'Ideas & Trends', end: true },
  { to: '/agent', label: '✦ AI Command', end: false },
  { to: '/scenes', label: '🎬 Scene Studio', end: false },
  { to: '/writer', label: 'Script Writer', end: false },
  { to: '/scriptpad', label: 'Script Pad', end: false },
  { to: '/video', label: 'Video Studio', end: false },
  { to: '/storyboard', label: '🎞 Storyboard Director', end: false },
  { to: '/presenter', label: '🎥 Presenter Studio', end: false },
  { to: '/recorder', label: '⏺ Recorder', end: false },
  { to: '/timeline', label: '✂ Timeline Editor', end: false },
  { to: '/charts', label: 'Charts', end: false },
  { to: '/psx', label: '📈 Live PSX Data', end: false },
  { to: '/nccpl', label: '🏦 NCCPL Analysis', end: false },
  { to: '/advisor', label: 'Advisor', end: false },
  { to: '/library', label: 'Library', end: false },
  { to: '/activity', label: 'Activity Log', end: false },
  { to: '/settings', label: 'Settings', end: false }
]

export default function Sidebar() {
  return (
    <aside className="w-56 shrink-0 border-r border-ink-800 bg-ink-900 flex flex-col">
      <div className="px-5 py-6">
        <div className="text-gold-400 font-serif text-lg tracking-wide">NIHILPOINTZERO</div>
        <div className="text-ink-400 text-xs mt-0.5 tracking-[0.3em]">OS</div>
        <div className="mt-1 inline-block rounded bg-gold-500/15 border border-gold-500/30 px-1.5 py-0.5 text-[10px] text-gold-300">
          {BUILD_TAG}
        </div>
      </div>
      <nav className="flex-1 px-2 space-y-1">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) =>
              `block rounded-md px-3 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-ink-800 text-gold-400 font-medium'
                  : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'
              }`
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
      <div className="px-5 py-4 text-[11px] text-ink-600 border-t border-ink-800">
        Institutional-grade financial intelligence · Roman Urdu · Urdu · English
      </div>
    </aside>
  )
}

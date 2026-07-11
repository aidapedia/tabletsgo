import IconButton from '@/shared/ui/buttons/IconButton'
import { CloseIcon, DatabaseIcon, DbLogo } from '@/shared/ui/icons'

// Database types offered when creating a connection.
export const DB_CATALOG = [
  { id: 'postgresql', label: 'PostgreSQL', desc: 'Open-source relational database', available: true },
  { id: 'sqlite', label: 'SQLite', desc: 'Embedded file-based database', available: true },
  { id: 'mysql', label: 'MySQL', desc: 'Popular relational database', available: false },
  { id: 'mariadb', label: 'MariaDB', desc: 'MySQL-compatible database', available: false },
  { id: 'mongodb', label: 'MongoDB', desc: 'Document NoSQL database', available: false },
  { id: 'redis', label: 'Redis', desc: 'In-memory key-value store', available: false },
]

export const TYPE_LABEL: Record<string, string> = Object.fromEntries(DB_CATALOG.map((d) => [d.id, d.label]))

// Full-screen "choose a database type" modal shown before the create form.
export default function DbTypePickerModal({ onClose, onPick }: { onClose: () => void; onPick: (typeId: string) => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade items-center justify-center bg-black/60 p-6 backdrop-blur-[3px]"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-[680px] animate-pop rounded-[16px] border border-edge-strong bg-panel p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[18px] font-bold">Create a new connection</h2>
            <p className="mt-1 text-[13px] text-ink-dim">Choose a database type to get started.</p>
          </div>
          <IconButton size="lg" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </IconButton>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3 max-[560px]:grid-cols-2 max-[400px]:grid-cols-1">
          {DB_CATALOG.map((db) => (
            <button
              key={db.id}
              disabled={!db.available}
              onClick={() => db.available && onPick(db.id)}
              className={`group relative flex flex-col items-start gap-3 rounded-card border p-4 text-left transition-all ${
                db.available
                  ? 'border-edge bg-card hover:-translate-y-px hover:border-edge-strong hover:bg-card-hover'
                  : 'cursor-not-allowed border-edge bg-card/40 opacity-60'
              }`}
            >
              {db.available ? (
                <DbLogo type={db.id} className="h-10 w-10" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-elevated text-ink-faint">
                  <DatabaseIcon />
                </div>
              )}
              <div>
                <div className="text-[13px] font-semibold">{db.label}</div>
                <div className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">{db.desc}</div>
              </div>
              {!db.available && (
                <span className="absolute right-3 top-3 rounded-[6px] border border-edge bg-elevated px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">
                  Soon
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

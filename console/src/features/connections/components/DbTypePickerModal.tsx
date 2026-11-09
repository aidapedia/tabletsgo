import { CloseIcon, DatabaseIcon, DbLogo } from '@/shared/ui/icons'
import { DB_CATALOG } from '@/shared/config/databaseTypes'
import { useModules } from '@/features/modules'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog'

export { DB_CATALOG, TYPE_LABEL } from '@/shared/config/databaseTypes'

// Full-screen "choose a database type" modal shown before the create form.
// An engine an instance admin turned off isn't offered at all (the server would
// refuse it anyway); the "Soon" placeholders stay, since nobody can turn those on.
export default function DbTypePickerModal({ onClose, onPick }: { onClose: () => void; onPick: (typeId: string) => void }) {
  const { isEnabled } = useModules()
  const offered = DB_CATALOG.filter((db) => !db.available || isEnabled(db.id))
  const someOff = offered.length < DB_CATALOG.length
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} aria-describedby={undefined} className="block sm:max-w-[680px] p-6 gap-0">
        <div className="flex items-start justify-between">
          <div>
            <DialogTitle className="text-[18px] font-bold">Create a new connection</DialogTitle>
            <p className="mt-1 text-[13px] text-muted-foreground">Choose a database type to get started.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </Button>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3 max-[560px]:grid-cols-2 max-[400px]:grid-cols-1">
          {offered.map((db) => (
            <button
              key={db.id}
              disabled={!db.available}
              onClick={() => db.available && onPick(db.id)}
              className={`group relative flex flex-col items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                db.available
                  ? 'border-border bg-card hover:-translate-y-px hover:border-input hover:bg-accent'
                  : 'cursor-not-allowed border-border bg-card/40 opacity-60'
              }`}
            >
              {db.available ? (
                <DbLogo type={db.id} className="h-10 w-10" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-muted text-faint">
                  <DatabaseIcon />
                </div>
              )}
              <div>
                <div className="text-[13px] font-semibold">{db.label}</div>
                <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{db.desc}</div>
              </div>
              {!db.available && (
                <span className="absolute right-3 top-3 rounded-[6px] border border-border bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-faint">
                  Soon
                </span>
              )}
            </button>
          ))}
        </div>
        {someOff && (
          <p className="mt-4 text-[11px] leading-relaxed text-faint">
            Don’t see your database? Your instance administrator chooses which databases are available.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

// The standard faint "Loading…" placeholder. Default is the centered list
// variant; override `className` for tighter/looser padding or inline use
// (e.g. className="" for a bare inline placeholder).
export default function LoadingState({ className = 'py-6 text-center' }: { className?: string }) {
  return <div className={`text-xs text-ink-faint ${className}`}>Loading…</div>
}

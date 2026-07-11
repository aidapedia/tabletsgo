// Initial bubble for a person (or any named thing): first letter of `label`
// in the brand-green tint. Sizes match the two variants used across the app.
const SIZES = {
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-7 w-7 text-[11px]',
}

export default function Avatar({ label, size = 'md', className = '' }: { label: string; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span className={`flex ${SIZES[size]} shrink-0 items-center justify-center rounded-full bg-green/15 font-bold text-green-bright ${className}`}>
      {label[0]?.toUpperCase()}
    </span>
  )
}

// A small dot in a folder's color. Used inline on table rows, in the folder
// picker, and on the schema-diagram region labels.
export default function FolderDot({ color, size = 8, className = '' }: { color?: string | null; size?: number; className?: string }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full ${className}`}
      style={{ width: size, height: size, backgroundColor: color || '#94a3b8' }}
    />
  )
}

import BoringAvatar from 'boring-avatars'

// A person's generated face. Nothing here is stored: the same seed always draws
// the same face, so seed with `name || email` everywhere — it is the one thing
// every list has, and a person has to look the same in all of them.
//
// Hex, not theme tokens: the library parses these to pick the face's contrast
// colour. It is the accent swatches minus green and red, which read as status,
// and it deliberately doesn't follow `--accent` — a face that changed with the
// workspace's colour would stop being recognisable.
const PALETTE = ['#2dd4bf', '#4aa8ff', '#6c7cff', '#b98cff', '#e5c454', '#ff9d4a', '#ec4899']

// Always drawn square and filling its parent: the parent owns size and shape,
// which is what lets the round bubble and `AccountTile` share one face.
export function PersonFace({ seed }: { seed: string }) {
  return <BoringAvatar name={seed} variant="beam" colors={PALETTE} size="100%" square className="block" />
}

// Same two sizes as `Avatar`, which stays the bubble for things that aren't
// people (workspaces, groups).
const SIZES = {
  sm: 'h-6 w-6',
  md: 'h-7 w-7',
}

export default function PersonAvatar({ seed, size = 'md', className = '' }: { seed: string; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span className={`block ${SIZES[size]} shrink-0 overflow-hidden rounded-full ${className}`}>
      <PersonFace seed={seed} />
    </span>
  )
}

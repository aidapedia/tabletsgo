import { forwardRef } from 'react'
import type { InputHTMLAttributes } from 'react'
import { SearchIcon } from '@/shared/ui/icons'
import { Input } from '@/shared/ui/form/Input'

// Text input with a leading search icon. `className` styles the wrapper,
// `inputClassName` is appended to the input (use `!` utilities to override the
// base field look); everything else forwards to the underlying <Input>.
type Props = InputHTMLAttributes<HTMLInputElement> & {
  inputClassName?: string
  iconSize?: number
}

const SearchInput = forwardRef<HTMLInputElement, Props>(function SearchInput(
  { className = '', inputClassName = '', iconSize = 15, ...props },
  ref
) {
  return (
    <div className={`relative ${className}`}>
      <SearchIcon
        width={iconSize}
        height={iconSize}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
      />
      <Input ref={ref} className={`!pl-8 ${inputClassName}`} {...props} />
    </div>
  )
})

export default SearchInput

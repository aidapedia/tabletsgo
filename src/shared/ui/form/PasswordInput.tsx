import { forwardRef, useState } from 'react'
import type { InputHTMLAttributes } from 'react'
import { EyeIcon, EyeOffIcon } from '@/shared/ui/icons'
import TextButton from '@/shared/ui/buttons/TextButton'
import { Input } from './Input'

/**
 * Password field with a reveal toggle.
 *
 * A drop-in for `<Input type="password" />` — every prop forwards to the
 * underlying input, so callers keep passing `value`/`onChange`/`placeholder`/
 * `autoComplete` exactly as before. The type flips between `password` and
 * `text`; nothing about the value changes, so a form never has to know.
 *
 * `className` styles the input (the wrapper only positions the toggle), and
 * `wrapperClassName` is there for the rare caller that needs to size the field
 * itself. The toggle is a real focusable button — someone who can't see the
 * dots is exactly who needs it — and `TextButton` is `type="button"`, so it
 * never submits the form it sits in.
 */
type Props = InputHTMLAttributes<HTMLInputElement> & { wrapperClassName?: string }

const PasswordInput = forwardRef<HTMLInputElement, Props>(function PasswordInput(
  { className = '', wrapperClassName = '', ...props },
  ref
) {
  const [shown, setShown] = useState(false)

  return (
    <div className={`relative ${wrapperClassName}`}>
      <Input ref={ref} type={shown ? 'text' : 'password'} className={`!pr-10 ${className}`} {...props} />
      <TextButton
        tone="faint"
        className="absolute right-3 top-1/2 -translate-y-1/2"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
      >
        {shown ? <EyeOffIcon width={15} height={15} /> : <EyeIcon width={15} height={15} />}
      </TextButton>
    </div>
  )
})

export default PasswordInput

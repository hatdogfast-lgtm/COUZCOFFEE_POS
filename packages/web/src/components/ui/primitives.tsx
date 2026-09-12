import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils.ts'

/**
 * Interface primitives.
 *
 * Sized for a counter: the default control is 44px tall, which is the smallest
 * target a barista can hit reliably while holding a jug of milk. Nothing here
 * is smaller unless it is purely decorative.
 *
 * The palette's rules live here so the screens do not have to know them: the
 * primary button is dark text on Caramel because Caramel cannot carry light
 * text; a warning badge is dark text on Honey for the same reason; and a card
 * has an edge because cream on milk is invisible without one.
 */

const buttonStyles = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold no-select press disabled:pointer-events-none disabled:opacity-45 transition-colors',
  {
    variants: {
      variant: {
        /** The one action on the screen: Caramel, dark ink. */
        primary: 'bg-accent text-accent-ink hover:bg-accent/90',
        /** Espresso. For chrome-adjacent actions and the odd second emphasis. */
        strong: 'bg-brand text-brand-ink hover:bg-brand/90',
        secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-sunken',
        outline: 'border border-line-strong bg-transparent text-ink hover:bg-surface-sunken',
        ghost: 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
        danger: 'bg-danger text-danger-ink hover:bg-danger/90',
        positive: 'bg-positive text-positive-ink hover:bg-positive/90',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-11 px-4 text-[0.9375rem]',
        lg: 'h-14 px-6 text-base',
        xl: 'h-16 px-8 text-lg',
        icon: 'h-11 w-11',
      },
      full: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', full: false },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonStyles> {
  asChild?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, full, asChild = false, ...props }, ref) => {
    const Component = asChild ? Slot : 'button'
    return (
      <Component ref={ref} className={cn(buttonStyles({ variant, size, full }), className)} {...props} />
    )
  },
)
Button.displayName = 'Button'

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('rounded-lg border border-line bg-surface', className)} {...props} />
  ),
)
Card.displayName = 'Card'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-11 w-full rounded-md border border-line-strong bg-surface px-3.5 text-[0.9375rem] text-ink',
        'placeholder:text-ink-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25',
        'disabled:opacity-50 transition-colors',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

/** The letterspaced micro-label: section headings, chip text, the odd caption. */
export function Micro({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('micro block text-ink-subtle', className)}>{children}</span>
}

/** A money figure or a count. Monospaced and tabular, so a column never re-flows. */
export function Money({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('figure', className)}>{children}</span>
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string
  hint?: string
  error?: string | null
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <Micro>{label}</Micro>
      {children}
      {error ? (
        <span className="block text-[0.8125rem] text-danger">{error}</span>
      ) : hint ? (
        <span className="block text-[0.8125rem] text-ink-subtle">{hint}</span>
      ) : null}
    </label>
  )
}

const badgeStyles = cva('micro inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5', {
  variants: {
    tone: {
      neutral: 'bg-surface-sunken text-ink-muted',
      brand: 'bg-brand-soft text-brand',
      /** A 10% tint at most: Matcha clears AA on cream by only 0.28. */
      online: 'bg-positive/10 text-positive',
      pending: 'bg-honey text-honey-ink',
      /** Honey cannot carry light text, so the chip is solid with dark ink. */
      warning: 'bg-honey text-honey-ink',
      danger: 'bg-danger text-danger-ink',
      offline: 'bg-ink-subtle/15 text-ink-muted',
    },
  },
  defaultVariants: { tone: 'neutral' },
})

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeStyles> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeStyles({ tone }), className)} {...props} />
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      {icon ? <div className="text-ink-subtle">{icon}</div> : null}
      <div className="space-y-1">
        <p className="font-medium text-ink">{title}</p>
        {description ? <p className="max-w-sm text-sm text-ink-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

/** A large, unmissable figure - the kind a cashier reads at a glance. */
export function Figure({
  label,
  value,
  tone = 'default',
  className,
}: {
  label: string
  value: string
  tone?: 'default' | 'brand' | 'positive' | 'danger'
  className?: string
}) {
  const toneClass = {
    default: 'text-ink',
    brand: 'text-brand',
    positive: 'text-positive',
    danger: 'text-danger',
  }[tone]

  return (
    <div className={cn('space-y-1', className)}>
      <Micro>{label}</Micro>
      <p className={cn('figure text-2xl font-semibold', toneClass)}>{value}</p>
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('h-4 w-4 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" className="opacity-20" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

const SHEET_SIZES = { sm: 'sm:max-w-sm', md: 'sm:max-w-md', lg: 'sm:max-w-lg' } as const

/**
 * The one dialog frame.
 *
 * A bottom sheet on a phone, because that is where a thumb is; centred on a
 * tablet or laptop, or docked to the right edge for something you keep
 * open while reading the screen behind it. The header and footer stay put
 * and the body scrolls, so the action is never below the fold.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  placement = 'center',
  dismissible = true,
  closeDisabled = false,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: keyof typeof SHEET_SIZES
  /** `side` docks to the right edge on a tablet or laptop instead of centring. */
  placement?: 'center' | 'side'
  /** Whether tapping the scrim or pressing Escape closes it. */
  dismissible?: boolean
  closeDisabled?: boolean
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && dismissible && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40 animate-fade-in" />
        <Dialog.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col rounded-t-2xl border-t border-line-strong bg-surface shadow-overlay animate-slide-up',
            placement === 'center'
              ? cn('sm:inset-0 sm:m-auto sm:h-fit sm:rounded-2xl sm:border sm:animate-scale-in', SHEET_SIZES[size])
              : 'sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-[26rem] sm:rounded-none sm:rounded-l-2xl sm:border-l sm:border-t-0 sm:animate-slide-in-right',
          )}
        >
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4 sm:pad-safe-top">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-[1.0625rem] font-semibold text-ink">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 line-clamp-2 text-sm text-ink-muted">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close" disabled={closeDisabled}>
                <X className="h-5 w-5" aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="scroll-pane min-h-0 flex-1 px-5 py-5">{children}</div>

          {footer ? (
            <footer className="shrink-0 border-t border-line px-5 py-4 pad-safe-bottom">{footer}</footer>
          ) : (
            <div className="pad-safe-bottom" />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

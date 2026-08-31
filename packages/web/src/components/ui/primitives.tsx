import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils.ts'

/**
 * Interface primitives.
 *
 * Sized for a counter: the default control is 44px tall, which is the smallest
 * target a barista can hit reliably while holding a jug of milk. Nothing here
 * is smaller unless it is purely decorative.
 */

const buttonStyles = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium no-select press disabled:pointer-events-none disabled:opacity-45 transition-colors',
  {
    variants: {
      variant: {
        primary: 'bg-brand text-brand-ink hover:bg-brand/90 shadow-sm',
        secondary: 'bg-surface-sunken text-ink hover:bg-line/60 border border-line',
        outline: 'border border-line-strong bg-transparent text-ink hover:bg-surface-sunken',
        ghost: 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
        danger: 'bg-danger text-danger-ink hover:bg-danger/90 shadow-sm',
        positive: 'bg-positive text-white hover:bg-positive/90 shadow-sm',
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
    <div ref={ref} className={cn('rounded-2xl border border-line bg-surface shadow-card', className)} {...props} />
  ),
)
Card.displayName = 'Card'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-[0.9375rem] text-ink',
        'placeholder:text-ink-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25',
        'disabled:opacity-50 transition-colors',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

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
      <span className="text-[0.8125rem] font-medium text-ink-muted">{label}</span>
      {children}
      {error ? (
        <span className="block text-[0.8125rem] text-danger">{error}</span>
      ) : hint ? (
        <span className="block text-[0.8125rem] text-ink-subtle">{hint}</span>
      ) : null}
    </label>
  )
}

const badgeStyles = cva('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', {
  variants: {
    tone: {
      neutral: 'bg-surface-sunken text-ink-muted',
      brand: 'bg-brand-soft text-brand',
      online: 'bg-positive/12 text-positive',
      pending: 'bg-warning/12 text-warning',
      warning: 'bg-warning/12 text-warning',
      danger: 'bg-danger/12 text-danger',
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
    <div className={cn('space-y-0.5', className)}>
      <p className="text-[0.8125rem] text-ink-muted">{label}</p>
      <p className={cn('tabular text-2xl font-semibold tracking-tight', toneClass)}>{value}</p>
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

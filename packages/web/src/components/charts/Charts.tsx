import { useState, type ReactNode } from 'react'
import { cn } from '../../lib/utils.ts'

/**
 * Charts.
 *
 * Built from ordinary elements rather than a charting library: these are two
 * simple forms, and a dependency would cost more than it saves while making
 * the marks harder to control.
 *
 * Every chart here plots a single series, so none carries a legend - the
 * heading already says what is plotted. Marks follow one set of specs: capped
 * thickness, a rounded data-end squared off at the baseline, a 2px surface gap
 * between neighbours, hairline gridlines, and labels only where they earn
 * their place. Colour is a single validated hue; the text stays in text
 * tokens so nothing legible is carried by hue alone.
 */

interface Point {
  label: string
  value: number
  secondary?: string
}

/** Round an axis maximum up to something a person would actually say. */
function niceCeiling(value: number): number {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalised = value / magnitude
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10
  return step * magnitude
}

export function ColumnChart({
  points,
  formatValue,
  formatExact,
  emptyMessage = 'Nothing recorded in this period.',
  height = 176,
}: {
  points: Point[]
  /** Axis ticks, where a compact form keeps the labels readable. */
  formatValue: (value: number) => string
  /** The tooltip, which is where someone goes for the precise figure. */
  formatExact?: (value: number) => string
  emptyMessage?: string
  height?: number
}) {
  const exact = formatExact ?? formatValue
  const [hovered, setHovered] = useState<number | null>(null)

  const max = Math.max(...points.map((point) => point.value), 0)
  if (points.length === 0 || max <= 0) {
    return (
      <div
        className="flex items-center justify-center rounded-xl bg-surface-sunken text-sm text-ink-subtle"
        style={{ height }}
      >
        {emptyMessage}
      </div>
    )
  }

  const ceiling = niceCeiling(max)
  const peakIndex = points.reduce((best, point, index) => (point.value > (points[best]?.value ?? 0) ? index : best), 0)

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        {/* Axis ticks carry the values that are not directly labelled. */}
        <div
          className="flex w-12 shrink-0 flex-col justify-between py-0.5 text-right text-[0.6875rem] text-ink-subtle tabular"
          style={{ height }}
          aria-hidden="true"
        >
          <span>{formatValue(ceiling)}</span>
          <span>{formatValue(ceiling / 2)}</span>
          <span>0</span>
        </div>

        <div className="relative min-w-0 flex-1" style={{ height }}>
          {/* Hairline gridlines, one step off the surface and recessive. */}
          <div className="absolute inset-0" aria-hidden="true">
            {[0, 0.5, 1].map((fraction) => (
              <div
                key={fraction}
                className="absolute inset-x-0 border-t border-line"
                style={{ top: `${fraction * 100}%` }}
              />
            ))}
          </div>

          <div className="absolute inset-0 flex items-end gap-[2px]">
            {points.map((point, index) => {
              const fraction = point.value / ceiling
              const isHovered = hovered === index
              return (
                <div
                  key={`${point.label}-${index}`}
                  className="group relative flex h-full min-w-0 flex-1 items-end justify-center"
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(index)}
                  onBlur={() => setHovered(null)}
                  tabIndex={0}
                  role="img"
                  aria-label={`${point.label}: ${formatValue(point.value)}`}
                >
                  {/* A full-height hit area, so the target is far bigger than
                      the mark it selects. */}
                  <div className="absolute inset-0 rounded-sm transition-colors group-hover:bg-ink/[0.04] group-focus:bg-ink/[0.04]" />

                  <div
                    className={cn(
                      'relative w-full max-w-[24px] rounded-t-[4px] bg-chart transition-opacity',
                      hovered !== null && !isHovered && 'opacity-55',
                    )}
                    style={{ height: `${Math.max(fraction * 100, point.value > 0 ? 1.5 : 0)}%` }}
                  />

                  {isHovered ? (
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-raised">
                      <span className="block font-medium text-ink tabular">{exact(point.value)}</span>
                      <span className="block text-ink-subtle">{point.label}</span>
                      {point.secondary ? (
                        <span className="block text-ink-subtle">{point.secondary}</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Sparse tick labels: every column labelled would be unreadable. */}
      <div className="flex gap-[2px] pl-14">
        {points.map((point, index) => {
          const step = Math.ceil(points.length / 8)
          const show = index % step === 0 || index === peakIndex
          return (
            <span
              key={`${point.label}-tick-${index}`}
              className={cn(
                'min-w-0 flex-1 truncate text-center text-[0.6875rem]',
                index === peakIndex ? 'font-medium text-ink-muted' : 'text-ink-subtle',
              )}
            >
              {show ? point.label : ' '}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export interface BarRow {
  key: string
  label: string
  sublabel?: string
  value: number
  display: string
  trailing?: ReactNode
}

/**
 * A ranked list with a bar behind each value.
 *
 * This is a table and a chart at once - every number is present as text, so
 * the bars are a reading aid rather than the only way to get the data. That
 * also means it needs no separate table view to stay accessible.
 */
export function BarList({
  rows,
  emptyMessage = 'Nothing to show yet.',
}: {
  rows: BarRow[]
  emptyMessage?: string
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-subtle">{emptyMessage}</p>
  }

  const max = Math.max(...rows.map((row) => row.value), 0)

  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.key} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm text-ink">
              {row.label}
              {row.sublabel ? <span className="text-ink-subtle"> · {row.sublabel}</span> : null}
            </span>
            <span className="flex shrink-0 items-baseline gap-2">
              {row.trailing}
              <span className="tabular text-sm font-medium text-ink">{row.display}</span>
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-chart-track">
            <div
              className="h-full rounded-full bg-chart"
              style={{ width: `${max > 0 ? Math.max((row.value / max) * 100, 1) : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * A headline figure.
 *
 * The dashboard leads with numbers, not charts: a single current value is a
 * stat tile's job, and a one-bar chart would say less in more space.
 */
export function StatTile({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string
  value: string
  detail?: string
  tone?: 'default' | 'positive' | 'danger'
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3.5">
      <p className="text-[0.8125rem] text-ink-muted">{label}</p>
      {/* Proportional figures, not tabular: equal-width digits make a large
          standalone number look loose. Tabular is for columns that align. */}
      <p
        className={cn(
          'mt-0.5 text-2xl font-semibold tracking-tight',
          tone === 'positive' ? 'text-positive' : tone === 'danger' ? 'text-danger' : 'text-ink',
        )}
      >
        {value}
      </p>
      {detail ? <p className="mt-0.5 text-[0.8125rem] text-ink-subtle">{detail}</p> : null}
    </div>
  )
}

/** The one number the dashboard leads with. */
export function HeroFigure({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: ReactNode
}) {
  return (
    <div>
      <p className="text-[0.8125rem] text-ink-muted">{label}</p>
      <p className="text-[2.75rem] font-semibold leading-none tracking-tight text-ink">{value}</p>
      {detail ? <div className="mt-1.5 text-sm text-ink-muted">{detail}</div> : null}
    </div>
  )
}

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Every colour resolves through a CSS variable so the owner's brand
        // settings can repaint the light theme at runtime without a rebuild.
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-raised': 'rgb(var(--surface-raised) / <alpha-value>)',
        'surface-sunken': 'rgb(var(--surface-sunken) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        'line-strong': 'rgb(var(--line-strong) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        'ink-muted': 'rgb(var(--ink-muted) / <alpha-value>)',
        'ink-subtle': 'rgb(var(--ink-subtle) / <alpha-value>)',
        brand: 'rgb(var(--brand) / <alpha-value>)',
        'brand-ink': 'rgb(var(--brand-ink) / <alpha-value>)',
        'brand-soft': 'rgb(var(--brand-soft) / <alpha-value>)',
        'brand-light': 'rgb(var(--brand-light) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-ink': 'rgb(var(--accent-ink) / <alpha-value>)',
        chrome: 'rgb(var(--chrome) / <alpha-value>)',
        'chrome-ink': 'rgb(var(--chrome-ink) / <alpha-value>)',
        'chrome-muted': 'rgb(var(--chrome-muted) / <alpha-value>)',
        chart: 'rgb(var(--chart) / <alpha-value>)',
        'chart-track': 'rgb(var(--chart-track) / <alpha-value>)',
        positive: 'rgb(var(--positive) / <alpha-value>)',
        'positive-ink': 'rgb(var(--positive-ink) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        honey: 'rgb(var(--honey) / <alpha-value>)',
        'honey-ink': 'rgb(var(--honey-ink) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        'danger-ink': 'rgb(var(--danger-ink) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['IBM Plex Sans', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        display: ['Fraunces Variable', 'Fraunces', 'Georgia', 'Times New Roman', 'serif'],
      },
      // Counter: 6px on the things you tap at a rush, a little more on the
      // things you read. The old 14/18/24px corners read as a consumer app.
      borderRadius: {
        xl: '10px',
        '2xl': '12px',
        '3xl': '16px',
      },
      // Hairlines, not elevation. Only something that floats gets a shadow.
      boxShadow: {
        card: '0 1px 0 rgb(59 36 22 / 0.05)',
        raised: '0 1px 2px rgb(59 36 22 / 0.06), 0 8px 24px -12px rgb(59 36 22 / 0.25)',
        overlay: '0 24px 64px -12px rgb(36 24 18 / 0.45)',
      },
      transitionTimingFunction: {
        swift: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'scale-in': 'scale-in 160ms cubic-bezier(0.32, 0.72, 0, 1)',
        'slide-up': 'slide-up 200ms cubic-bezier(0.32, 0.72, 0, 1)',
        'slide-in-right': 'slide-in-right 240ms cubic-bezier(0.32, 0.72, 0, 1)',
      },
    },
  },
  plugins: [],
}

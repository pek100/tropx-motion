import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './electron/renderer/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      spacing: {
        'page': '1rem',      // Mobile page margin (16px)
        'page-sm': '2rem',   // Desktop page margin (32px) - use with sm:px-page-sm
      },
      colors: {
        // Standard shadcn/ui colors with HSL format for Tailwind v3 opacity modifiers
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
        // Tropx brand colors
        'tropx-original': 'var(--tropx-original)',
        'tropx-sand': 'var(--tropx-sand)',
        'tropx-coral': 'var(--tropx-coral)',
        'tropx-ivory-blue': 'var(--tropx-ivory-blue)',
        'tropx-ivory': 'var(--tropx-ivory)',
        'tropx-shadow': 'var(--tropx-shadow)',
        'tropx-dark': 'var(--tropx-dark)',
        'tropx-ivory-dark': 'var(--tropx-ivory-dark)',
        'tropx-coral-translucent': 'var(--tropx-coral-translucent)',
        'tropx-vibrant': 'var(--tropx-vibrant)',
        'tropx-white': 'var(--tropx-white)',
        'tropx-green': 'var(--tropx-green)',
        'tropx-red': 'var(--tropx-red)',
        // Status semantic colors (for alerts, badges, etc.)
        'status-success': {
          bg: 'var(--tropx-success-bg)',
          text: 'var(--tropx-success-text)',
        },
        'status-warning': {
          bg: 'var(--tropx-warning-bg)',
          text: 'var(--tropx-warning-text)',
        },
        'status-info': {
          bg: 'var(--tropx-info-bg)',
          text: 'var(--tropx-info-text)',
        },
        'status-error': {
          bg: 'hsl(var(--destructive) / 0.1)',
          text: 'hsl(var(--destructive))',
        },
        // Leg colors for bilateral comparisons
        'leg-left': {
          fill: 'var(--leg-left-fill)',
          band: 'var(--leg-left-band)',
        },
        'leg-right': {
          fill: 'var(--leg-right-fill)',
          band: 'var(--leg-right-band)',
        },
        'leg-gray': {
          fill: 'var(--leg-gray-fill)',
          band: 'var(--leg-gray-band)',
        },
        'leg-purple': {
          fill: 'var(--leg-purple-fill)',
          band: 'var(--leg-purple-band)',
        },
        // Additional accent colors
        'tropx-purple': 'var(--tropx-purple)',
        // Horus domain colors (for metrics visualization)
        'domain': {
          range: 'var(--domain-range)',
          symmetry: 'var(--domain-symmetry)',
          power: 'var(--domain-power)',
          control: 'var(--domain-control)',
          timing: 'var(--domain-timing)',
        },
        // Axis colors (for multi-axis chart visualization)
        'axis': {
          x: 'var(--axis-x)',
          y: 'var(--axis-y)',
          z: 'var(--axis-z)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'pulsate-color': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.3' },
        },
        'pulsate-scale': {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.15)' },
        },
        'flash-border': {
          '0%, 100%': {
            'border-color': '#e5e5e5',
            'box-shadow': '0 0 0 0 rgba(255, 77, 53, 0)',
          },
          '50%': {
            'border-color': 'var(--tropx-vibrant)',
            'box-shadow': '0 0 20px 5px rgba(255, 77, 53, 0.3)',
          },
        },
        'smooth-spin': {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(360deg)' },
        },
        vibrate: {
          '0%, 100%': { transform: 'translateX(0)' },
          '10%, 30%, 50%, 70%, 90%': { transform: 'translateX(-4px)' },
          '20%, 40%, 60%, 80%': { transform: 'translateX(4px)' },
        },
        'visor-scan': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(800px)' },
        },
        'marquee': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        'pulsate-color': 'pulsate-color 1s ease-in-out infinite',
        'pulsate-scale': 'pulsate-scale 1s ease-in-out infinite',
        'flash-border': 'flash-border 0.5s ease-in-out 2',
        'smooth-spin': 'smooth-spin 1s linear infinite',
        vibrate: 'vibrate 0.5s ease-in-out infinite',
        'visor-scan': 'visor-scan 2.5s ease-in-out infinite',
        'marquee': 'marquee 10s linear infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config

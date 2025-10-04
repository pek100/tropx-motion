import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './electron/renderer/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
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
      },
      animation: {
        'pulsate-color': 'pulsate-color 1s ease-in-out infinite',
        'pulsate-scale': 'pulsate-scale 1s ease-in-out infinite',
        'flash-border': 'flash-border 0.5s ease-in-out 2',
        'smooth-spin': 'smooth-spin 1s linear infinite',
        vibrate: 'vibrate 0.5s ease-in-out infinite',
        'visor-scan': 'visor-scan 2.5s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config

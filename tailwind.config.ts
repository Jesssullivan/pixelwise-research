export default {
  darkMode: 'class',
  content: [
    './src/**/*.{html,js,svelte,ts,md,svx}',
    './node_modules/@skeletonlabs/skeleton-svelte/**/*.{html,js,svelte,ts}'
  ],
  theme: {
    extend: {
        fontFamily: {
        sans: ['Fira Sans', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['Fira Code', 'Courier New', 'monospace'],
      },
      backdropBlur: {
        xs: '2px',
        sm: '4px',
        md: '12px',
        lg: '16px',
        xl: '24px',
        '2xl': '40px',
      },
      animation: {
        'shimmer-loading': 'shimmer-loading 1.5s infinite',
      },
      keyframes: {
        'shimmer-loading': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' }
        }
      }
    }
  },
  plugins: []
};

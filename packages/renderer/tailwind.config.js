/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: {
          bg: '#141416',
          dot: '#2d2e33',
          line: '#1c1d22',
        },
        mindagentics: {
          dark: '#0f1012',
          surface: '#18191c',
          border: '#2a2b30',
          accent: '#3b82f6',
        },
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: {
          bg: '#0E0F12',
          dot: '#23262C',
          line: '#23262C',
        },
        mindagentics: {
          dark: '#0E0F12',
          sidebar: '#121418',
          surface: '#14161A',
          surfaceSecondary: '#181B20',
          border: '#23262C',
          accent: '#8B93FF',
          status: '#5FD3A0',
          text: '#E7E8EA',
          textSecondary: '#8A8F98',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
      borderRadius: {
        '10': '10px',
        '14': '14px',
        '20': '20px',
      },
    },
  },
  plugins: [],
};

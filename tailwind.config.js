/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0b0f14',
          900: '#10161d',
          800: '#182129',
          700: '#212c36',
          600: '#33414d',
          400: '#7c8b98',
          200: '#c9d3db'
        },
        gold: {
          500: '#c9a24b',
          400: '#d9b869'
        }
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        serif: ['Georgia', 'serif']
      }
    }
  },
  plugins: []
}

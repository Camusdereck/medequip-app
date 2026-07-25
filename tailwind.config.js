/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./*.{html,js}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
        display: ['Space Grotesk', 'sans-serif']
      },
      colors: {
        medical: {
          50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 500: '#3b82f6',
          600: '#2563EB', 700: '#1d4ed8', 900: '#1e3a8a'
        }
      }
    }
  },
  plugins: [],
}
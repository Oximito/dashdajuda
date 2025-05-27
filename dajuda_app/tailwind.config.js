/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'custom-pink': '#FF69B4', // Exemplo de cor rosa, ajustar conforme necessário
      }
    },
  },
  plugins: [],
}

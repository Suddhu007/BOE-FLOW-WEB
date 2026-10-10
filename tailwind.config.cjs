/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      colors: {
        brand: {
          50: "#f0fdf9", 100: "#ccfbef", 200: "#9df6e1", 300: "#5eead4",
          400: "#2dd4bf", 500: "#0aa79a", 600: "#0b6b58", 700: "#085344",
          800: "#064237", 900: "#032a23", dark: "#08332b",
        },
      },
      boxShadow: {
        glow: "0 0 45px -10px rgba(10, 167, 154, 0.3)",
        card: "0 12px 32px -6px rgba(11, 107, 88, 0.08)",
        deep: "0 24px 50px -12px rgba(6, 66, 55, 0.22)",
      },
    },
  },
  plugins: [],
};

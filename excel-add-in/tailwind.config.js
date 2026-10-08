import colors from "tailwindcss/colors";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./commands.html",
    "./src/**/*.{js,jsx,ts,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        grey: { ...colors.zinc, 750: "#2f2f37" },
        dark: {
          400: "#46464f",
          500: "#3a3a42",
          600: "#34343b",
          750: "#2a2a31",
          800: "#212127",
          900: "#151518",
        },
        light: { 50: colors.slate[50] },
        "light-blue": colors.sky,
        success: colors.green,
      },
    },
  },
};

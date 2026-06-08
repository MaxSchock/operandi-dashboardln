import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Operandi palette (subset of brand-context/visual)
        navy: "#01102D",
        electric: "#1C68FA",
      },
      fontFamily: {
        display: ["Funnel Display", "Inter", "ui-sans-serif", "system-ui"],
        sans: ["Funnel Sans", "Inter", "ui-sans-serif", "system-ui"],
      },
    },
  },
  plugins: [],
} satisfies Config;

import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {extend: {colors: {brand: {50: "#eef4ff", 500: "#3568f6", 600: "#2657db"}}}},
  plugins: []
} satisfies Config;

import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["var(--font-sans)", "system-ui", "sans-serif"], display: ["var(--font-display)", "system-ui", "sans-serif"] },
      colors: {
        brand: { 50: "#fff7ed", 100: "#ffedd5", 300: "#fdba74", 400: "#fb923c", 500: "#f97316", 600: "#ea580c", 700: "#c2410c" },
        ink: { 50: "#f6f7fb", 100: "#e9ecf5", 200: "#d2d8ea", 300: "#aab4d0", 500: "#5f6b8a", 700: "#2f3a57", 800: "#1f2a44", 900: "#141b2e", 950: "#0b1020" },
      },
      keyframes: {
        pop: { "0%": { transform: "scale(.6)", opacity: "0" }, "70%": { transform: "scale(1.08)", opacity: "1" }, "100%": { transform: "scale(1)" } },
        rise: { "0%": { transform: "translateY(12px)", opacity: "0" }, "100%": { transform: "translateY(0)", opacity: "1" } },
        pulseRing: { "0%": { boxShadow: "0 0 0 0 rgba(249,115,22,.6)" }, "100%": { boxShadow: "0 0 0 14px rgba(249,115,22,0)" } },
        drift: { "0%": { transform: "translateX(-10%)" }, "100%": { transform: "translateX(110%)" } },
      },
      animation: { pop: "pop .45s cubic-bezier(.2,.9,.3,1.3) both", rise: "rise .4s ease-out both", pulseRing: "pulseRing 1.2s ease-out infinite", drift: "drift 90s linear infinite" },
    },
  },
  plugins: [],
} satisfies Config;

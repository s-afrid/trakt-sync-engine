import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // ── Harbor design tokens (mirrors harbor-core `@theme`) ──
      colors: {
        canvas:        "rgb(var(--color-canvas) / <alpha-value>)",
        surface:       "rgb(var(--color-surface) / <alpha-value>)",
        elevated:      "rgb(var(--color-elevated) / <alpha-value>)",
        raised:        "rgb(var(--color-raised) / <alpha-value>)",
        ink:           "rgb(var(--color-ink) / <alpha-value>)",
        "ink-muted":   "rgb(var(--color-ink-muted) / <alpha-value>)",
        "ink-subtle":  "rgb(var(--color-ink-subtle) / <alpha-value>)",
        edge:          "rgb(var(--color-edge) / <alpha-value>)",
        "edge-soft":   "rgb(var(--color-edge-soft) / <alpha-value>)",
        accent:        "rgb(var(--color-accent) / <alpha-value>)",
        "accent-soft": "rgb(var(--color-accent-soft) / <alpha-value>)",
        danger:        "rgb(var(--color-danger) / <alpha-value>)",
        success:       "rgb(var(--color-success) / <alpha-value>)",
        // Platform colours
        trakt:      { red: "#ED1C24", dark: "#1A0506" },
        mal:        { blue: "#2E51A2", dark: "#0C1427" },
        letterboxd: { green: "#00E054", orange: "#FF8000", blue: "#40BCF4", dark: "#14181C" },
      },
      borderRadius: {
        sm:    "6px",
        DEFAULT: "10px",
        md:    "10px",
        lg:    "14px",
        xl:    "20px",
        "2xl": "28px",
        full:  "9999px",
      },
      fontFamily: {
        sans:    ["Switzer", "Inter", "system-ui", "sans-serif"],
        display: ["Sentient", "Iowan Old Style", "Georgia", "serif"],
        mono:    ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      transitionTimingFunction: {
        "ease-out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
      },

    },
  },
  plugins: [],
};

export default config;

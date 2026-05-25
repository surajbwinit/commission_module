import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        // shadcn semantic tokens — nested DEFAULT structure
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        border:     "hsl(var(--border))",
        input:      "hsl(var(--input))",
        ring:       "hsl(var(--ring))",
        card: {
          DEFAULT:    "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT:    "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT:    "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          // Numeric scale (violet) kept for back-compat with existing `bg-primary-50` etc.
          50:  "#f5f3ff",
          100: "#ede9fe",
          200: "#ddd6fe",
          300: "#c4b5fd",
          400: "#a78bfa",
          500: "#8b5cf6",
          600: "#7c3aed",
          700: "#6d28d9",
          800: "#5b21b6",
          900: "#4c1d95",
        },
        secondary: {
          DEFAULT:    "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT:    "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT:    "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT:    "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },

        // Legacy aliases (RGB tokens) so older class names keep working
        app:      "rgb(var(--app) / <alpha-value>)",
        surface:  "rgb(var(--surface) / <alpha-value>)",
        sunken:   "rgb(var(--sunken) / <alpha-value>)",
        overlay:  "rgb(var(--overlay) / <alpha-value>)",
        line:     "rgb(var(--line) / <alpha-value>)",
        "line-strong": "rgb(var(--line-strong) / <alpha-value>)",
        fg:       "rgb(var(--fg) / <alpha-value>)",
        "fg-muted":  "rgb(var(--fg-muted) / <alpha-value>)",
        "fg-subtle": "rgb(var(--fg-subtle) / <alpha-value>)",

        // Violet primary scale (the shadcn "violet" theme primary)
        // Numbered scale kept because parts of the app use e.g. "primary-50" directly.
        // We override the named `primary` above (it points at HSL var). To still allow
        // shaded utility classes, declare them under a separate key `brand`.
        brand: {
          50:  "#f5f3ff",
          100: "#ede9fe",
          200: "#ddd6fe",
          300: "#c4b5fd",
          400: "#a78bfa",
          500: "#8b5cf6",
          600: "#7c3aed",
          700: "#6d28d9",
          800: "#5b21b6",
          900: "#4c1d95",
        },

        // Zinc neutral scale (shadcn default neutral). Existing `neutral-XXX` utilities
        // will resolve via this scale (overriding Tailwind's default slate-leaning one).
        neutral: {
          50:  "#fafafa",
          100: "#f4f4f5",
          200: "#e4e4e7",
          300: "#d4d4d8",
          400: "#a1a1aa",
          500: "#71717a",
          600: "#52525b",
          700: "#3f3f46",
          800: "#27272a",
          900: "#18181b",
          950: "#09090b",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        serif: ["var(--font-serif)", "Instrument Serif", "ui-serif", "Georgia", "serif"],
        display: ["var(--font-serif)", "Instrument Serif", "ui-serif", "Georgia", "serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        // shadcn-style subtle shadows
        sm:   "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        DEFAULT: "0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.06)",
        md:   "0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06)",
        lg:   "0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.05)",
        xl:   "0 20px 25px -5px rgb(0 0 0 / 0.08), 0 8px 10px -6px rgb(0 0 0 / 0.05)",
        // Legacy aliases
        "card":     "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        "card-lg":  "0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06)",
        "card-xl":  "0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.05)",
        "glow":     "0 0 0 4px hsl(var(--ring) / 0.18)",
      },
      backgroundImage: {
        "premium-mesh":  "radial-gradient(at 0% 0%, hsl(var(--primary) / 0.06) 0%, transparent 50%), radial-gradient(at 100% 100%, hsl(var(--primary) / 0.04) 0%, transparent 50%)",
        "subtle-grid":   "linear-gradient(hsl(var(--foreground) / 0.03) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground) / 0.03) 1px, transparent 1px)",
      },
      backgroundSize: {
        "grid-md":   "32px 32px",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up":   { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
        "fade-in":       { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        "fade-in-up":    { "0%": { opacity: "0", transform: "translateY(6px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        "slide-down":    { "0%": { opacity: "0", transform: "translateY(-4px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        "scale-in":      { "0%": { opacity: "0", transform: "scale(0.97)" }, "100%": { opacity: "1", transform: "scale(1)" } },
        "shimmer":       { "100%": { backgroundPosition: "-200% 0" } },
        "pulse-soft":    { "0%, 100%": { opacity: "1" }, "50%": { opacity: "0.55" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up":   "accordion-up 0.2s ease-out",
        "fade-in":        "fade-in 0.25s ease-out",
        "fade-in-up":     "fade-in-up 0.35s ease-out",
        "slide-down":     "slide-down 0.2s ease-out",
        "scale-in":       "scale-in 0.18s ease-out",
        "shimmer":        "shimmer 1.6s linear infinite",
        "pulse-soft":     "pulse-soft 2.5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;

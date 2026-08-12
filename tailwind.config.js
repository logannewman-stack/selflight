/** @type {import('tailwindcss').Config} */

// Every colour resolves through a CSS variable set by src/lib/themes.js, so a
// theme switch is one style write rather than a re-render.
const themed = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        page: themed("page"),
        panel: themed("panel"),
        surface: themed("surface"),
        raised: themed("raised"),
        line: themed("line"),
        ink: themed("ink"),
        muted: themed("muted"),
        soft: themed("soft"),
        accent: themed("accent"),
        bubble: themed("bubble"),
        bubbleInk: themed("bubbleInk"),
        codebg: themed("code")
      },

      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
        serif: ["var(--font-serif)"],
        reading: ["var(--font-reading)"]
      },

      // One scale, used everywhere, so vertical rhythm stays consistent
      // instead of drifting with per-component pixel values.
      fontSize: {
        "2xs": ["10.5px", { lineHeight: "1.4", letterSpacing: "0.06em" }],
        xs: ["11.5px", { lineHeight: "1.5" }],
        sm: ["12.5px", { lineHeight: "1.55" }],
        base: ["13.5px", { lineHeight: "1.55" }],
        md: ["15px", { lineHeight: "1.6" }],
        lg: ["17px", { lineHeight: "1.45", letterSpacing: "-0.011em" }],
        xl: ["20px", { lineHeight: "1.3", letterSpacing: "-0.016em" }],
        "2xl": ["25px", { lineHeight: "1.2", letterSpacing: "-0.021em" }],
        "3xl": ["33px", { lineHeight: "1.1", letterSpacing: "-0.028em" }]
      },

      borderRadius: {
        lg: "10px",
        xl: "13px",
        "2xl": "17px",
        "3xl": "22px"
      },

      boxShadow: {
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow-md)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)"
      },

      transitionTimingFunction: {
        // Slightly eased-out; movement settles rather than stopping dead.
        soft: "cubic-bezier(0.32, 0.72, 0, 1)"
      }
    }
  },
  plugins: []
};

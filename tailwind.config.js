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
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Inter", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"]
      }
    }
  },
  plugins: []
};

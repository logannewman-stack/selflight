/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        page: "#FAF9F7",
        panel: "#F3F1EC",
        line: "#E6E2D9",
        ink: "#1A1A1A",
        muted: "#8A8378",
        soft: "#B4ADA1",
        accent: "#B4552F"
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Inter', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      }
    }
  },
  plugins: []
};

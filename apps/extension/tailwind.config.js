/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/ui/**/*.{ts,tsx,js,jsx}',
    './src/apps/dashboard/**/*.{ts,tsx,js,jsx,html}',
  ],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        fg: 'var(--color-fg)',
        muted: 'var(--color-fg-muted)',
        primary: 'var(--color-primary)',
        danger: 'var(--color-danger)',
        info: 'var(--color-info)',
        border: 'var(--color-border)',
      },
      borderRadius: {
        sm: 'var(--radius-1)',
        md: 'var(--radius-2)',
        lg: 'var(--radius-3)',
        xl: 'var(--radius-4)',
        pill: 'var(--radius-pill)',
      },
      boxShadow: {
        1: 'var(--shadow-1)',
        2: 'var(--shadow-2)',
        3: 'var(--shadow-3)',
        focus: 'var(--ring-focus)',
      },
    },
  },
  plugins: [],
};

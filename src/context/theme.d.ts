import type { ReactNode } from 'react'

// Types for the legacy theme context (theme.jsx), shared by the Studio.
export function ThemeProvider(props: { children: ReactNode }): JSX.Element
export function useTheme(): { theme: 'dark' | 'light'; isDark: boolean; toggle: (e?: unknown) => void }

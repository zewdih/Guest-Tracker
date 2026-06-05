import { useEffect, useState, useRef } from 'react'

const THEME_KEY = 'aath-theme'
const SCHEME_KEY = 'aath-scheme'

const SCHEMES = [
  { id: 'default',  label: 'Terracotta' },
  { id: 'ocean',    label: 'Ocean' },
  { id: 'forest',   label: 'Forest' },
  { id: 'plum',     label: 'Plum' },
  { id: 'slate',    label: 'Slate' },
]

function initialTheme() {
  const saved = localStorage.getItem(THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
  return prefersDark ? 'dark' : 'light'
}

function initialScheme() {
  const saved = localStorage.getItem(SCHEME_KEY)
  if (SCHEMES.some((s) => s.id === saved)) return saved
  return 'default'
}

export function useTheme() {
  const [theme, setTheme] = useState(initialTheme)
  const [scheme, setScheme] = useState(initialScheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.setAttribute('data-scheme', scheme)
    localStorage.setItem(SCHEME_KEY, scheme)
  }, [scheme])

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  return { theme, setTheme, toggle, scheme, setScheme, schemes: SCHEMES }
}

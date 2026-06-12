# Factory Materials - AI Coding Instructions

## Project Overview
Next.js 16.1.6 (App Router) with React 19, TypeScript, and Tailwind CSS v4. Fresh `create-next-app` scaffold focused on modern Next.js patterns.

## Architecture & Structure

### App Router (app/)
- Uses Next.js App Router architecture (not Pages Router)
- [app/layout.tsx](app/layout.tsx): Root layout with Geist font family configuration
- [app/page.tsx](app/page.tsx): Home page component - edit this for main content changes
- [app/globals.css](app/globals.css): Global styles with Tailwind v4 `@import` syntax

### Path Aliasing
- Use `@/*` for imports (e.g., `import { Component } from '@/components/...'`)
- Configured in [tsconfig.json](tsconfig.json) paths

## Styling Conventions

### Tailwind CSS v4
- **Critical**: Uses new Tailwind v4 with `@tailwindcss/postcss` plugin
- Import syntax: `@import "tailwindcss"` (not v3's `@tailwind` directives)
- Theme customization via `@theme inline` blocks in [app/globals.css](app/globals.css)
- CSS variables: `--background`, `--foreground` for theming
- Dark mode: Uses `prefers-color-scheme` media query, not class-based

### Design Patterns
- Utility-first with extensive class compositions (see [app/page.tsx](app/page.tsx))
- Responsive: Mobile-first with `sm:` breakpoint modifiers
- Typography: Geist Sans (`--font-geist-sans`) and Geist Mono (`--font-geist-mono`)
- Color scheme: `dark:` prefix for dark mode variants

## Component Patterns

### Server Components by Default
- All components in `app/` are React Server Components unless marked `'use client'`
- Use `next/image` for optimized images with `priority` for above-fold content
- Metadata exported from layouts/pages (see [app/layout.tsx](app/layout.tsx#L15-L18))

### Type Safety
- Strict TypeScript enabled ([tsconfig.json](tsconfig.json#L6))
- Use Next.js types: `Metadata`, `NextConfig`
- React 19: `Readonly<{children: React.ReactNode}>` for layout props

## Developer Workflows

### Commands
- **Dev server**: `npm run dev` (starts on localhost:3000)
- **Build**: `npm run build` (production build)
- **Start**: `npm start` (serves production build)
- **Lint**: `npm run lint` (uses ESLint v9 flat config)

### ESLint Configuration
- Uses new flat config format ([eslint.config.mjs](eslint.config.mjs))
- `eslint-config-next` with TypeScript support
- Ignores: `.next/`, `out/`, `build/`, `next-env.d.ts`

## Key Dependencies
- **Next.js 16.1.6**: Latest with App Router stable features
- **React 19.2.3**: Latest React with new hooks/features
- **Tailwind CSS v4**: Major version with breaking changes from v3
- **TypeScript 5**: Strict mode enabled

## Important Notes
- No custom `next.config.ts` options configured yet - vanilla setup
- No API routes or server actions yet - add to `app/api/` when needed
- Static assets go in `public/` directory (SVG logos currently present)
- Font optimization handled automatically via `next/font/google`

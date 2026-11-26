# UI guidelines — Ledger / archival index

## Status and scope

Direction A was selected for U0. These rules describe the first design-system slice and are intended to guide later public, admin, issuance, and recipient phases. The existing screen redesign is not complete yet; the legacy UI should not be treated as conforming to this guide until its phase is reviewed.

## Visual direction

Use the visual language of a well-kept credential ledger: warm paper, deep green ink, clear serial/date alignment, and a restrained seal or serial-rule detail. The seal is an accent for verification contexts, not a repeating background texture. Prefer table rules, whitespace, and typographic hierarchy to wrapping every section in a raised card.

Avoid gradients, glow effects, glass treatments, neon shadows, emoji icons, and decorative animation. Use the already-installed Lucide icon set consistently at a 1.75px stroke when icons are introduced; always pair a status icon with a text label.

## Color tokens and contrast

| Token | Value | Intended use | Contrast against `--color-paper` |
|---|---|---|---:|
| `--color-paper` | `#F5F1E8` | Page background | — |
| `--color-paper-raised` | `#EFEADF` | Quiet fills and headers | — |
| `--color-surface` | `#FFFDF8` | Inputs and content surfaces | — |
| `--color-ink` | `#1D2D27` | Main text | 12.79:1 |
| `--color-muted` | `#55645B` | Secondary text | 5.54:1 |
| `--color-brand` | `#254D40` | Primary actions and links | 8.41:1 |
| `--color-accent` | `#9A4F32` | Restrained copper accent | 5.26:1 |
| `--color-success` | `#28613D` | Success text/status | 6.50:1 |
| `--color-warning` | `#76551C` | Warning text/status | 6.04:1 |
| `--color-danger` | `#9F362B` | Error/destructive text/status | 6.13:1 |
| `--color-info` | `#31596F` | Informational text/status | 6.68:1 |
| `--color-border` | `#D8D0C2` | Decorative separators only | Not for meaning by itself |
| `--color-border-strong` | `#78847C` | Control boundaries | 3.46:1; do not use as text |
| `--color-focus` | `#76551C` | Focus indicator | 6.04:1 against paper |

White text on the primary button (`#254D40`) is **9.48:1**. The listed text pairs meet WCAG AA for normal text against the page paper. The information colors and status washes must remain paired with their visible text/icon labels; color alone never communicates state. These are token-level calculations; verify final composited colors, focus indicators, control boundaries, and all rendered states before phase handoff.

Contrast ratios use WCAG relative luminance:

```text
ratio = (lighter luminance + 0.05) / (darker luminance + 0.05)
```

## Typography

- Display/headings: Source Serif 4, self-hosted from the licensed font package.
- UI/body/forms: IBM Plex Sans, self-hosted from the licensed font package.
- Keep to these two families, use tabular numerals for serials, counts, and dates, and keep body-copy measure near 60–75 characters per line.
- Initial scale: 12px supporting labels, 14px dense UI, 16px body, 20px section heading, 24px page subheading, and fluid 32–44px page title.
- Use sentence case for Indonesian interface labels. Avoid all-caps except for short metadata eyebrows.

## Layout and components

- Design for 360px first; no page-level horizontal overflow. A table may scroll inside its labeled region; a long record may become a labeled stacked row.
- Interactive targets are at least 44px high. Keep a visible high-contrast keyboard focus outline and support reduced motion.
- Use semantic headings/landmarks, connected field labels and error descriptions, native `details` for simple disclosure, and native `dialog` for modal focus behavior.
- Do not add decorative `01 / 02 / 03` sequences or dot-after-number labels. Step progress uses shape/state and text labels; real credential serials remain data, not decoration.
- `StatusPill` and `Alert` require visible text. Verification status must say “Status pencabutan menurut portal ini”; do not claim OB 3.0 revocation conformance.
- `FormField` supplies a connected hint/error description to its control. Use `role="alert"` for actionable errors and `role="status"` for non-urgent updates; explain a next step rather than exposing raw server errors.
- Prefer plain sections, tables, lists, and rules. Use `Card` only where it improves grouping. Do not invent metrics, testimonials, customer logos, or legal claims.
- The layouts are additive U0 primitives. Route migration and actual product copy belong to later approved phases.

## Brand and content boundaries

- Product identity is read from `src/config/brand.ts`; UI labels live in `src/copy/id.ts`.
- Do not hardcode a domain, organization serial prefix, service credential, or secret in a screen. `PUBLIC_SITE_URL` is injected by the Vite config as a public origin and normalized by `getPublicSiteUrl()`; only local development without that value falls back to the active browser origin. No signing, mail, service-role, or owner-allowlist value belongs in the client bundle.
- Use Indonesian examples such as “Seminar Nasional Literasi Digital”, “Peserta”, “Juara 1”, and “Pembicara”. Keep styleguide records clearly illustrative; never use real recipient data.
- A name shown on a public credential page is a recipient-controlled display choice, not a claim that the name is present in or proven by the signed credential. Never show recipient email publicly.
- Public credential status copy must describe this portal’s status record and the limits of QR/paper verification.

## Preview

In development, open `/_styleguide` to inspect the design tokens, primitives, and Public/Admin/Minimal layout previews. This route is conditionally registered only in Vite development mode and should be absent from production output.

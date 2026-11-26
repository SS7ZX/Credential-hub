import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { brand } from '../config/brand'
import { copyId } from '../copy/id'

export function MinimalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="layout-minimal">
      <a className="layout-skip-link" href="#minimal-main">{copyId.navigation.skipToMain}</a>
      <header className="layout-minimal-header">
        <Link className="layout-brand" to="/" aria-label={`${brand.productName} — ${copyId.navigation.home}`}>
          <span className="layout-brand-seal" aria-hidden="true">{brand.shortName}</span>
          <span>{brand.productName}</span>
        </Link>
      </header>
      <main id="minimal-main" className="layout-minimal-main">{children}</main>
    </div>
  )
}

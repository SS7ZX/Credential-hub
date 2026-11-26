import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { brand } from '../config/brand'
import { copyId } from '../copy/id'
import './layouts.css'

export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="layout-public">
      <a className="layout-skip-link" href="#main-content">{copyId.navigation.skipToMain}</a>
      <header className="layout-public-header">
        <Link className="layout-brand" to="/" aria-label={`${brand.productName} — ${copyId.navigation.home}`}>
          <span className="layout-brand-seal" aria-hidden="true">{brand.shortName}</span>
          <span>{brand.productName}</span>
        </Link>
        <nav className="layout-public-nav" aria-label="Navigasi utama">
          <Link to="/">{copyId.navigation.home}</Link>
          <Link to="/verify">{copyId.navigation.verify}</Link>
        </nav>
      </header>
      <main id="main-content" className="layout-public-main">{children}</main>
      <footer className="layout-public-footer">
        <span>{brand.productName}</span>
        <span>{copyId.styleguide.footer}</span>
      </footer>
    </div>
  )
}

import { useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { brand } from '../config/brand'
import { copyId } from '../copy/id'
import './layouts.css'

const navigationItems = [
  { href: '/admin', label: copyId.navigation.adminOverview },
  { href: '/admin/events', label: copyId.navigation.events },
  { href: '/admin/batches', label: copyId.navigation.batches },
  { href: '/admin/credentials', label: copyId.navigation.credentials },
  { href: '/admin/members', label: copyId.navigation.members },
  { href: '/admin/settings', label: copyId.navigation.settings },
]

export function AdminLayout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const location = useLocation()

  return (
    <div className={`layout-admin${collapsed ? ' layout-admin-collapsed' : ''}`}>
      <a className="layout-skip-link" href="#admin-main">{copyId.navigation.skipToMain}</a>
      <aside className="layout-admin-sidebar" aria-label={copyId.navigation.workspace}>
        <Link className="layout-admin-brand" to="/admin" aria-label={`${brand.productName} — ${copyId.navigation.workspace}`}>
          <span className="layout-brand-seal" aria-hidden="true">{brand.shortName}</span>
          <span className="layout-admin-brand-name">{brand.productName}</span>
        </Link>
        <nav aria-label="Navigasi ruang kerja">
          {navigationItems.map((item) => (
            <Link
              className={`layout-admin-link${location.pathname === item.href ? ' layout-admin-link-current' : ''}`}
              to={item.href}
                aria-current={location.pathname === item.href ? 'page' : undefined}
              key={item.href}
            >
              <span className="layout-admin-link-label">{item.label}</span>
            </Link>
          ))}
        </nav>
        <button
          className="layout-admin-collapse"
          type="button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? copyId.navigation.expand : copyId.navigation.collapse}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed
            ? <PanelLeftOpen size={18} strokeWidth={1.75} aria-hidden="true" />
            : <PanelLeftClose size={18} strokeWidth={1.75} aria-hidden="true" />}
          <span className="layout-admin-link-label">{collapsed ? copyId.navigation.expand : copyId.navigation.collapse}</span>
        </button>
      </aside>
      <div className="layout-admin-main-wrap">
        <header className="layout-admin-topbar">
          <span className="layout-admin-section">{copyId.navigation.workspace}</span>
          <Link to="/">{copyId.navigation.home}</Link>
        </header>
        <main className="layout-admin-main" id="admin-main">{children}</main>
      </div>
    </div>
  )
}

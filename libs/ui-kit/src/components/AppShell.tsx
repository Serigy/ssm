import { useState, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';
import { initials } from '../utils/format.js';

export interface NavItem {
  id: string;
  label: string;
  href: string;
  /** Optional grouping header rendered above the item. */
  group?: string;
}

interface AppShellProps {
  /** Rendered under the SERIGY wordmark, mono uppercase. */
  product: string;
  nav: NavItem[];
  activeId: string;
  onNavigate: (item: NavItem) => void;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  user?: { name: string; email: string };
  footLabel?: string;
  footValue?: string;
  children: ReactNode;
}

/**
 * The host shell's chrome. Lives in the UI kit rather than in apps/shell so a
 * micro-frontend can render the same chrome when it runs standalone in
 * development — otherwise a remote developed in isolation looks nothing like
 * the assembled application.
 *
 * There is no logo file: the design system specifies the wordmark SERIGY set
 * in Archivo 800, uppercase, tracking-wide.
 */
export function AppShell({
  product,
  nav,
  activeId,
  onNavigate,
  title,
  subtitle,
  actions,
  user,
  footLabel,
  footValue,
  children,
}: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  let lastGroup: string | undefined;

  return (
    <div className="ssm-shell">
      <a href="#ssm-main" className="ssm-sr-only">
        Pular para o conteúdo
      </a>

      <aside className={cx('ssm-shell__aside', menuOpen && 'ssm-shell__aside--open')}>
        <div className="ssm-shell__brand">
          <div className="ssm-shell__wordmark">SERIGY</div>
          <div className="ssm-shell__product">{product}</div>
        </div>

        <nav className="ssm-shell__nav" aria-label="Navegação principal">
          {nav.map((item) => {
            const header = item.group && item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            const active = item.id === activeId;
            return (
              <div key={item.id}>
                {header && <div className="ssm-shell__group">{header}</div>}
                <a
                  href={item.href}
                  className={cx('ssm-nav-item', active && 'ssm-nav-item--active')}
                  aria-current={active ? 'page' : undefined}
                  onClick={(e) => {
                    // Let ctrl/cmd-click open a new tab as the user expects.
                    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                    e.preventDefault();
                    setMenuOpen(false);
                    onNavigate(item);
                  }}
                >
                  {item.label}
                </a>
              </div>
            );
          })}
        </nav>

        {footLabel && (
          <div className="ssm-shell__foot">
            <div className="ssm-shell__foot-label">{footLabel}</div>
            <div className="ssm-shell__foot-value">{footValue}</div>
          </div>
        )}
      </aside>

      <div className="ssm-shell__main">
        <header className="ssm-topbar">
          <div className="ssm-topbar__spacer">
            <div className="ssm-topbar__title">{title}</div>
            {subtitle && <div className="ssm-topbar__subtitle">{subtitle}</div>}
          </div>
          {actions}
          {user && (
            <div className="ssm-avatar" title={`${user.name} — ${user.email}`}>
              {initials(user.name)}
            </div>
          )}
        </header>
        <main className="ssm-content" id="ssm-main">
          {children}
        </main>
      </div>
    </div>
  );
}

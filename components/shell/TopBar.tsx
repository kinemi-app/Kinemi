"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { studios } from "../../lib/studios";
import { cx } from "../ui";
import styles from "./shell.module.css";

const LINKS = [
  { href: "/cinematic", label: "Cinematic" },
  { href: "/storyboard", label: "Storyboard" },
  { href: "/reshoot", label: "Re-shoot" },
  { href: "/genjutsu", label: "Genjutsu" },
  { href: "/presets", label: "Presets" },
  { href: "/soul", label: "Soul" },
  { href: "/cast", label: "AI Cast" },
  { href: "/edit", label: "Edit" },
  { href: "/academy", label: "Academy" },
];

export function TopBar() {
  const pathname = usePathname();
  const studioActive = studios.some(
    (studio) => pathname === studio.href || pathname.startsWith(`${studio.href}/`),
  );

  return (
    <header className={styles.bar}>
      <Link className={styles.wordmark} href="/">
        Kinemi<span className={styles.dot}>.</span>
      </Link>

      <nav className={styles.nav} aria-label="Flows">
        {LINKS.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cx(styles.link, active && styles.linkActive)}
              aria-current={active ? "page" : undefined}
            >
              {link.label}
            </Link>
          );
        })}

        <details className={styles.studios}>
          <summary className={cx(styles.link, styles.summary, studioActive && styles.linkActive)}>
            Studios
          </summary>
          <div className={styles.menu}>
            {studios.map((studio) =>
              studio.live ? (
                <Link
                  key={studio.href}
                  href={studio.href}
                  className={cx(styles.menuItem, pathname === studio.href && styles.menuItemActive)}
                >
                  <span>{studio.nav}</span>
                  <span className={styles.menuMeta}>{studio.parity[0]}+</span>
                </Link>
              ) : (
                <span key={studio.href} className={cx(styles.menuItem, styles.menuSoon)} aria-disabled="true">
                  <span>{studio.nav}</span>
                  <span className={styles.menuMeta}>soon</span>
                </span>
              ),
            )}
          </div>
        </details>
      </nav>

      <span className={styles.badge} title="No Comfy endpoint is connected, so renders are placeholders">
        demo
      </span>
    </header>
  );
}

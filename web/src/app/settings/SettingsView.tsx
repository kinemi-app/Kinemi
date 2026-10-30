// Settings: one page per section, listed in the sidebar (and as chips on a phone).
import { SECTIONS, sectionById, type SectionId } from '../data/sections';
import { cx } from '../lib/util';
import { settingsHref } from '../router';
import { PxIcon } from '../ui/icons';
import { AccountSection } from './Account';
import { AboutSection, DataSection } from './Data';
import { ModelsSection } from './Models';
import { InterfaceSection, NotificationsSection, RenderingSection } from './Preferences';
import { ProvidersSection } from './Providers';

const BODY: Record<SectionId, () => preact.JSX.Element> = {
  account: AccountSection,
  providers: ProvidersSection,
  models: ModelsSection,
  rendering: RenderingSection,
  interface: InterfaceSection,
  notifications: NotificationsSection,
  data: DataSection,
  about: AboutSection,
};

export function SettingsView({ section }: { section: SectionId }) {
  const s = sectionById(section) ?? SECTIONS[0];
  const Body = BODY[s.id];
  return (
    <section class="ws settings" aria-labelledby="set-title">
      <div class="set-shell">
        <nav class="set-side" aria-label="Settings">
          {SECTIONS.map((x) => (
            <a key={x.id} href={settingsHref(x.id)} class={cx('set-side-link', x.id === s.id && 'is-on')} aria-current={x.id === s.id ? 'page' : undefined}>
              <PxIcon name={x.icon} size={16} />
              {x.label}
            </a>
          ))}
        </nav>
        <div class="set-main">
          <header class="ws-head set-head">
            <nav class="crumbs mono" aria-label="Breadcrumb">
              <a href={settingsHref('account')}>Settings</a>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{s.label}</span>
            </nav>
            <div class="set-title-row">
              <span class="set-title-ico" aria-hidden="true">
                <PxIcon name={s.icon} size={22} />
              </span>
              <div>
                <h1 id="set-title">{s.label}</h1>
                <p class="ws-text">{s.blurb}</p>
              </div>
            </div>
            <nav class="set-chips" aria-label="Settings sections">
              {SECTIONS.map((x) => (
                <a key={x.id} href={settingsHref(x.id)} class={cx('chip', x.id === s.id && 'is-on')} aria-current={x.id === s.id ? 'page' : undefined}>
                  {x.label}
                </a>
              ))}
            </nav>
          </header>
          <div class="set-body" key={s.id}>
            <Body />
          </div>
        </div>
      </div>
    </section>
  );
}

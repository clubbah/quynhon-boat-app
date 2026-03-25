import { t } from './i18n.js';
import { getFlagEmoji, getColorForType } from './vessel-icons.js';

const $ = (id) => document.getElementById(id);

export function showPanel(vessel) {
  const card = $('vessel-card');
  const countryCode = (vessel.flag_country || '').toLowerCase();
  const typeLabel = vessel.vessel_type_label || 'Other';
  const color = getColorForType(typeLabel);

  const flagEl = $('card-flag');
  if (countryCode) {
    flagEl.innerHTML = `<img src="https://flagcdn.com/32x24/${countryCode}.png" alt="${countryCode}" style="width:32px;height:24px;border-radius:3px;object-fit:cover;" />`;
  } else {
    flagEl.textContent = '\u{1F6A2}';
  }
  $('card-name').textContent = vessel.name || vessel.mmsi;
  $('card-type-badge').textContent = typeLabel;
  $('card-type-badge').style.background = color;

  // Position section
  $('card-section-position').textContent = t('position_section');
  $('label-speed').textContent = t('speed');
  $('card-speed').textContent = vessel.speed != null ? vessel.speed.toFixed(1) + ' ' + t('knots') : t('no_data');
  $('label-course').textContent = t('course') + ' / ' + t('heading');
  $('card-course').textContent = formatCourseHeading(vessel);
  $('label-status').textContent = t('status');
  $('card-status').textContent = vessel.nav_status_label || t('no_data');

  // Voyage section
  $('card-section-voyage').textContent = t('voyage_section');
  $('label-destination').textContent = t('destination');
  $('card-destination').textContent = vessel.destination || t('no_data');
  $('label-eta').textContent = t('eta');
  $('card-eta').textContent = vessel.eta || t('no_data');

  // Physical section
  $('card-section-physical').textContent = t('physical_section');
  $('label-dimensions').textContent = t('dimensions');
  $('card-dimensions').textContent = vessel.length && vessel.width
    ? `${vessel.length} x ${vessel.width} ${t('meters')}` : t('no_data');
  $('label-draught').textContent = t('draught');
  $('card-draught').textContent = vessel.draught ? vessel.draught + ' ' + t('meters') : t('no_data');
  $('label-imo').textContent = t('imo');
  $('card-imo').textContent = vessel.imo || t('no_data');
  $('label-mmsi').textContent = t('mmsi');
  $('card-mmsi').textContent = vessel.mmsi;
  $('label-callsign').textContent = t('call_sign');
  $('card-callsign').textContent = vessel.call_sign || t('no_data');

  // Footer
  $('card-updated').textContent = vessel.updated_at
    ? `${t('updated')}: ${new Date(vessel.updated_at).toLocaleTimeString()}`
    : '';

  card.classList.remove('hidden');
}

function formatCourseHeading(vessel) {
  const course = vessel.course != null ? vessel.course.toFixed(1) + '\u00B0' : t('no_data');
  const heading = vessel.heading != null ? vessel.heading + '\u00B0' : t('no_data');
  return `${course} / ${heading}`;
}

export function hidePanel() {
  $('vessel-card').classList.add('hidden');
}

export function initPanel(onClose) {
  $('card-close').addEventListener('click', onClose);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') onClose();
  });
}

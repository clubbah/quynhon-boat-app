import { t } from './i18n.js';

const panel = () => document.getElementById('info-panel');
const $ = (id) => document.getElementById(id);

export function showPanel(vessel) {
  $('panel-name').textContent = vessel.name || vessel.mmsi;
  $('panel-type').textContent = `${t('type')}: ${vessel.vessel_type_label || t('no_data')}`;
  $('panel-flag').textContent = `${t('flag')}: ${vessel.flag_country || t('no_data')}`;
  $('panel-speed').textContent = `${t('speed')}: ${vessel.speed != null ? vessel.speed.toFixed(1) + ' ' + t('knots') : t('no_data')}`;
  $('panel-destination').textContent = `${t('destination')}: ${vessel.destination || t('no_data')}`;
  $('panel-status').textContent = `${t('status')}: ${vessel.nav_status_label || t('no_data')}`;

  $('panel-dimensions').textContent = `${t('dimensions')}: ${vessel.length && vessel.width ? vessel.length + ' x ' + vessel.width + ' ' + t('meters') : t('no_data')}`;
  $('panel-draught').textContent = `${t('draught')}: ${vessel.draught ? vessel.draught + ' ' + t('meters') : t('no_data')}`;
  $('panel-imo').textContent = `${t('imo')}: ${vessel.imo || t('no_data')}`;
  $('panel-mmsi').textContent = `${t('mmsi')}: ${vessel.mmsi}`;
  $('panel-callsign').textContent = `${t('call_sign')}: ${vessel.call_sign || t('no_data')}`;
  $('panel-eta').textContent = `${t('eta')}: ${vessel.eta || t('no_data')}`;
  $('panel-course').textContent = `${t('course')}: ${vessel.course != null ? vessel.course.toFixed(1) + '°' : t('no_data')} / ${t('heading')}: ${vessel.heading != null ? vessel.heading + '°' : t('no_data')}`;
  $('panel-updated').textContent = `${t('updated')}: ${vessel.updated_at ? new Date(vessel.updated_at).toLocaleTimeString() : t('no_data')}`;

  $('panel-expanded').classList.add('hidden');
  $('panel-expand-btn').textContent = t('show_details');

  panel().classList.remove('hidden');
}

export function hidePanel() {
  panel().classList.add('hidden');
}

export function initPanel(onClose) {
  $('panel-close').addEventListener('click', onClose);

  $('panel-expand-btn').addEventListener('click', () => {
    const expanded = $('panel-expanded');
    const btn = $('panel-expand-btn');
    if (expanded.classList.contains('hidden')) {
      expanded.classList.remove('hidden');
      btn.textContent = t('hide_details');
    } else {
      expanded.classList.add('hidden');
      btn.textContent = t('show_details');
    }
  });
}

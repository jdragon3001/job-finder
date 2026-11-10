// What the person is looking for: the one definition of profile/profile.json. The Profile card renders
// these fields, the server saves only what normalize() returns, and scripts/harvest.py + the prompts read the file.
// Pure (no fs), so the dashboard imports it too.

export const LEVELS = { internship: 'Internship', entry: 'Entry level', associate: 'Associate', 'mid-senior': 'Mid / senior', director: 'Director and up' };
export const JOB_TYPES = { 'full-time': 'Full-time', 'part-time': 'Part-time', contract: 'Contract', temporary: 'Temporary', internship: 'Internship' };
export const MODES = { hybrid: 'Hybrid', remote: 'Remote', onsite: 'On-site' };

// [key, label, type, options-or-hint]
export const SECTIONS = [
  ['About you', [
    ['name', 'First name', 'text', 'Signs your emails'],
    ['school', 'School', 'text', 'Used to find alumni at each company'],
    ['degree', 'Degree', 'text'],
    ['grad', 'Graduated / graduating', 'text', 'e.g. May 2026'],
    ['tools', 'Tools and skills', 'list'],
  ]],
  ['Jobs to find', [
    ['wants', 'Kinds of jobs, best first', 'list', 'These become the filters on New'],
    ['search_terms', 'Job-board searches', 'list', 'Job titles as companies post them'],
    ['never', 'Never show me', 'list', 'Industries or kinds of work to skip'],
  ]],
  ['Where', [
    ['locations', 'Cities', 'list', 'e.g. Chicago, Illinois'],
    ['radius_miles', 'Distance from each city (miles)', 'number'],
    ['remote', 'Also search remote jobs nationwide', 'bool'],
    ['work_modes', 'Work arrangements', 'multi', MODES],
  ]],
  ['Level and pay', [
    ['level', 'Level', 'select', LEVELS],
    ['job_types', 'Job types', 'multi', JOB_TYPES],
    ['pay_floor', 'Lowest pay, in person or hybrid', 'money'],
    ['pay_floor_remote', 'Lowest pay, remote', 'money'],
    ['experience_rule', 'Experience you can take on', 'text', 'e.g. none required; 1 year general is a stretch'],
  ]],
  ['Fine-tuning', [
    ['include_titles', 'Titles must contain one of', 'list', 'Leave empty to keep every title'],
    ['exclude_titles', 'Skip titles containing', 'list'],
    ['notes', 'Anything else the search should know', 'long'],
    ['email_subject', 'Email subject line', 'text', '{role} and {company} are filled in'],
  ]],
];
export const FIELDS = Object.fromEntries(SECTIONS.flatMap(([, f]) => f.map(x => [x[0], x])));

export const DEFAULTS = {
  name: '', school: '', degree: '', grad: '', tools: [], wants: [], search_terms: [], never: [],
  locations: [], radius_miles: 25, remote: true, work_modes: ['hybrid', 'remote', 'onsite'],
  level: 'entry', job_types: ['full-time'], pay_floor: 0, pay_floor_remote: 0, experience_rule: '',
  include_titles: [], exclude_titles: [], notes: '', email_subject: '{role} at {company}',
};

const str = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '');

// Merge `patch` onto `base` and coerce every field to its type; unknown keys are dropped.
export function normalize(patch = {}, base = DEFAULTS) {
  const out = {};
  for (const [k, [, , type, opts]] of Object.entries(FIELDS)) {
    const v = Object.hasOwn(patch, k) ? patch[k] : Object.hasOwn(base, k) ? base[k] : DEFAULTS[k];
    out[k] = type === 'list' ? (Array.isArray(v) ? v : String(v ?? '').split('\n')).map(x => str(x, 200)).filter(Boolean).slice(0, 60)
      : type === 'multi' ? (Array.isArray(v) ? v : []).filter(x => Object.hasOwn(opts, x))
      : type === 'select' ? (Object.hasOwn(opts, v) ? v : DEFAULTS[k])
      : type === 'bool' ? !!v
      : type === 'number' || type === 'money' ? Math.max(0, Math.round(Number(v) || 0))
      : str(v, type === 'long' ? 4000 : 300);
  }
  return out;
}

// Enough to run a search: something to search for and somewhere to search.
export const searchReady = (p) => !!p && p.search_terms.length > 0 && p.wants.length > 0 && (p.locations.length > 0 || p.remote);

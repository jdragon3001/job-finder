'use client';
// The dashboard: New (pursue/pass) · Ready (apply, files, 3 people) · Sent (read from Gmail).
// Look and flows are the approved demo (web/demo.dc.html); data and actions come from /api.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SECTIONS } from '../lib/profile.js';

const I = {
  compass: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36z',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2 M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  ready: 'M22 2 11 13 M22 2l-7 20-4-9-9-4 20-7z',
  sent: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  check: 'M20 6 9 17l-5-5', minus: 'M5 12h14', x: 'M18 6 6 18 M6 6l12 12',
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8 M21 3v5h-5',
  external: 'M15 3h6v6 M10 14 21 3 M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  alert: 'M12 9v4 M12 17h.01 M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M22 6l-10 7L2 6',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1', swap: 'M17 1l4 4-4 4 M3 11V9a4 4 0 0 1 4-4h14 M7 23l-4-4 4-4 M21 13v2a4 4 0 0 1-4 4H3',
  loader: 'M21 12a9 9 0 1 1-6.22-8.56', chevR: 'M9 18l6-6-6-6', chevD: 'M6 9l6 6 6-6',
  help: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3 M12 17h.01',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
};
const Ic = ({ d, s = 15, cls = 'i', style }) => <svg className={cls} viewBox="0 0 24 24" aria-hidden="true" style={{ width: s, height: s, ...style }}><path d={d} /></svg>;

const group = (c) => c || 'Other';   // categories are her own `wants` (prompts/find-jobs.md)
const city = (l = '') => l.split(',')[0] || l;
const first = (n = '') => n.split(' ')[0];
const ini = (n = '') => n.split(' ').map(x => x[0]).join('').slice(0, 2);
const LABEL = { experience: 'Experience', programming: 'Programming', pay: 'Pay', location: 'Location', education: 'Education', type: 'Type', mode: 'Work mode' };
const SRC = { linkedin: 'LinkedIn', indeed: 'Indeed', ziprecruiter: 'ZipRecruiter', builtin: 'Built In', firms: 'company site' };
const KIND = { manager: 'Manager', recruiter: 'Recruiter', alum: 'Alum' };
function payShort(p) {
  const nums = (p || '').match(/\d[\d,.]*\s*k?/gi)?.map(x => { const v = parseFloat(x.replace(/[,k\s]/gi, '')); return /k/i.test(x) ? v * 1000 : v; }).filter(v => v > 15) || [];
  if (!nums.length) return '—';
  const f = (v) => v < 200 ? '$' + Math.round(v) + '/hr' : '$' + Math.round(v / 1000) + 'K';
  return nums[1] && nums[1] !== nums[0] ? f(nums[0]) + '–' + f(nums[1]).slice(1) : f(nums[0]);
}
const gmailCompose = (p) => 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(p.email || '') +
  '&su=' + encodeURIComponent(p.email_subject || '') + '&body=' + encodeURIComponent(p.email_body || '');
const ago = (iso) => { if (!iso) return 'never'; const h = (Date.now() - Date.parse(iso + 'Z')) / 36e5; return h < 1 ? 'just now' : h < 24 ? Math.round(h) + ' h ago' : Math.round(h / 24) + ' d ago'; };

async function api(body) {
  const r = await fetch('/api/act', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong');
  return j;
}

export default function Page() {
  const [view, setView] = useState('new');
  const [mode, setMode] = useState('list');
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [sel, setSel] = useState(null);
  const [rsel, setRsel] = useState(null);
  const [filter, setFilter] = useState('all');
  const [checked, setChecked] = useState({});
  const [leaving, setLeaving] = useState({});
  const [toast, setToast] = useState(null);
  const [flip, setFlip] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [open, setOpen] = useState({ r: true, f: true, w: false });
  const [exp, setExp] = useState({});
  const [copied, setCopied] = useState(null);
  const [guide, setGuide] = useState(false);
  const tt = useRef();
  const autoGuide = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/state?mode=' + mode, { cache: 'no-store' });
      if (!r.ok) throw new Error('The app could not read data/jobs.db (' + r.status + ')');
      const d = await r.json(); setData(d); setLoadErr('');
      const s = d.run.setup;   // on first load only, open the guide if the profile isn't in place — never mid-task
      if (!autoGuide.current && !(s.profile && s.facts && s.resume && s.cover)) setGuide(true);
      autoGuide.current = true;
    } catch (e) { setLoadErr(e.message); }
  }, [mode]);
  useEffect(() => { load(); }, [load, view]);   // switching screens always shows fresh data
  const busy = data && (data.run.dailyRunning || data.ready.some(j => j.prep === 'queued' || j.prep === 'running'));
  useEffect(() => { const t = setInterval(load, busy ? 4000 : 30000); return () => clearInterval(t); }, [load, busy]);

  const say = useCallback((msg, opts = {}) => { clearTimeout(tt.current); setToast({ msg, ...opts }); tt.current = setTimeout(() => setToast(null), opts.err ? 6000 : 3500); }, []);
  const act = async (body, ok) => { try { const r = await api(body); ok && say(ok); await load(); return r; } catch (e) { say(e.message, { err: true }); await load(); } };

  // ---------- New ----------
  const pool = data?.newJobs || [];
  const counts = useMemo(() => pool.reduce((m, j) => ((m[group(j.category)] = (m[group(j.category)] || 0) + 1), m), {}), [pool]);
  const visible = pool.filter(j => filter === 'all' || group(j.category) === filter);
  const live = visible.filter(j => !leaving[j.key]);
  const cur = live.find(j => j.key === sel) || live[0] || null;
  const checkedKeys = Object.keys(checked).filter(k => checked[k] && live.some(j => j.key === k));
  const allOn = live.length > 0 && checkedKeys.length === live.length;

  const decide = useCallback(async (keys, verdict) => {
    keys = keys.filter(k => !leaving[k]);
    if (!keys.length) return;
    const idx = live.findIndex(j => j.key === cur?.key);
    const rest = live.filter(j => !keys.includes(j.key));
    setSel(rest[Math.min(Math.max(idx, 0), rest.length - 1)]?.key || null);
    setLeaving(l => ({ ...l, ...Object.fromEntries(keys.map(k => [k, verdict === 'pursue' ? 'y' : 'n'])) }));
    setChecked({});
    try {
      await api({ action: verdict, keys });
      const name = keys.length === 1 ? pool.find(j => j.key === keys[0])?.company : keys.length + ' jobs';
      say(verdict === 'pursue' ? `Pursuing ${name} — finding people and writing drafts` : `Passed ${name}`, { undo: keys, icon: verdict === 'pursue' ? I.check : I.x });
    } catch (e) { say(e.message, { err: true }); }
    setTimeout(async () => { await load(); setLeaving({}); setFlip(f => !f); }, 240);
  }, [leaving, live, cur, pool, load]);

  const undo = async (keys) => {
    try {
      const r = await api({ action: 'undo', keys });
      say(r.changed < keys.length ? 'Already being prepared — that one stays in Ready' : 'Undone');
      setSel(keys[0]); await load();
    } catch (e) { say(e.message, { err: true }); }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (view !== 'new' || guide || e.metaKey || e.ctrlKey || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      const k = e.key.toLowerCase(), i = live.findIndex(j => j.key === cur?.key);
      if (k === 'j' || k === 'arrowdown') { live[i + 1] && setSel(live[i + 1].key); e.preventDefault(); }
      else if (k === 'k' || k === 'arrowup') { live[i - 1] && setSel(live[i - 1].key); e.preventDefault(); }
      else if (k === 'y' && cur) decide(checkedKeys.length ? checkedKeys : [cur.key], 'pursue');
      else if (k === 'n' && cur) decide(checkedKeys.length ? checkedKeys : [cur.key], 'pass');
      else if (k === 'x' && cur) setChecked(c => ({ ...c, [cur.key]: !c[cur.key] }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, guide, live, cur, checkedKeys, decide]);

  // ---------- Ready ----------
  const ready = data?.ready || [];
  const rj = ready.find(j => j.key === rsel) || ready[0] || null;

  if (!data) return <div className="zero" style={{ height: '100vh' }}>{loadErr ? <><div className="err" style={{ fontWeight: 600 }}>Can’t load</div><div className="mut">{loadErr}</div><button className="btn" onClick={load}>Try again</button></> : <div className="mut row" style={{ gap: 8 }}><Ic d={I.loader} cls="i spin" />Loading</div>}</div>;

  const c = data.counts;
  const segs = (n) => (
    <div className="seg" role="tablist" aria-label="Listings or network-only">
      {[['list', 'Listings'], ['net', 'Network-only']].map(([k, label]) => (
        <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? 'sg sg-on' : 'sg'} onClick={() => { setMode(k); setSel(null); setRsel(null); setChecked({}); setFilter('all'); }}>
          {label} <span className="num" style={{ opacity: .6 }}>{n[k]}</span>
        </button>))}
    </div>);
  const sentN = { list: c.sent.list, net: c.sent.net };
  const st = data.run.setup;
  const setupLeft = [st.resume && st.cover, st.profile, st.facts, data.run.daily].filter(x => !x).length;
  const runTitle = data.run.dailyRunning ? 'Searching…' : data.run.daily ? (data.run.daily.ok ? 'Updated ' + ago(data.run.daily.finished) : 'Last run failed') : 'Not run yet';

  return (
    <div className="app">
      <aside className="rail">
        <div className="brand"><span className="mark"><Ic d={I.compass} s={13} /></span>Job Copilot</div>
        {[['new', 'New', I.inbox, c.new[mode]], ['ready', 'Ready', I.ready, c.ready[mode]], ['sent', 'Sent', I.sent, data.sent.replies.length + data.sent.followUp.length]].map(([k, label, icon, n]) => (
          <button key={k} className={view === k ? 'nav nav-on' : 'nav'} onClick={() => setView(k)} aria-current={view === k ? 'page' : undefined}>
            <Ic d={icon} />{label}<span className={'cnt' + (k === 'sent' && n ? ' cnt-hot' : '') + (k === 'ready' ? (flip ? ' popA' : ' popB') : '')}>{n}</span>
          </button>))}
        <button className={view === 'profile' ? 'nav nav-on' : 'nav'} onClick={() => setView('profile')} aria-current={view === 'profile' ? 'page' : undefined}><Ic d={I.user} />Profile</button>
        <div style={{ flex: 1 }} />
        <div style={{ padding: '10px 9px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="row" style={{ gap: 7, fontWeight: 500 }}><span style={{ width: 7, height: 7, borderRadius: '50%', flex: 'none', background: data.run.dailyRunning ? '#E0A43F' : !data.run.daily ? 'var(--faint)' : data.run.daily.ok === 0 ? '#DC2626' : 'var(--ok)' }} />{runTitle}</div>
          <div className="mut" style={{ fontSize: 12, lineHeight: 1.4 }}>{data.run.dailyRunning ? <>{data.run.progress}<br /><span className="faint">Started {ago(data.run.started)} · about an hour in all</span></> : 'Runs itself when you open this and the last run is over a day old.'}</div>
          <button className="btn" style={{ justifyContent: 'flex-start' }} disabled={data.run.dailyRunning} onClick={() => act({ action: 'run' }, 'Started a search run')}>
            <Ic d={I.refresh} cls={data.run.dailyRunning ? 'i spin' : 'i'} />{data.run.dailyRunning ? 'Running…' : 'Run now'}</button>
          <button className="btn btn-g" style={{ justifyContent: 'flex-start', padding: '0 4px' }} onClick={() => setGuide(true)}>
            <Ic d={I.help} s={14} />{setupLeft ? `Finish setup · ${4 - setupLeft} of 4` : 'Guide · what to do next'}</button>
        </div>
      </aside>

      <main className="main">
        {view === 'new' && <>
          <div className="top">
            <div className="h1">New</div>{segs(c.new)}
            <div style={{ flex: 1 }} />
            <div className="mut row" style={{ gap: 6, fontSize: 12 }}><span className="kbd">J</span><span className="kbd">K</span> move <span className="kbd">Y</span> pursue <span className="kbd">N</span> pass <span className="kbd">X</span> select</div>
          </div>
          {live.length || Object.keys(leaving).length ? (
            <div className="split">
              <div className="list" style={{ position: 'relative' }}>
                <div className="tools">
                  <button className="ck" style={{ width: 26, marginRight: 6 }} aria-label="Select all" onClick={() => setChecked(allOn ? {} : Object.fromEntries(live.map(j => [j.key, true])))}>
                    <span className={checkedKeys.length ? 'box box-on' : 'box'}><Ic d={allOn ? I.check : I.minus} s={10} style={{ strokeWidth: 3 }} /></span></button>
                  {['all', 'Consulting', 'Research', 'Market research', 'Markets', 'Other'].filter(k => k === 'all' || counts[k]).map(k => (
                    <button key={k} className={filter === k ? 'chip chip-on' : 'chip'} onClick={() => { setFilter(k); setChecked({}); }}>
                      {k === 'all' ? 'All' : k} <span className="num" style={{ opacity: .6, marginLeft: 3 }}>{k === 'all' ? pool.length : counts[k]}</span></button>))}
                  <div style={{ flex: 1 }} /><span className="mut" style={{ fontSize: 12 }}>Best first</span>
                </div>
                {visible.map(j => (
                  <div key={j.key} className={'job' + (j.key === cur?.key ? ' job-sel' : '') + (leaving[j.key] ? ' out-' + leaving[j.key] : '')}>
                    <button className="ck" aria-label={'Select ' + j.title} onClick={() => setChecked(x => ({ ...x, [j.key]: !x[j.key] }))}>
                      <span className={checked[j.key] ? 'box box-on' : 'box'}><Ic d={I.check} s={10} style={{ strokeWidth: 3 }} /></span></button>
                    <button className="jb" onClick={() => setSel(j.key)}>
                      <span className={j.score >= 80 ? 'score score-hi' : 'score'}>{j.score}</span>
                      <span className="jt"><b>{j.title}</b> <span className="mut">· {j.company}</span></span>
                      <span className="cell">{city(j.location)}{/remote/i.test((j.work_mode || '') + j.location) ? ' · remote' : /hybrid/i.test(j.work_mode || '') ? ' · hybrid' : ''}</span>
                      <span className="cell num" style={{ textAlign: 'right' }}>{payShort(j.salary)}</span>
                    </button>
                  </div>))}
                {checkedKeys.length > 0 && <div className="bulk">
                  <span className="num" style={{ fontWeight: 500, marginRight: 6 }}>{checkedKeys.length} selected</span>
                  <button className="btn" onClick={() => decide(checkedKeys, 'pass')}>Pass all</button>
                  <button className="btn btn-p" onClick={() => decide(checkedKeys, 'pursue')}>Pursue all</button>
                  <button className="btn" aria-label="Clear selection" style={{ width: 28, padding: 0 }} onClick={() => setChecked({})}><Ic d={I.x} /></button>
                </div>}
              </div>
              <div className="pane">
                {cur && <div key={cur.key} className={flip ? 'fadeA' : 'fadeB'} style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
                  <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="mut" style={{ fontSize: 12.5 }}>{cur.company} · {cur.location}</div>
                      <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-.01em', lineHeight: 1.3, marginTop: 4 }}>{cur.title}</div>
                      <Ghost j={cur} />
                    </div>
                    <a className="btn" href={cur.url} target="_blank" rel="noopener noreferrer">{cur.net ? 'Careers page' : 'Open posting'} <Ic d={I.external} s={13} /></a>
                  </div>
                  <div className="facts">
                    <div><div className="lbl">Pay</div><div className="num" style={{ fontWeight: 500, marginTop: 3 }}>{cur.salary || 'Not posted'}</div></div>
                    <div><div className="lbl">Mode</div><div style={{ fontWeight: 500, marginTop: 3, textTransform: 'capitalize' }}>{(cur.work_mode || 'Not stated').split(',')[0]}</div></div>
                    <div><div className="lbl">Fit</div><div className="num" style={{ fontWeight: 500, marginTop: 3 }}>{cur.score} <span className="mut" style={{ fontWeight: 400 }}>/ 100</span></div></div>
                  </div>
                  <div><div className="lbl">Why it fits</div><div style={{ fontSize: 13.5, marginTop: 6, lineHeight: 1.55 }}>{cur.why}</div></div>
                  {Object.keys(cur.evidence || {}).length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div className="lbl">From the posting</div>
                    {Object.entries(cur.evidence).filter(([, v]) => v).map(([k, v]) => (
                      <div key={k}><div className="mut" style={{ fontSize: 11.5, marginBottom: 2 }}>{LABEL[k] || k}</div><div className="quote">{String(v)}</div></div>))}
                  </div>}
                  {cur.flags.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div className="lbl">Heads up</div>
                    {cur.flags.map(f => <div key={f} className="row" style={{ gap: 8, alignItems: 'flex-start' }}><Ic d={I.alert} style={{ marginTop: 1, color: 'var(--mut)' }} /><span>{f}</span></div>)}
                  </div>}
                  <div className="mut" style={{ fontSize: 12 }}>Found on {SRC[cur.source] || cur.source}</div>
                  <div className="row" style={{ gap: 8, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                    <button className="btn btn-lg" style={{ flex: 1 }} onClick={() => decide([cur.key], 'pass')}>Pass <span className="kbd">N</span></button>
                    <button className="btn btn-lg btn-p" style={{ flex: 2 }} onClick={() => decide([cur.key], 'pursue')}>Pursue <span className="kbd">Y</span></button>
                  </div>
                  <div className="mut" style={{ fontSize: 12, marginTop: -8 }}>{cur.net ? 'Pursue finds 3 people and writes their notes and emails.' : 'Pursue finds 3 people and writes your resume, cover letter, notes and emails.'}</div>
                </div>}
              </div>
            </div>
          ) : (
            <div className="zero">
              <svg className="draw" viewBox="0 0 56 56" style={{ width: 56, height: 56, fill: 'none', stroke: 'var(--a)', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' }} aria-hidden="true"><circle cx="28" cy="28" r="25" /><path d="M17 29l7 7 15-16" /></svg>
              <div style={{ fontSize: 17, fontWeight: 600, marginTop: 6 }}>{data.run.daily ? 'All sorted' : 'Nothing here yet'}</div>
              <div className="mut" style={{ maxWidth: 380 }}>{data.run.daily ? 'New matches arrive with the next run. Pursued jobs are in Ready.' : 'The first search run finds and screens jobs. It starts automatically and takes a while.'}</div>
              {c.ready[mode] > 0 && <button className="btn btn-ink" style={{ marginTop: 8 }} onClick={() => setView('ready')}>Go to Ready</button>}
            </div>
          )}
        </>}

        {view === 'ready' && <>
          <div className="top"><div className="h1">Ready</div>{segs(c.ready)}<div className="mut">A job moves to Sent when every item is done.</div></div>
          <div className="split-r">
            <div className="list">
              {ready.map(j => (
                <button key={j.key} className={'rj' + (j.key === rj?.key ? ' job-sel' : '')} onClick={() => { setRsel(j.key); setDiffOpen(false); }}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                    <span className="jt" style={{ fontWeight: 500 }}>{j.company}</span>
                    {j.prep === 'ready' ? <span className="mut num" style={{ fontSize: 11.5 }}>{j.progress.done} / {j.progress.total}</span>
                      : j.prep === 'failed' ? <span className="err" style={{ fontSize: 11.5 }}>Failed</span>
                      : <span className="mut row" style={{ gap: 5, fontSize: 11.5 }}><Ic d={I.loader} s={12} cls="i spin" />{j.prep === 'running' ? 'Preparing' : 'Queued'}</span>}
                  </div>
                  <div className="jt mut" style={{ fontSize: 12.5, marginTop: 2 }}>{j.title}</div>
                </button>))}
              <div className="mut" style={{ padding: '12px 14px', fontSize: 11.5, lineHeight: 1.5 }}>Each job: apply, then a LinkedIn note and an email per person. Emails and applying are ticked from your Gmail.</div>
            </div>
            <div className="pane">
              {!rj && <div className="zero"><div style={{ fontSize: 15, fontWeight: 600 }}>Nothing to send yet</div><div className="mut">Pursue a job in New and it shows up here.</div></div>}
              {rj && rj.prep !== 'ready' && <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560 }}>
                <div style={{ fontSize: 17, fontWeight: 600 }}>{rj.title} · {rj.company}</div>
                {rj.prep === 'failed' ? <>
                  <div className="err">Claude couldn’t finish preparing this job (no people found, or the resume/cover files are missing in <code>profile/</code>).</div>
                  <div className="row" style={{ gap: 8 }}><button className="btn btn-ink" onClick={() => act({ action: 'retry', key: rj.key }, 'Trying again')}>Try again</button>
                    <a className="btn" href={rj.url} target="_blank" rel="noopener noreferrer">Open posting <Ic d={I.external} s={13} /></a></div>
                </> : <>
                  <div className="mut row" style={{ gap: 7 }}><Ic d={I.loader} cls="i spin" />{rj.prep === 'running' ? `Finding 3 people at ${rj.company} and writing your materials…` : 'Waiting for the job ahead of it to finish…'}</div>
                  <div className="prep" style={{ width: '70%' }} /><div className="prep" style={{ width: '90%' }} /><div className="prep" style={{ width: '55%' }} />
                </>}
              </div>}
              {rj && rj.prep === 'ready' && <ReadyJob key={rj.key} j={rj} gmail={data.run.gmail} act={act} say={say} diffOpen={diffOpen} setDiffOpen={setDiffOpen} exp={exp} setExp={setExp} copied={copied} setCopied={setCopied} />}
            </div>
          </div>
        </>}

        {view === 'sent' && <>
          <div className="top"><div className="h1">Sent</div>{segs(sentN)}<div className="mut">Updates itself from your Gmail — sent, replies and “thanks for applying” emails.</div></div>
          <div style={{ overflow: 'auto', flex: 1 }}>
            {[['r', 'Replies', 'Answer these first', data.sent.replies], ['f', 'Follow-up due', '5 business days, no reply', data.sent.followUp], ['w', 'Waiting', 'Nothing to do', data.sent.waiting]].map(([k, title, sub, items]) => (
              <div key={k}>
                <button className="sgrp row" aria-expanded={open[k]} onClick={() => setOpen(o => ({ ...o, [k]: !o[k] }))} style={{ gap: 8, border: 0, background: 'transparent', width: '100%', cursor: 'pointer', textAlign: 'left' }}>
                  <Ic d={open[k] ? I.chevD : I.chevR} s={13} style={{ color: 'var(--mut)' }} /><span className="lbl" style={{ color: 'var(--ink)' }}>{title}</span><span className="mut num">{items.length}</span><span className="mut" style={{ fontSize: 12, marginLeft: 6 }}>{sub}</span></button>
                {open[k] && <div style={{ borderTop: '1px solid var(--line2)' }}>
                  {!items.length && <div className="mut" style={{ padding: '10px 24px' }}>None</div>}
                  {items.map(p => (
                    <div key={p.id} className="srow">
                      <span className="av">{ini(p.name)}</span>
                      <div style={{ minWidth: 0 }}><div className="jt" style={{ fontWeight: 500 }}>{k === 'r' && <span className="newdot" />}{p.name}</div><div className="mut jt" style={{ fontSize: 12 }}>{KIND[p.kind]} · {p.company}</div></div>
                      <div className="jt" style={{ color: 'var(--t2)' }}>{p.job_title}</div>
                      <div className="mut num" style={{ fontSize: 12, textAlign: 'right' }}>Sent {p.sent_at}</div>
                      {k === 'f'
                        ? <a className="btn" target="_blank" rel="noopener noreferrer" href={gmailCompose({ email: p.email, email_subject: 'Re: ' + (p.email_subject || ''), email_body: `Hi ${first(p.name)},\n\nI wanted to follow up on my note from last week about the ${p.job_title} role. I'd still really welcome 15 minutes to hear about your work at ${p.company}.\n\nThank you,\n${data.me}` })}>Write follow-up</a>
                        : <a className={k === 'r' ? 'btn btn-p' : 'btn btn-g'} target="_blank" rel="noopener noreferrer" href={'https://mail.google.com/mail/u/0/#search/' + encodeURIComponent((k === 'r' ? 'from:' : 'to:') + p.email)}>{k === 'r' ? 'Reply in Gmail' : 'View'}</a>}
                    </div>))}
                </div>}
              </div>))}
          </div>
        </>}

        {view === 'profile' && <><div className="top"><div className="h1">Profile</div><div className="mut">Your files, what you want, and your connections.</div></div><Profile say={say} reloadApp={load} /></>}

        {guide && <Guide data={data} close={() => setGuide(false)} go={(v) => { setView(v); setGuide(false); }} run={() => act({ action: 'run' }, 'Started a search run')} />}
        {toast && <div className="toast" role="status">
          <Ic d={toast.err ? I.alert : toast.icon || I.check} style={{ color: toast.err ? '#FCA5A5' : '#A5B4FC' }} />{toast.msg}
          {toast.undo && <button className="btn" onClick={() => { setToast(null); undo(toast.undo); }}>Undo</button>}
        </div>}
      </main>
    </div>
  );
}

function Ghost({ j }) {
  const [d, text, color] = j.net ? [I.users, 'No open posting — reach out to people directly', 'var(--mut)']
    : j.ghost === 'confirmed' ? [I.check, 'Confirmed on the company’s careers page', 'var(--mut)']
    : j.ghost === 'not_found' ? [I.alert, 'Not found on the company’s careers page — may be a ghost posting', '#B45309']
    : [I.alert, 'Not checked against the company’s careers page', 'var(--mut)'];
  return <div className="row" style={{ gap: 6, marginTop: 6, fontSize: 12.5, color }}><Ic d={d} s={13} />{text}</div>;
}

// What to do next, from live counts; until setup is done, the steps point at the Profile page.
function Guide({ data, close, go, run }) {
  const s = data.run.setup, c = data.counts, ref = useRef();
  useEffect(() => { ref.current?.showModal(); }, []);
  const steps = [
    [s.resume && s.cover, 'Add your resume and cover letter', 'Upload your real Word files on your Profile. Only the words ever change — your layout stays.', 'profile'],
    [s.profile, 'Tell Claude what you’re looking for', 'On your Profile, talk it through with Claude — it’s fine not to know yet. It suggests kinds of jobs and fills in your search as you go: where, remote or not, level, pay.', 'profile'],
    [s.facts, 'Build your facts', 'On your Profile, add a few cover letters and emails you wrote, then press Build my profile. Claude writes down everything it may say about you; you read it over.', 'profile'],
    [!!data.run.daily, 'Run the first search', data.run.dailyRunning ? 'Running now. It reads several job boards and takes a while — you can close this.' : 'It starts by itself when you open the app.', data.run.dailyRunning ? null : 'run'],
  ];
  const todo = steps.findIndex(x => !x[0]);
  const nNew = c.new.list + c.new.net, nReady = c.ready.list + c.ready.net, nReply = data.sent.replies.length, nFollow = data.sent.followUp.length;
  const next = todo >= 0 ? [`Step ${todo + 1}: ${steps[todo][1].toLowerCase()}`, steps[todo][2], steps[todo][3]]
    : nNew ? [`Review ${nNew} new job${nNew > 1 ? 's' : ''}`, 'Open each one, then Pursue (Y) or Pass (N).', 'new']
    : nReady ? [`${nReady} job${nReady > 1 ? 's are' : ' is'} ready to send`, 'Download your files, copy each LinkedIn note, send the emails, then apply.', 'ready']
    : nReply || nFollow ? [nReply ? `${nReply} repl${nReply > 1 ? 'ies' : 'y'} waiting` : `${nFollow} follow-up${nFollow > 1 ? 's' : ''} due`, 'Answer replies; nudge anyone quiet for a week.', 'sent']
    : data.run.dailyRunning ? ['Claude is searching', 'New matches appear under New when it finishes.']
    : ['You’re caught up', 'The next search runs by itself when you open the app tomorrow.'];
  const doIt = (t) => t === 'run' ? (run(), ref.current.close()) : go(t);

  return (
    <dialog ref={ref} className="dlg" onClose={close} aria-labelledby="guide-h">
      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div id="guide-h" style={{ fontSize: 16, fontWeight: 600 }}>{todo >= 0 ? 'Get set up' : 'Guide'}</div>
          <button className="btn btn-g" aria-label="Close" style={{ width: 28, padding: 0 }} onClick={() => ref.current.close()}><Ic d={I.x} /></button>
        </div>
        <div className="card" style={{ padding: 14, background: 'var(--aw)', borderColor: 'transparent', display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ flex: 1 }}><div className="lbl" style={{ color: 'var(--a)' }}>Next</div><div style={{ fontWeight: 600, fontSize: 14, marginTop: 3 }}>{next[0]}</div><div className="mut" style={{ marginTop: 2 }}>{next[1]}</div></div>
          {next[2] && <button className="btn btn-p" onClick={() => doIt(next[2])}>{next[2] === 'profile' ? 'Open Profile' : next[2] === 'run' ? 'Start it' : 'Go'}</button>}
        </div>
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="lbl">Setup</div>
          {steps.map(([done, title, body], i) => (
            <div key={title} className="row" style={{ gap: 10, alignItems: 'flex-start', opacity: done ? .6 : 1 }}>
              <span className={done ? 'tick tick-on' : 'tick'} style={{ marginTop: 2, flex: 'none' }}>{done ? <Ic d={I.check} s={10} style={{ strokeWidth: 3 }} /> : <span className="num" style={{ fontSize: 10, color: 'var(--mut)' }}>{i + 1}</span>}</span>
              <div><div style={{ fontWeight: 600 }}>{title}</div>{!done && <div style={{ color: 'var(--t2)', marginTop: 2, lineHeight: 1.5 }}>{body}</div>}</div>
            </div>))}
          <div className="mut" style={{ fontSize: 12 }}>Optional: connect Gmail and Treg on your <button className="linkbtn" style={{ textDecoration: 'underline' }} onClick={() => go('profile')}>Profile</button>.</div>
        </section>
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="lbl">How it works</div>
          {[[I.inbox, 'New', 'Every day Claude finds jobs that fit your profile and checks each one is still live on the company’s site. You Pursue (Y) or Pass (N).'],
            [I.ready, 'Ready', 'For each job you pursue it finds 3 people — a manager, a recruiter, an alum — and writes a LinkedIn note and email for each in your voice, plus a tailored resume and cover letter.'],
            [I.sent, 'Sent', 'It reads your Gmail to tick off what you sent, show replies, and flag who needs a follow-up.']].map(([ic, t, d]) => (
            <div key={t} className="row" style={{ gap: 10, alignItems: 'flex-start' }}><Ic d={ic} style={{ marginTop: 2, color: 'var(--a)' }} /><div><b>{t}</b> <span style={{ color: 'var(--t2)' }}>— {d}</span></div></div>))}
          <div className="mut" style={{ fontSize: 12 }}>Nothing is sent for you. Applications, notes and emails are always your click.</div>
        </section>
      </div>
    </dialog>);
}

async function papi(body) {
  const r = await fetch('/api/profile', body instanceof FormData ? { method: 'POST', body } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong');
  return j;
}
const kb = (n) => n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';
const UPLOADS = [['resumes', 'Past resumes', 'Every version you have — Claude learns which bullets you’ve used.'],
  ['cover-letters', 'Cover letters you wrote', 'So new letters sound like you.'],
  ['writing', 'Emails and other writing', 'Networking emails especially — they set the voice for notes and emails.'],
  ['context', 'Project notes', 'Details of projects and work you can talk about in emails and interviews.']];

// Profile & settings: connections, her Word files, writing samples, and the two files every run reads.
function Profile({ say, reloadApp }) {
  const [p, setP] = useState(null);
  const [ed, setEd] = useState({});            // unsaved editor text, so polling never clobbers typing
  const [keys, setKeys] = useState({ GMAIL_ADDRESS: '', GMAIL_APP_PASSWORD: '', TREG_API_KEY: '' });
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState({});
  const [over, setOver] = useState('');
  const [setup, setSetup] = useState(null);
  const [gen, setGen] = useState(0);           // remounts the chat after a Start over
  const [sure, setSure] = useState('');        // which Start over button is asking to confirm

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([fetch('/api/profile', { cache: 'no-store' }), fetch('/api/state', { cache: 'no-store' })]);
      setP(await r.json()); setSetup((await s.json()).run.setup);
    } catch (e) { say(e.message, { err: true }); }
  }, [say]);
  useEffect(() => { load(); }, [load]);
  const live = p && (p.build.running || p.claude.loggingIn);
  useEffect(() => { if (!live) return; const t = setInterval(load, 4000); return () => clearInterval(t); }, [live, load]);
  const wasBuilding = useRef(false);
  useEffect(() => { if (!p) return; if (wasBuilding.current && !p.build.running) { say(p.build.last?.ok ? 'Profile built — read it over below' : 'Building failed — try again', { err: !p.build.last?.ok }); setEd({}); } wasBuilding.current = p.build.running; }, [p, say]);

  const run = async (tag, fn, ok) => { setBusy(tag); try { await fn(); ok && say(ok); } catch (e) { say(e.message, { err: true }); } setBusy(''); await load(); reloadApp(); };
  const upload = (to, files) => files?.length && run('up:' + to, () => { const fd = new FormData(); fd.append('to', to); for (const f of files) fd.append('file', f); return papi(fd); }, files.length > 1 ? `Added ${files.length} files` : 'Saved ' + files[0].name);
  const drop = (to) => ({
    onDragOver: (e) => { e.preventDefault(); setOver(to); }, onDragLeave: () => setOver(''),
    onDrop: (e) => { e.preventDefault(); setOver(''); upload(to, [...e.dataTransfer.files]); },
  });
  const picker = (to, label, accept, multiple = true) => <label className="btn" style={{ cursor: 'pointer' }}>{busy === 'up:' + to ? <Ic d={I.loader} cls="i spin" /> : <Ic d={I.upload} />}{label}
    <input type="file" accept={accept} multiple={multiple} hidden onChange={e => { upload(to, [...e.target.files]); e.target.value = ''; }} /></label>;
  const saveKeys = (tag, names) => run(tag, async () => { await api({ action: 'env', values: Object.fromEntries(names.map(k => [k, keys[k]])) }); setKeys(x => ({ ...x, ...Object.fromEntries(names.map(k => [k, ''])) })); }, tag === 'gmail' ? 'Gmail connected' : 'Treg key saved');
  const field = (k, label, type, ph) => <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}><span className="mut">{label}</span>
    <input className="inp" type={type} autoComplete="off" spellCheck={false} placeholder={ph} value={keys[k]} onChange={e => setKeys(x => ({ ...x, [k]: e.target.value }))} /></label>;
  const status = (on, yes, no) => <span className={on ? 'sentok' : 'mut'} style={{ fontSize: 12, marginLeft: 'auto' }}>{on ? <><Ic d={I.check} s={13} />{yes}</> : no}</span>;
  const H = ({ children, sub }) => <div><div style={{ fontSize: 15, fontWeight: 600 }}>{children}</div>{sub && <div className="mut" style={{ marginTop: 2 }}>{sub}</div>}</div>;
  const editor = (which, rows) => {
    const text = ed[which] ?? p[which].text, dirty = ed[which] !== undefined && ed[which] !== p[which].text;
    return <>
      <textarea className="inp mono" rows={rows} spellCheck={false} value={text} onChange={e => setEd(x => ({ ...x, [which]: e.target.value }))} style={{ height: 'auto', padding: 10, lineHeight: 1.55, resize: 'vertical' }} />
      <div className="row" style={{ gap: 10 }}>
        <button className="btn btn-ink" disabled={!dirty || busy === 'save:' + which} onClick={() => run('save:' + which, async () => { await papi({ action: 'save', which, text }); setEd(x => { const { [which]: _, ...rest } = x; return rest; }); }, 'Saved')}>Save</button>
        {dirty && <button className="btn btn-g" onClick={() => setEd(x => { const { [which]: _, ...rest } = x; return rest; })}>Discard changes</button>}
      </div></>;
  };

  if (!p) return <div className="zero"><div className="mut row" style={{ gap: 8 }}><Ic d={I.loader} cls="i spin" />Loading your profile</div></div>;
  const nUp = UPLOADS.reduce((n, [k]) => n + p.uploads[k].length, 0);

  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 24px 80px', display: 'flex', flexDirection: 'column', gap: 30 }}>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <H sub="What the app uses to search, write and track for you.">Connections</H>
          <div className="card" style={{ padding: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="mark" style={{ flex: 'none' }}><Ic d={I.compass} s={13} /></span>
            <div style={{ flex: 1, minWidth: 0 }}><b>Claude</b><div className="mut" style={{ fontSize: 12 }}>
              {p.claude.loggedIn ? `Signed in${p.claude.email ? ' as ' + p.claude.email : ''}${p.claude.plan ? ' · ' + p.claude.plan[0].toUpperCase() + p.claude.plan.slice(1) + ' plan' : ''}. Does all the searching and writing on your subscription.`
                : !p.claude.installed ? 'Claude Code isn’t installed. Run the install line from the README again.'
                : p.claude.loggingIn ? 'Finish signing in on the Claude page that just opened in your browser.'
                : 'Not signed in. Needs a Claude Pro or Max plan — every search and draft runs on it.'}</div></div>
            {p.claude.loggedIn ? status(true, 'Connected') : p.claude.installed && <button className="btn btn-p" disabled={p.claude.loggingIn} onClick={() => run('login', () => papi({ action: 'login' }))}>{p.claude.loggingIn ? <><Ic d={I.loader} cls="i spin" />Waiting…</> : 'Sign in'}</button>}
          </div>
          <form className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }} onSubmit={e => { e.preventDefault(); saveKeys('gmail', ['GMAIL_ADDRESS', 'GMAIL_APP_PASSWORD']); }}>
            <div className="row" style={{ gap: 8 }}><Ic d={I.mail} /><b>Gmail</b>{status(setup?.gmail, 'Connected', 'Optional')}</div>
            <div className="mut" style={{ fontSize: 12, lineHeight: 1.5 }}>Puts your emails in Gmail Drafts and sees what you sent and who replied. It never sends. Turn on 2-Step Verification, then make an app password named “Job Finder” at <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">myaccount.google.com/apppasswords</a> and paste it here.</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {field('GMAIL_ADDRESS', 'Gmail address', 'email', 'you@gmail.com')}
              {field('GMAIL_APP_PASSWORD', 'App password', 'password', setup?.gmail ? 'Saved — paste to replace' : 'abcd efgh ijkl mnop')}
            </div>
            <div><button className="btn" disabled={!keys.GMAIL_ADDRESS || !keys.GMAIL_APP_PASSWORD || busy === 'gmail'}>{busy === 'gmail' ? <><Ic d={I.loader} cls="i spin" />Checking…</> : setup?.gmail ? 'Replace' : 'Connect Gmail'}</button></div>
          </form>
          <form className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }} onSubmit={e => { e.preventDefault(); saveKeys('treg', ['TREG_API_KEY']); }}>
            <div className="row" style={{ gap: 8 }}><Ic d={I.users} /><b>Treg</b>{status(setup?.treg, 'Key saved', 'Optional')}</div>
            <div className="mut" style={{ fontSize: 12, lineHeight: 1.5 }}>Finds work email addresses for the people it picks. Without it you still get each person’s LinkedIn and note. Paste the API key from your Treg account settings.</div>
            {field('TREG_API_KEY', 'Treg API key', 'password', setup?.treg ? 'Saved — paste to replace' : '')}
            <div><button className="btn" disabled={!keys.TREG_API_KEY || busy === 'treg'}>{setup?.treg ? 'Replace' : 'Save key'}</button></div>
          </form>
          <div className="mut" style={{ fontSize: 12 }}>Keys stay on this computer.</div>
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <H sub="Your real Word files. Each job gets a copy with the words tailored — your layout never changes.">Resume and cover letter</H>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[['resume', 'Resume'], ['cover', 'Cover letter']].map(([k, label]) => { const d = p.docs[k]; return (
              <div key={k} {...drop(k)} className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, borderStyle: d ? 'solid' : 'dashed', borderColor: over === k ? 'var(--a)' : undefined, gridColumn: preview[k] ? '1 / -1' : undefined }}>
                <div className="row" style={{ gap: 8 }}><b>{label}</b>{d && <span className="mut" style={{ fontSize: 12, marginLeft: 'auto' }}>Updated {ago(d.at.replace('Z', '').replace('T', ' ').slice(0, 19))}</span>}</div>
                {d ? <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn" aria-expanded={!!preview[k]} onClick={() => setPreview(x => ({ ...x, [k]: !x[k] }))}>{preview[k] ? 'Hide' : 'Preview'}</button>
                    <a className="btn" href={'/api/profile?file=' + k}><Ic d={I.download} />Download</a>
                    {picker(k, 'Replace', '.docx', false)}</div>
                  : <><div className="mut" style={{ fontSize: 12 }}>Drop a .docx here, or pick one. From Google Docs: File → Download → Microsoft Word. A PDF turned into Word won’t work.</div><div>{picker(k, 'Upload ' + label.toLowerCase(), '.docx', false)}</div></>}
                {preview[k] && d && <DocPreview url={`/api/profile?file=${k}&v=${encodeURIComponent(d.at)}`} />}
              </div>); })}
          </div>
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <H sub="Every search follows this: which job boards it searches, where, and how Claude judges each job.">What you’re looking for</H>
          <Chat key={'c' + gen} say={say} onChange={() => { load(); reloadApp(); }} />
          <Settings key={'s' + gen} value={p.prefs.value} ready={p.prefs.ready} save={async (value) => { try { await papi({ action: 'prefs', value }); say('Saved'); await load(); reloadApp(); return true; } catch (e) { say(e.message, { err: true }); return false; } }} />
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <H sub="Claude reads these to learn your facts and your voice. Drop files on a box, or pick them. PDF, Word, .txt.">Writing samples <span className="mut num" style={{ fontWeight: 400 }}>· {nUp}</span></H>
          {UPLOADS.map(([k, label, hint]) => (
            <div key={k} {...drop(k)} className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8, borderColor: over === k ? 'var(--a)' : undefined }}>
              <div className="row" style={{ gap: 10 }}><div style={{ flex: 1 }}><b>{label}</b><div className="mut" style={{ fontSize: 12 }}>{hint}</div></div>{picker(k, 'Add files', '.pdf,.docx,.txt,.md')}</div>
              {p.uploads[k].map(f => (
                <div key={f.name} className="row" style={{ gap: 8, padding: '6px 0', borderTop: '1px solid var(--line2)' }}>
                  <a className="jt" style={{ flex: 1, textDecoration: 'none' }} href={'/api/profile?file=' + encodeURIComponent(k + '/' + f.name)} target="_blank" rel="noopener noreferrer">{f.name}</a>
                  <span className="mut num" style={{ fontSize: 12 }}>{kb(f.size)}</span>
                  <button className="btn btn-g" aria-label={'Remove ' + f.name} style={{ width: 26, height: 26, padding: 0 }} onClick={() => run('del', () => papi({ action: 'delete', path: k + '/' + f.name }), 'Removed ' + f.name)}><Ic d={I.x} s={13} /></button>
                </div>))}
            </div>))}
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <H sub="Everything Claude may say about you. If it isn’t here, it never goes in a resume, letter or email.">Your facts</H>
          <div className="card" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'center', background: 'var(--aw)', borderColor: 'transparent' }}>
            <div style={{ flex: 1 }}><b>{p.facts.text ? 'Rebuild from your files' : 'Build my profile'}</b><div className="mut" style={{ fontSize: 12, marginTop: 2 }}>
              {p.build.running ? 'Claude is reading your files and writing your facts. A few minutes — you can leave this page.'
                : !p.docs.resume && !nUp ? 'Add your resume and a few writing samples first.'
                : p.facts.text ? 'Adds anything new from your uploads and keeps your edits.' : 'Claude reads your resume and uploads, then writes your facts and preferences for you to check.'}</div></div>
            <button className="btn btn-p" disabled={p.build.running || (!p.docs.resume && !nUp) || busy === 'build'} onClick={() => run('build', async () => { await papi({ action: 'build' }); wasBuilding.current = true; }, 'Building your profile')}>
              {p.build.running ? <><Ic d={I.loader} cls="i spin" />Building…</> : p.facts.text ? 'Rebuild' : 'Build my profile'}</button>
          </div>
          {p.build.last && !p.build.running && p.build.last.ok === 0 && <div className="err" style={{ fontSize: 12 }}>The last build didn’t finish. Check Claude is signed in above, then try again.</div>}
          {p.facts.text ? editor('facts', 18) : <div className="mut" style={{ fontSize: 12 }}>No facts yet.</div>}
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <H sub="Deleted from this computer for good — there’s no undo.">Start over</H>
          <div className="card">
            {[['data', 'Clear job data', 'Every job found, the people and drafts for each, your tailored resumes and letters, and run history. Your profile stays, and a fresh search starts next time you open New.'],
              ['profile', 'Clear profile', 'Your resume, cover letter, writing samples, facts, search settings and the chat with Claude. Jobs already found stay.'],
              ['all', 'Clear everything', 'Both of the above, plus your Gmail and Treg keys. Like a fresh install; your Claude sign-in stays.']].map(([what, title, desc], i) => (
              <div key={what} className="row" style={{ gap: 14, padding: 14, borderTop: i ? '1px solid var(--line2)' : 0 }}>
                <div style={{ flex: 1 }}><b>{title}</b><div className="mut" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>{desc}</div></div>
                {sure === what ? <div className="row" style={{ gap: 6 }}>
                    <button className="btn btn-g" onClick={() => setSure('')}>Cancel</button>
                    <button className="btn btn-danger" disabled={busy === 'clear'} onClick={() => run('clear', async () => { await api({ action: 'clear', what }); setSure(''); setEd({}); setPreview({}); setGen(g => g + 1); }, title.replace('Clear', 'Cleared'))}>Yes, delete</button></div>
                  : <button className="btn" style={{ color: '#B91C1C' }} onClick={() => setSure(what)}>{title}</button>}
              </div>))}
          </div>
        </section>

      </div>
    </div>);
}

// The interview: Claude asks, she answers; settings it proposes are saved by the server and show up in the card.
function Chat({ onChange, say }) {
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState('');
  const [wait, setWait] = useState(false);
  const box = useRef();
  useEffect(() => { fetch('/api/interview', { cache: 'no-store' }).then(r => r.json()).then(j => { setMsgs(j.messages || []); setWait(!!j.busy); }).catch(() => setMsgs([])); }, []);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [msgs, wait]);
  const send = async (body, shown) => {
    setWait(true); setText('');
    if (shown) setMsgs(m => [...m, { role: 'you', text: shown }]);
    try {
      const r = await fetch('/api/interview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Something went wrong');
      setMsgs(j.messages);
      if (j.messages.at(-1)?.changed?.length) onChange();
    } catch (e) { say(e.message, { err: true }); if (shown) { setMsgs(m => m.slice(0, -1)); setText(shown); } }
    setWait(false);
  };
  const bold = (t) => t.split(/\*\*(.+?)\*\*/g).map((x, i) => i % 2 ? <b key={i}>{x}</b> : x);
  if (!msgs) return null;
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="row" style={{ gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--line2)' }}>
        <span className="mark" style={{ width: 20, height: 20 }}><Ic d={I.compass} s={12} /></span><b>Talk it through with Claude</b>
        {msgs.length > 0 && <button className="linkbtn" style={{ marginLeft: 'auto' }} disabled={wait} onClick={() => send({ reset: true })}>New conversation</button>}
      </div>
      {!msgs.length && !wait ? (
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ color: 'var(--t2)', lineHeight: 1.55 }}>Not sure what you want? That’s normal. Claude will ask about what you’ve done and liked, suggest kinds of jobs that fit, and fill in your search below as you go — where, remote or not, level, pay. Change anything later.</div>
          <button className="btn btn-p" onClick={() => send({ start: true })}>Start</button>
        </div>
      ) : (
        <div ref={box} style={{ maxHeight: 440, minHeight: 160, overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {msgs.map((m, i) => (
            <div key={i} style={{ alignSelf: m.role === 'you' ? 'flex-end' : 'flex-start', maxWidth: '86%' }}>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, padding: '8px 12px', borderRadius: 10, background: m.role === 'you' ? 'var(--a)' : 'var(--hov)', color: m.role === 'you' ? '#fff' : 'var(--ink)' }}>{bold(m.text)}</div>
              {m.changed?.length > 0 && <div className="mut row" style={{ gap: 5, fontSize: 11.5, marginTop: 4 }}><Ic d={I.check} s={12} style={{ color: 'var(--ok)' }} />Updated {m.changed.join(', ').toLowerCase()}</div>}
            </div>))}
          {wait && <div className="mut row" style={{ gap: 8 }}><Ic d={I.loader} cls="i spin" />Claude is thinking — searching the web can take a minute</div>}
        </div>)}
      {(msgs.length > 0 || wait) && (
        <form className="row" style={{ gap: 8, padding: 10, borderTop: '1px solid var(--line2)' }} onSubmit={e => { e.preventDefault(); text.trim() && send({ message: text.trim() }, text.trim()); }}>
          <textarea className="inp" rows={2} style={{ height: 'auto', padding: 8, resize: 'none' }} placeholder={wait ? '' : 'Answer, or ask anything — Enter sends'} value={text} disabled={wait}
            onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form.requestSubmit(); } }} />
          <button className="btn btn-p" disabled={wait || !text.trim()}>Send</button>
        </form>)}
    </div>);
}

// Her search settings: read-only until Edit. Field list and types come from lib/profile.js.
function Settings({ value, ready, save }) {
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const v = draft || value;
  const set = (k, x) => setDraft(d => ({ ...d, [k]: x }));
  const chips = (xs) => xs.length ? <div className="row" style={{ gap: 5, flexWrap: 'wrap' }}>{xs.map(x => <span key={x} className="tag">{x}</span>)}</div> : <span className="faint">—</span>;
  const view = (k, type, opts) => {
    const x = value[k];
    return type === 'list' ? chips(x) : type === 'multi' ? chips(x.map(y => opts[y]))
      : type === 'select' ? opts[x] : type === 'bool' ? (x ? 'Yes' : 'No')
      : type === 'money' ? (x ? '$' + x.toLocaleString() + ' a year' : 'Any') : type === 'number' ? x + ' miles'
      : x ? <span style={{ whiteSpace: 'pre-wrap' }}>{x}</span> : <span className="faint">—</span>;
  };
  const input = (k, type, opts) => {
    const x = v[k];
    if (type === 'list') return <textarea className="inp" rows={Math.min(8, (Array.isArray(x) ? x.length : x.split('\n').length) + 1)} style={{ height: 'auto', padding: 8 }} placeholder="One per line" value={Array.isArray(x) ? x.join('\n') : x} onChange={e => set(k, e.target.value)} />;
    if (type === 'long') return <textarea className="inp" rows={4} style={{ height: 'auto', padding: 8 }} value={x} onChange={e => set(k, e.target.value)} />;
    if (type === 'multi') return <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>{Object.entries(opts).map(([o, l]) => <label key={o} className="row" style={{ gap: 6 }}><input type="checkbox" checked={x.includes(o)} onChange={e => set(k, e.target.checked ? [...x, o] : x.filter(y => y !== o))} />{l}</label>)}</div>;
    if (type === 'select') return <select className="inp" value={x} onChange={e => set(k, e.target.value)}>{Object.entries(opts).map(([o, l]) => <option key={o} value={o}>{l}</option>)}</select>;
    if (type === 'bool') return <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={x} onChange={e => set(k, e.target.checked)} />Yes</label>;
    if (type === 'number' || type === 'money') return <input className="inp" type="number" min="0" step={type === 'money' ? 1000 : 5} style={{ maxWidth: 180 }} value={x} onChange={e => set(k, e.target.value)} />;
    return <input className="inp" value={x} onChange={e => set(k, e.target.value)} />;
  };
  return (
    <div className="card">
      <div className="row" style={{ gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--line2)' }}>
        <b>Your search</b>
        {ready ? <span className="sentok" style={{ fontSize: 12 }}><Ic d={I.check} s={13} />Ready</span> : <span className="mut" style={{ fontSize: 12 }}>Needs kinds of jobs, searches, and a city or remote</span>}
        <div style={{ marginLeft: 'auto' }} className="row">
          {draft ? <><button className="btn btn-g" onClick={() => setDraft(null)}>Cancel</button>
            <button className="btn btn-ink" style={{ marginLeft: 6 }} disabled={saving} onClick={async () => { setSaving(true); if (await save(draft)) setDraft(null); setSaving(false); }}>Save</button></>
            : <button className="btn" onClick={() => setDraft(value)}>Edit</button>}
        </div>
      </div>
      {SECTIONS.map(([title, fields]) => (
        <div key={title} style={{ padding: '12px 14px', borderBottom: '1px solid var(--line2)' }}>
          <div className="lbl" style={{ marginBottom: 8 }}>{title}</div>
          {fields.map(([k, label, type, opts]) => (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: '210px minmax(0,1fr)', gap: 12, padding: '5px 0', alignItems: 'baseline' }}>
              <div><div style={{ color: 'var(--t2)' }}>{label}</div>{draft && typeof opts === 'string' && <div className="faint" style={{ fontSize: 11.5 }}>{opts}</div>}</div>
              <div>{draft ? input(k, type, opts) : view(k, type, opts)}</div>
            </div>))}
        </div>))}
    </div>);
}

// A .docx drawn as it really looks (fonts, layout, page), loaded only when opened.
function DocPreview({ url }) {
  const ref = useRef();
  const [state, setState] = useState('loading');
  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const [{ renderAsync }, r] = await Promise.all([import('docx-preview'), fetch(url, { cache: 'no-store' })]);
        if (!r.ok) throw new Error('Couldn’t load the file');
        const blob = await r.blob();
        if (gone) return;
        ref.current.innerHTML = '';
        await renderAsync(blob, ref.current, null, { inWrapper: true, ignoreLastRenderedPageBreak: true, breakPages: true });
        if (!gone) setState('ok');
      } catch (e) { if (!gone) setState(e.message || 'Couldn’t show this file — download it instead'); }
    })();
    return () => { gone = true; };
  }, [url]);
  return <div className="docview">
    {state === 'loading' && <div className="mut row" style={{ gap: 8, padding: 16 }}><Ic d={I.loader} cls="i spin" />Opening</div>}
    {state !== 'loading' && state !== 'ok' && <div className="err" style={{ padding: 16 }}>{state}</div>}
    <div ref={ref} /></div>;
}

function ReadyJob(

{ j, gmail, act, say, diffOpen, setDiffOpen, exp, setExp, copied, setCopied }) {
  const m = j.materials || {};
  const [show, setShow] = useState(null);   // which file is open in the preview
  const file = (which) => `/api/file?which=${which}&key=${encodeURIComponent(j.key)}`;
  const name = (p) => (p || '').split('/').pop();
  return (
    <div className="fadeA" style={{ padding: '20px 24px 40px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mut" style={{ fontSize: 12.5 }}>{j.company} · {j.location}{j.salary ? ' · ' + j.salary : ''}</div>
          <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-.01em', marginTop: 3 }}>{j.title}</div>
          <div className="row" style={{ gap: 10, marginTop: 8 }}><div className="bar" style={{ width: 160 }}><span style={{ width: Math.round(100 * j.progress.done / j.progress.total) + '%' }} /></div><span className="num" style={{ fontWeight: 500 }}>{j.progress.done} of {j.progress.total} done</span></div>
        </div>
        <a className="btn btn-lg" href={j.url} target="_blank" rel="noopener noreferrer">{j.net ? 'Careers page' : 'Open posting'} <Ic d={I.external} /></a>
      </div>

      {!j.net && <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12 }}>
        <span className={j.applied === 'confirmed' ? 'tick tick-on' : 'tick'}><Ic d={I.check} s={10} style={{ strokeWidth: 3 }} /></span>
        <div style={{ flex: 1 }}><div style={{ fontWeight: 500 }}>Apply</div><div className="mut" style={{ fontSize: 12 }}>{j.applied === 'confirmed' ? 'Done — confirmation email found in Gmail' : j.applied === 'opened' ? 'Watching Gmail for the “thanks for applying” email' : 'Ticks itself when the “thanks for applying” email arrives'}</div></div>
        <a className="btn btn-ink" href={j.url} target="_blank" rel="noopener noreferrer" onClick={() => act({ action: 'applyOpened', key: j.key })}>Open application</a>
      </div>}

      {!j.net && <div className="card">
        {[['resume', 'Your resume, same layout · only bullet choice and order changed'], ['cover', 'Your letter · paragraphs written for ' + j.company]].map(([w, sub], i) => (
          <div key={w} className="file" style={i ? { borderTop: '1px solid var(--line2)' } : null}>
            <span className="fic">DOCX</span>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 500 }}>{name(m[w])}</div><div className="mut" style={{ fontSize: 12 }}>{sub}</div></div>
            <button className="btn" aria-expanded={show === w} onClick={() => setShow(show === w ? null : w)}>{show === w ? 'Hide' : 'Preview'}</button>
            <a className="btn" href={file(w)} download><Ic d={I.download} />Download</a>
          </div>))}
        {show && <div style={{ borderTop: '1px solid var(--line2)' }}><DocPreview url={file(show)} /></div>}
        <div style={{ borderTop: '1px solid var(--line2)', padding: '8px 12px' }}>
          <button className="linkbtn" onClick={() => setDiffOpen(!diffOpen)} aria-expanded={diffOpen}><Ic d={diffOpen ? I.chevD : I.chevR} s={13} />{diffOpen ? 'Hide changes' : 'See what changed'}</button>
        </div>
        {diffOpen && <div className="fadeA" style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="diff">{(m.diff || []).map((t, i) => <div key={i} className={t.startsWith('+') ? 'ins' : t.startsWith('-') ? 'del' : 'ctx'}>{t}</div>)}{!(m.diff || []).length && <div className="ctx">No changes</div>}</div>
        </div>}
      </div>}

      <div>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <div className="lbl">People · same office first</div>
        </div>
        <div className="people">
          {j.people.map(p => {
            const sent = p.email_state === 'sent' || p.email_state === 'replied';
            return (
              <div key={p.id} className="card" style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start', borderBottom: '1px solid var(--line2)' }}>
                  <span className="av">{ini(p.name)}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row" style={{ gap: 6, justifyContent: 'space-between' }}><a className="jt" style={{ fontWeight: 600, textDecoration: 'none' }} href={p.linkedin} target="_blank" rel="noopener noreferrer">{p.name}</a><span className={p.kind === 'alum' ? 'role role-a' : 'role'}>{KIND[p.kind]}</span></div>
                    <div className="mut jt" style={{ fontSize: 12 }}>{p.title}</div>
                    {!/linkedin\.com\/in\//.test(p.linkedin || '') && <a className="linkbtn" style={{ marginTop: 2 }} target="_blank" rel="noopener noreferrer" href={'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(p.name.replace(/,.*$/, '') + ' ' + j.company)}><Ic d={I.external} s={12} />Find on LinkedIn</a>}
                    <button className="linkbtn" style={{ marginTop: 4 }} onClick={() => act({ action: 'swap', personId: p.id }, 'Swapped')}><Ic d={I.swap} s={12} />Swap person</button>
                  </div>
                </div>
                <div style={{ padding: 12, borderBottom: '1px solid var(--line2)', display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg)' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}><span className="lbl">1 · LinkedIn note</span><span className="mut num" style={{ fontSize: 11.5 }}>{(p.note || '').length}/300</span></div>
                  <div style={{ fontSize: 12.5, color: 'var(--t2)', lineHeight: 1.5 }}>{p.note}</div>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <button className="linkbtn" onClick={async () => { try { await navigator.clipboard.writeText(p.note || ''); setCopied(p.id); setTimeout(() => setCopied(null), 1400); } catch { say('Couldn’t copy — select the text instead', { err: true }); } }}>
                      <Ic d={copied === p.id ? I.check : I.copy} s={13} />{copied === p.id ? 'Copied' : 'Copy note'}</button>
                    <button className="linkbtn" style={{ color: 'var(--t2)' }} aria-pressed={!!p.note_sent} onClick={() => act({ action: 'note', personId: p.id, sent: !p.note_sent })}>
                      <span className={p.note_sent ? 'tick tick-on' : 'tick'}><Ic d={I.check} s={10} style={{ strokeWidth: 3 }} /></span>Note sent</button>
                  </div>
                </div>
                <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}><span className="lbl">2 · Email</span><span className="mut" style={{ fontSize: 11.5 }}>{p.email || 'no address found'}</span></div>
                  <div className={exp[p.id] ? 'mail mail-open' : 'mail'}>{p.email_body}</div>
                  <button className="linkbtn" onClick={() => setExp(e => ({ ...e, [p.id]: !e[p.id] }))}>{exp[p.id] ? 'Show less' : 'Show all'}</button>
                  <div style={{ marginTop: 'auto', paddingTop: 4 }}>
                    {sent ? <div className="row" style={{ height: 30, justifyContent: 'center' }}><span className="sentok"><Ic d={I.check} />{p.email_state === 'replied' ? 'Replied' : 'Sent · seen in Gmail'}</span></div>
                      : !p.email ? <div className="mut" style={{ fontSize: 12, textAlign: 'center' }}>No email found — the LinkedIn note is the way in.</div>
                      : p.email_state === 'drafted' ? <a className="btn" style={{ width: '100%' }} href="https://mail.google.com/mail/u/0/#drafts" target="_blank" rel="noopener noreferrer"><Ic d={I.mail} />Draft is in Gmail — open it</a>
                      : gmail ? <button className="btn" style={{ width: '100%' }} onClick={async () => { const r = await act({ action: 'draft', personId: p.id }); if (r) { say(r.attached ? 'Draft created with your resume attached — opening Gmail' : 'Draft created — opening Gmail'); window.open('https://mail.google.com/mail/u/0/#drafts', '_blank', 'noopener'); } }}>
                          <Ic d={I.mail} />Create draft in Gmail</button>
                      : <><a className="btn" style={{ width: '100%' }} href={gmailCompose(p)} target="_blank" rel="noopener noreferrer"><Ic d={I.mail} />Open in Gmail</a>
                          {p.kind === 'manager' && !j.net && <div className="mut" style={{ fontSize: 11.5, marginTop: 6, textAlign: 'center' }}>Attach your resume (download it above)</div>}</>}
                  </div>
                </div>
              </div>);
          })}
        </div>
      </div>
    </div>
  );
}

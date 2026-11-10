"""Harvest job postings from LinkedIn (public search) and Built In, for what profile/profile.json asks for.

Stage 1 of the search: cheap, deterministic, no AI. Pulls every listing for each search term x place
(her cities within her radius, plus US remote if she wants it), drops titles that can't fit, dedupes,
then fetches the full description for the survivors. Claude judges the survivors (prompts/find-jobs.md).

Usage: python3 scripts/harvest.py [--days 1] [--pages 5] [--out data]
"""
import argparse, concurrent.futures as cf, html, json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

LIST = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?"
DETAIL = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36"}

PROFILE = Path("profile/profile.json")
LEVEL = {"internship": "1", "entry": "2", "associate": "3", "mid-senior": "4", "director": "5"}   # LinkedIn f_E
JOB_TYPE = {"full-time": "F", "part-time": "P", "contract": "C", "temporary": "T", "internship": "I"}   # LinkedIn f_JT
SENIOR = ["senior", "sr", "lead", "principal", "director", "manager", "head", "vp", "vice president", "chief", "staff", "iii", "iv"]
# Built In has city sites for these; anywhere else it's LinkedIn (+ remote) only.
BUILTIN_CITIES = {"chicago": "https://www.builtinchicago.org", "new york": "https://www.builtinnyc.com", "boston": "https://www.builtinboston.com",
                  "los angeles": "https://www.builtinla.com", "seattle": "https://www.builtinseattle.com", "san francisco": "https://www.builtinsf.com",
                  "austin": "https://www.builtinaustin.com", "denver": "https://www.builtincolorado.com", "colorado": "https://www.builtincolorado.com"}


def words(ws, end=True):
    """Title regex from plain words. Exclusions match whole words ('intern' must not hit 'international');
    inclusions match word starts ('economi' hits 'economist')."""
    return re.compile(r"\b(?:" + "|".join(re.escape(w) for w in ws) + (r")\b" if end else ")"), re.I) if ws else None


def settings(path=PROFILE):
    """Search plan from her profile: queries, LinkedIn params per place, Built In lists, title filters."""
    if not path.exists():
        raise SystemExit("No profile/profile.json yet: set what you're looking for on the Profile page.")
    p = json.loads(path.read_text())
    places = [x for x in p.get("locations") or [] if x.strip()]
    if not p.get("search_terms") or not (places or p.get("remote")):
        raise SystemExit("profile/profile.json needs job-board searches and a city or remote: set them on the Profile page.")
    level, types = p.get("level") or "entry", p.get("job_types") or []
    base = {"f_E": LEVEL.get(level, "2")}
    if [t for t in types if t in JOB_TYPE]:
        base["f_JT"] = ",".join(JOB_TYPE[t] for t in types if t in JOB_TYPE)
    linkedin = [dict(base, location=x, distance=str(p.get("radius_miles") or 25), via="local") for x in places]
    path_ = "/jobs/entry-level?" if level in ("internship", "entry") else "/jobs?"
    builtin = sorted({(host + path_, "local") for x in places for city, host in BUILTIN_CITIES.items() if city in x.lower()})
    if p.get("remote"):
        linkedin.append(dict(base, location="United States", f_WT="2", via="remote"))
        builtin.append(("https://builtin.com/jobs/remote" + ("/entry-level?" if level in ("internship", "entry") else "?"), "remote"))
    skip = list(p.get("exclude_titles") or [])
    if level in ("internship", "entry", "associate"):
        skip += SENIOR
    if level != "internship" and "internship" not in types:
        skip += ["intern", "internship"]
    return {"queries": p["search_terms"], "linkedin": linkedin, "builtin": builtin,
            "exclude": words(skip), "include": words(p.get("include_titles") or [], end=False)}


def fits(title, s):
    return not (s["exclude"] and s["exclude"].search(title)) and (not s["include"] or s["include"].search(title))


def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # 429 / transient: back off and retry
            if i == tries - 1:
                print(f"  ! {url[:90]} -> {e}", file=sys.stderr)
                return ""
            time.sleep(2 ** (i + 1))


def text(s):
    s = re.sub(r"<br\s*/?>|</p>|</li>", "\n", s)
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def parse_cards(page):
    for li in re.split(r"<li>", page)[1:]:
        jid = re.search(r"jobPosting:(\d+)", li)
        title = re.search(r'base-search-card__title">(.*?)</h3>', li, re.S)
        if not (jid and title):
            continue
        company = re.search(r'base-search-card__subtitle">(.*?)</h4>', li, re.S)
        loc = re.search(r'job-search-card__location">(.*?)</span>', li, re.S)
        date = re.search(r'datetime="([\d-]+)"', li)
        yield {
            "id": jid.group(1), "source": "linkedin",
            "title": text(title.group(1)), "company": text(company.group(1)) if company else "",
            "location": text(loc.group(1)) if loc else "", "posted": date.group(1) if date else "",
            "url": f"https://www.linkedin.com/jobs/view/{jid.group(1)}",
        }


# Every fetched posting is appended here the moment it arrives, so a run that is killed or crashes
# loses nothing: the next run reuses these and only fetches what's missing. Entries expire after a week.
CACHE, CACHE_PATH, CACHE_DAYS = {}, None, 8


def load_cache(path):
    global CACHE, CACHE_PATH
    import datetime as dt
    CACHE_PATH, CACHE = Path(path), {}
    cutoff = (dt.date.today() - dt.timedelta(days=CACHE_DAYS)).isoformat()
    if CACHE_PATH.exists():
        for line in CACHE_PATH.read_text().splitlines():
            try:
                e = json.loads(line)
            except ValueError:
                continue  # a line cut off by a kill mid-write
            if e["at"] >= cutoff:
                CACHE[e["key"]] = e
    CACHE_PATH.write_text("".join(json.dumps(e) + "\n" for e in CACHE.values()))  # drop expired


def remember(key, value):
    import datetime as dt
    CACHE[key] = e = {"key": key, "at": dt.date.today().isoformat(), "value": value}
    with CACHE_PATH.open("a") as f:
        f.write(json.dumps(e) + "\n")


def detail(job):
    if job["id"] in CACHE:
        job.update(CACHE[job["id"]]["value"])
        return job
    time.sleep(1)
    page = get(DETAIL + job["id"])
    desc = re.search(r'show-more-less-html__markup[^>]*>(.*?)</div>', page, re.S)
    crit = dict(re.findall(r'description__job-criteria-subheader">\s*(.*?)\s*</h3>.*?criteria-text[^>]*>\s*(.*?)\s*</span>', page, re.S))
    pay = re.search(r'compensation__salary[^>]*>(.*?)</div>', page, re.S)
    fields = dict(description=text(desc.group(1)) if desc else "",
                  seniority=text(crit.get("Seniority level", "")),
                  employment=text(crit.get("Employment type", "")),
                  salary=text(pay.group(1)) if pay else "")
    if fields["description"]:  # a failed fetch isn't cached, so the next run retries it
        remember(job["id"], fields)
    job.update(fields)
    return job


def builtin(s, days, pages):
    """Built In city and remote search pages, then each job's JSON-LD."""
    import datetime as dt
    cutoff = (dt.date.today() - dt.timedelta(days=days)).isoformat()
    links, via = set(), {}
    for q in s["queries"]:
        for base, where in s["builtin"]:
            for p in range(1, pages + 1):
                host = base.split("/jobs")[0]
                found = {host + m for m in re.findall(r'/job/[a-z0-9-]+/\d+', get(base + urllib.parse.urlencode({"search": q, "page": p})))}
                if not found - links:
                    break
                links |= found
                for u in found:
                    via.setdefault(u, where)
    # The slug is the title: drop obvious misfits before paying ~2s (and 429 risk) per page.
    links = {u for u in links if fits(u.split("/job/")[1].rsplit("/", 1)[0].replace("-", " "), s)}
    jobs = []
    for url in sorted(links):
        if url in CACHE:
            jobs += [dict(j, via=via[url]) for j in CACHE[url]["value"] if j["posted"] >= cutoff]
            continue
        page = get(url)
        found = []
        for blob in re.findall(r'<script[^>]*ld\+json[^>]*>(.*?)</script>', page, re.S):
            try:
                d = json.loads(blob)
            except ValueError:
                continue
            for x in (d.get("@graph", [d]) if isinstance(d, dict) else d):
                if not isinstance(x, dict) or x.get("@type") != "JobPosting":
                    continue
                loc = x.get("jobLocation") or {}
                loc = loc[0] if isinstance(loc, list) and loc else loc
                addr = loc.get("address", {}) if isinstance(loc, dict) else {}
                sal = (x.get("baseSalary") or {}).get("value") or {}
                found.append({
                    "id": "bi-" + url.rsplit("/", 1)[-1], "source": "builtin", "url": url,
                    "title": text(x.get("title", "")), "company": (x.get("hiringOrganization") or {}).get("name", ""),
                    "location": "Remote" if x.get("jobLocationType") == "TELECOMMUTE" else ", ".join(filter(None, [addr.get("addressLocality"), addr.get("addressRegion")])),
                    "posted": x.get("datePosted", "")[:10], "description": text(x.get("description", "")),
                    "salary": f"${sal.get('minValue')}–${sal.get('maxValue')}" if sal.get("minValue") else "",
                    "seniority": "", "employment": str(x.get("employmentType", "")),
                })
        if page:
            remember(url, found)
        jobs += [dict(j, via=via[url]) for j in found if j["posted"] >= cutoff]
        time.sleep(2)  # Built In returns 429 below ~1 request/second
    return [j for j in jobs if fits(j["title"], s)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=1)
    ap.add_argument("--pages", type=int, default=5)
    ap.add_argument("--out", default="data")
    a = ap.parse_args()
    out = Path(a.out); out.mkdir(exist_ok=True)
    s = settings()
    load_cache(out / "harvest-cache.jsonl")

    seen, raw = {}, 0
    for q in s["queries"]:
        for loc in s["linkedin"]:
            for p in range(a.pages):
                params = {"keywords": q, "f_TPR": f"r{a.days * 86400}", "start": p * 10, **{k: v for k, v in loc.items() if k != "via"}}
                cards = list(parse_cards(get(LIST + urllib.parse.urlencode(params))))
                raw += len(cards)
                for c in cards:
                    if c["id"] not in seen and fits(c["title"], s):
                        seen[c["id"]] = dict(c, via=loc["via"])
                if len(cards) < 10:
                    break
                time.sleep(0.7)
        print(f"{q:<22} kept so far: {len(seen)}", file=sys.stderr)

    jobs = list(seen.values())
    # ponytail: one request at a time with a pause; 4 threads drew 429s from LinkedIn on a 1,100-job week.
    jobs = [detail(j) for j in jobs]
    bi = builtin(s, a.days, a.pages)
    print(f"builtin: {len(bi)}", file=sys.stderr)
    # Same job on several boards or under several IDs: dedupe by company + title + location.
    uniq = {}
    for j in jobs + bi:
        uniq.setdefault((j["company"].lower(), j["title"].lower(), j["location"].lower()), j)
    jobs = list(uniq.values())
    # The guest API ignores f_WT, so the remote search returns on-site jobs nationwide. Keep everything
    # found near her cities; from the remote search keep only what says remote. Claude verifies.
    jobs = [j for j in jobs if j.get("description") and (
        j.pop("via") == "local" or j["location"].strip() in ("United States", "US", "Remote")
        or re.search(r"\bremote\b", j["title"] + " " + j["description"], re.I))]

    import datetime as dt
    (out / "inbox").mkdir(exist_ok=True)
    path = out / "inbox" / f"harvest-{dt.date.today().isoformat()}.jsonl"
    path.write_text("".join(json.dumps(j) + "\n" for j in jobs))
    print(f"\nlistings seen: {raw} · passed title screen: {len(seen)} · unique with description: {len(jobs)} -> {path}", file=sys.stderr)


def _check():
    """A killed run resumes: fetched postings come back from the cache, failed ones are retried."""
    import tempfile
    global get, time
    calls, pages = [], {"1": '<div class="show-more-less-html__markup">Hello</div>', "2": ""}
    get = lambda url: calls.append(url) or pages[url.rsplit("/", 1)[-1]]
    time = type("T", (), {"sleep": staticmethod(lambda s: None)})
    path = Path(tempfile.mkdtemp()) / "cache.jsonl"
    path.write_text('{"key": "old", "at": "2000-01-01", "value": {}}\n')
    load_cache(path)
    assert "old" not in CACHE                                   # expired entries are dropped
    assert detail({"id": "1"})["description"] == "Hello" and detail({"id": "2"})["description"] == ""
    with path.open("a") as f:
        f.write('{"key": "3", "at"')                            # a write cut off by a kill
    load_cache(path); calls.clear()                             # the next run
    assert detail({"id": "1"})["description"] == "Hello" and calls == []   # reused, not fetched
    detail({"id": "2"})
    assert len(calls) == 1                                      # the failed one is fetched again
    # The search follows the profile: places, remote, level, filters.
    prof = path.parent / "p.json"
    prof.write_text(json.dumps({"search_terms": ["nurse"], "locations": ["Boston, MA"], "radius_miles": 10, "remote": False,
                                "level": "mid-senior", "job_types": ["full-time", "contract"], "exclude_titles": ["travel"]}))
    s = settings(prof)
    assert s["queries"] == ["nurse"] and s["linkedin"] == [{"f_E": "4", "f_JT": "F,C", "location": "Boston, MA", "distance": "10", "via": "local"}]
    assert s["builtin"] == [("https://www.builtinboston.com/jobs?", "local")]
    assert fits("Senior Nurse", s) and not fits("Travel Nurse", s) and not fits("Nurse Intern", s)
    prof.write_text(json.dumps({"search_terms": ["analyst"], "locations": [], "remote": True, "include_titles": ["economi"]}))
    s = settings(prof)
    assert [l["via"] for l in s["linkedin"]] == ["remote"] and s["builtin"][0][0].endswith("/remote/entry-level?")
    assert fits("Economist", s) and not fits("Senior Economist", s) and not fits("Data Analyst", s) and fits("International Economics Analyst", s)
    print("harvest ok")


if __name__ == "__main__":
    _check() if "--check" in sys.argv else main()

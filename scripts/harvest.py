"""Harvest entry-level job postings from LinkedIn (public search) and Built In (Chicago + remote).

Stage 1 of the search: cheap, deterministic, no AI. Pulls every listing for each
query x location, drops titles that can't fit, dedupes, then fetches the full
description for the survivors. Claude judges the survivors (prompts/find-jobs.md).

Usage: python3 scripts/harvest.py [--days 1] [--pages 5] [--out data]
"""
import argparse, concurrent.futures as cf, html, json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

LIST = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?"
DETAIL = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36"}

QUERIES = [
    "research analyst", "research associate", "research assistant", "economic analyst",
    "economic consulting", "economist", "policy analyst", "market research analyst",
    "data analyst", "business analyst", "strategy analyst", "pricing analyst",
    "energy analyst", "market analyst", "consulting analyst", "investment research",
    "credit analyst", "insights analyst", "analyst",
]
# f_WT=2 is remote. LinkedIn's default 25-mile radius around Chicago covers Evanston and Schaumburg.
LOCATIONS = [
    {"location": "Chicago, Illinois"},
    {"location": "United States", "f_WT": "2"},
]

# ponytail: regex title screen. It only removes obvious misfits; Claude reads everything that survives.
EXCLUDE = re.compile(
    r"\b(senior|sr\.?|lead|principal|director|manager|head|vp|vice president|chief|staff|"
    r"intern|internship|co-?op|fellowship|sales|account executive|business development|bdr|sdr|"
    r"engineer|developer|software|devops|architect|nurse|clinical|physician|therapist|"
    r"teacher|driver|technician|mechanic|warehouse|retail|store|cashier|real estate|leasing|"
    r"loan officer|insurance agent|recruiter|customer service|call center|payroll|bookkeeper|"
    r"accountant|tax|audit|iii|iv)\b", re.I)
NEAR = re.compile(r", IL\b|Illinois|Chicago", re.I)
INCLUDE = re.compile(
    r"analyst|research|economi|associate|consult|policy|insight|strategy|pricing|market|intelligence", re.I)


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


BUILTIN_LISTS = ["https://www.builtinchicago.org/jobs/entry-level?", "https://builtin.com/jobs/remote/entry-level?"]


def builtin(queries, days, pages):
    """Built In (Chicago + remote): entry-level search pages, then each job's JSON-LD."""
    import datetime as dt
    cutoff = (dt.date.today() - dt.timedelta(days=days)).isoformat()
    links = set()
    for q in queries:
        for base in BUILTIN_LISTS:
            for p in range(1, pages + 1):
                host = base.split("/jobs")[0]
                found = {host + m for m in re.findall(r'/job/[a-z0-9-]+/\d+', get(base + urllib.parse.urlencode({"search": q, "page": p})))}
                if not found - links:
                    break
                links |= found
    # The slug is the title: drop obvious misfits before paying ~2s (and 429 risk) per page.
    links = {u for u in links if not EXCLUDE.search(u.split("/job/")[1].rsplit("/", 1)[0].replace("-", " "))}
    jobs = []
    for url in sorted(links):
        if url in CACHE:
            jobs += [j for j in CACHE[url]["value"] if j["posted"] >= cutoff]
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
        jobs += [j for j in found if j["posted"] >= cutoff]
        time.sleep(2)  # Built In returns 429 below ~1 request/second
    return [j for j in jobs if INCLUDE.search(j["title"]) and not EXCLUDE.search(j["title"])]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=1)
    ap.add_argument("--pages", type=int, default=5)
    ap.add_argument("--out", default="data")
    a = ap.parse_args()
    out = Path(a.out); out.mkdir(exist_ok=True)
    load_cache(out / "harvest-cache.jsonl")

    seen, raw = {}, 0
    for q in QUERIES:
        for loc in LOCATIONS:
            for p in range(a.pages):
                params = {"keywords": q, "f_E": "2", "f_JT": "F", "f_TPR": f"r{a.days * 86400}", "start": p * 10, **loc}
                cards = list(parse_cards(get(LIST + urllib.parse.urlencode(params))))
                raw += len(cards)
                for c in cards:
                    if c["id"] not in seen and INCLUDE.search(c["title"]) and not EXCLUDE.search(c["title"]):
                        seen[c["id"]] = c
                if len(cards) < 10:
                    break
                time.sleep(0.7)
        print(f"{q:<22} kept so far: {len(seen)}", file=sys.stderr)

    jobs = list(seen.values())
    # ponytail: one request at a time with a pause; 4 threads drew 429s from LinkedIn on a 1,100-job week.
    jobs = [detail(j) for j in jobs]
    bi = builtin(QUERIES, a.days, a.pages)
    print(f"builtin: {len(bi)}", file=sys.stderr)
    # Same job on several boards or under several IDs: dedupe by company + title + location.
    uniq = {}
    for j in jobs + bi:
        uniq.setdefault((j["company"].lower(), j["title"].lower(), j["location"].lower()), j)
    jobs = list(uniq.values())
    # The guest API ignores f_WT, so the "remote" query returns on-site jobs nationwide.
    # Keep Chicagoland, bare "United States", or anything whose text says remote; Claude verifies.
    jobs = [j for j in jobs if j.get("description") and (
        NEAR.search(j["location"]) or j["location"].strip() in ("United States", "US", "Remote")
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
    print("harvest ok")


if __name__ == "__main__":
    _check() if "--check" in sys.argv else main()

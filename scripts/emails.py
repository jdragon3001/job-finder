"""Find a work email for one person via Treg (find + verify). Prints the address, or nothing.

  python3 scripts/emails.py find "<full name>" "<company domain>"

Needs TREG_API_KEY in .env. Without it this prints nothing and exits 0, so people still show (without email).
ponytail: Treg's API isn't wired yet — no docs/key in hand (decided Nov 8: build now, key later). When the key
arrives, implement lookup() against Treg's find + verify endpoints and return only verified addresses.
"""
import os, sys
from pathlib import Path


def env():
    p = Path(".env")
    if p.exists():
        for line in p.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1); os.environ.setdefault(k.strip(), v.strip().strip('"'))


def lookup(name, domain):
    raise NotImplementedError("Treg lookup not wired yet — see the note at the top of scripts/emails.py")


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1] != "find":
        print(__doc__); sys.exit(2)
    env()
    if not os.environ.get("TREG_API_KEY"):
        print("emails: no TREG_API_KEY, skipping", file=sys.stderr); sys.exit(0)
    print(lookup(sys.argv[2], sys.argv[3]) or "")

"""Extract the exact tagged version's release notes; reject missing/empty entries."""

import pathlib
import re
import sys


def release_notes(changelog: str, tag: str) -> str:
    version = tag.removeprefix("v")
    heading = re.search(r"^## " + re.escape(version) + r"(?=\s|$)[^\n]*\n", changelog, re.M)
    if not heading:
        raise ValueError(f"Missing CHANGELOG.md entry for {tag}")
    body = re.split(r"^## ", changelog[heading.end():], maxsplit=1, flags=re.M)[0].strip()
    if not body:
        raise ValueError(f"Empty CHANGELOG.md entry for {tag}")
    return body


if __name__ == "__main__":
    print(release_notes(pathlib.Path("CHANGELOG.md").read_text(encoding="utf-8"), sys.argv[1]))

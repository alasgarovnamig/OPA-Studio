#!/usr/bin/env python3
"""Generate docs/VERSIONS.md: every OPA release and its OPA Studio release."""
import sys

from common import DIALECTS, REPO_URL, available, builtin_names, commands, manifest, versions

KEYS = [("compile", "Compile"), ("health", "Health"), ("config", "Config"), ("status", "Status"), ("compile_path", "Filtering")]


def main(out):
    vs = versions()
    L = ["# All supported OPA versions", "",
         "OPA Studio publishes **one release per OPA release**: Studio tag `vX.Y.Z` targets OPA `vX.Y.Z`. "
         "%d OPA versions are supported — every release since v0.1.0 (2016). Each tag has its own README with "
         "screenshots captured against that OPA version." % len(vs), "",
         "Columns were measured from the official binaries (see [compatibility.md](compatibility.md)). "
         "*Cmds* counts CLI commands; the API columns show whether the REST capability exists.", ""]
    groups = {}
    for e in vs:
        major, minor = e["tag"].lstrip("v").split(".")[:2]
        groups.setdefault("v%s.%s" % (major, minor), []).append(e)
    L.append("**Lines:** " + " · ".join("[%s](#%s)" % (g, g.replace(".", "")) for g in reversed(list(groups))))
    L.append("")
    for g in reversed(list(groups)):
        L.append("## %s" % g)
        L.append("")
        L.append("| OPA Studio release | OPA released | Rego dialect | Cmds | " + " | ".join(k[1] for k in KEYS) + " | Built-ins | OPA release notes |")
        L.append("|---|---|---|---|" + "---|" * len(KEYS) + "---|---|")
        for e in reversed(groups[g]):
            m = manifest(e["tag"])
            notes = []
            if e.get("prerelease"):
                notes.append("pre-release")
            if not e.get("github_release", True):
                notes.append("image-only tag")
            if any(m["server"].get("quirks", {}).values()):
                notes.append("⚠️ quirk")
            tag = "[`%s`](%s/tree/%s)" % (e["tag"], REPO_URL, e["tag"])
            if notes:
                tag += " <sub>%s</sub>" % ", ".join(notes)
            L.append("| %s | %s | %s | %d | %s | %s | [upstream](%s) |" % (
                tag, (e.get("published_at") or "")[:10], DIALECTS[m["preferred_dialect"]][0], len(commands(m)),
                " | ".join("✅" if available(m, k) else "—" for k, _ in KEYS), len(builtin_names(m)) or "—", e["release_url"]))
        L.append("")
    open(out, "w").write("\n".join(L))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "docs/VERSIONS.md")

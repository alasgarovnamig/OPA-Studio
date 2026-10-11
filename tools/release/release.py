#!/usr/bin/env python3
"""Create the release commit and tag of OPA Studio for one OPA version.

  release.py --version v1.0.0 --shots <dir with *.webp + report.json> [--validation report.json] [--no-tag]

The commit stamps the version everywhere it is used as a default
(OPA_VERSION, internal/buildinfo, Dockerfile, deployment manifests), replaces
docs/screenshots with the screenshots captured against that OPA release and
regenerates README.md. The annotated tag has the same name as the OPA version.
"""
import argparse
import json
import os
import re
import shutil
import subprocess

from common import ROOT, linux_platforms, manifest, semver_key, versions
import readme

TRAILER = "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"


def sub(path, pattern, repl, count=1):
    p = os.path.join(ROOT, path)
    s = open(p).read()
    s2, n = re.subn(pattern, repl, s, count=count, flags=re.M)
    if n == 0:
        raise SystemExit("pattern %r not found in %s" % (pattern, path))
    open(p, "w").write(s2)


COMPOSE_STUDIO_ONLY = """# OPA Studio for OPA {v}.
#
#   docker compose -f deploy/docker-compose.yml up
#
# OPA {v} has no `opa run --set` flag, so this release ships no agent example;
# connect existing OPA servers with OPA_STUDIO_CONNECTIONS.
services:
  studio:
    image: ghcr.io/alasgarovnamig/opa-studio:{v}
    ports:
      - "9080:9080"
    environment:
      OPA_STUDIO_AUTH_MODE: basic
      OPA_STUDIO_BASIC_USER: admin
      OPA_STUDIO_BASIC_PASSWORD: ${{OPA_STUDIO_BASIC_PASSWORD:?set OPA_STUDIO_BASIC_PASSWORD}}
    volumes:
      - studio-data:/var/lib/opa-studio
    restart: unless-stopped

volumes:
  studio-data:
"""


def stamp(version):
    entry = next(e for e in versions() if e["tag"] == version)
    m = manifest(version)
    _, opa_image = linux_platforms(entry)
    open(os.path.join(ROOT, "OPA_VERSION"), "w").write(version + "\n")
    sub("internal/buildinfo/buildinfo.go", r'^(\tOPAVersion = )"[^"]*"', r'\g<1>"%s"' % version)
    sub("Dockerfile", r"^ARG OPA_VERSION=\S+", "ARG OPA_VERSION=%s" % version)
    sub("Dockerfile", r"^ARG OPA_IMAGE=\S+", "ARG OPA_IMAGE=%s" % (opa_image or "busybox:1.36.1"))
    sub("deploy/kubernetes/opa-studio.yaml", r"(image: ghcr.io/alasgarovnamig/opa-studio:)\S+", r"\g<1>%s" % version)
    compose = os.path.join(ROOT, "deploy", "docker-compose.yml")
    if "set" in m["cli"]["commands"].get("run", {}).get("flags", {}):
        tmpl = open(os.path.join(ROOT, "tools", "release", "docker-compose.tmpl.yml")).read()
        tmpl = tmpl.replace("@OPA_VERSION@", version).replace("@OPA_IMAGE_TAG@", version.lstrip("v"))
        if semver_key(version) < semver_key("v0.13.0"):
            # Before v0.13.0 OPA downloads a single bundle configured under `bundle`.
            tmpl = tmpl.replace("      - --set=bundles.app.service=studio\n      - --set=bundles.app.resource=bundles/app\n",
                                "      - --set=bundle.name=app\n      - --set=bundle.service=studio\n")
        open(compose, "w").write(tmpl)
    else:
        open(compose, "w").write(COMPOSE_STUDIO_ONLY.format(v=version))


def screenshots(src):
    dst = os.path.join(ROOT, "docs", "screenshots")
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    os.makedirs(dst)
    report = json.load(open(os.path.join(src, "report.json")))
    for s in report["screens"]:
        if s.get("file"):
            shutil.copy(os.path.join(src, s["file"]), os.path.join(dst, s["file"]))
    # Keep the machine-readable verification next to the images.
    json.dump(report, open(os.path.join(dst, "report.json"), "w"), indent=1)
    return report


def git(*args, **kw):
    return subprocess.run(["git"] + list(args), cwd=ROOT, check=True, **kw)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", required=True)
    ap.add_argument("--shots", required=True)
    ap.add_argument("--validation")
    ap.add_argument("--no-tag", action="store_true")
    ap.add_argument("--no-commit", action="store_true")
    a = ap.parse_args()
    v = a.version
    stamp(v)
    report = screenshots(a.shots)
    validation = readme.load_validation(a.validation).get(v)
    open(os.path.join(ROOT, "README.md"), "w").write(readme.render(v, "docs/screenshots", report, validation))
    if a.no_commit:
        return
    m = manifest(v)
    pages = len([s for s in report["screens"] if s.get("file")])
    msg = "Release %s for OPA %s\n\nTargets OPA %s (%s Rego dialect, %d CLI commands).\nREADME and %d screenshots captured against OPA %s.\n\n%s\n" % (
        v, v, v, readme.DIALECTS[m["preferred_dialect"]][0], len(readme.commands(m)), pages, v, TRAILER)
    git("add", "-A", "OPA_VERSION", "README.md", "Dockerfile", "deploy", "internal/buildinfo", "docs/screenshots")
    git("commit", "-q", "-m", msg)
    if not a.no_tag:
        git("tag", "-a", v, "-m", "OPA Studio %s — for Open Policy Agent %s" % (v, v))


if __name__ == "__main__":
    main()

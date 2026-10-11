# Minimal sandbox used to introspect a single OPA binary (CLI + REST API).
# The binary under test is mounted at /opa/opa at runtime.
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY probe.py /probe.py
ENTRYPOINT ["python3", "/probe.py"]

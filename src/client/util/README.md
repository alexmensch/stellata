# Util

Project-agnostic plumbing. Each topic owns a subfolder; the parent only
holds this coordinator.

- `event-bus/` — typed pub/sub used by `stellata.ts` for fan-out.
- `url-state/` — `?v=` URL wire format (v1/v2/v3) and the address-bar
  round-trip.

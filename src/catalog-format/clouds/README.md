# Clouds artifact — the wire contract

`clouds-schema.ts` — `public/clouds.json`'s schema, the one statement both
sides compile against: the file wrapper (`CloudsFile`, with the build-side
`CloudNoiseModel`), the cloud row (`CloudRow`, plus the `sid` the emit adds)
and its `CloudSource` / `CloudClass` enums and `EmbeddedStar`. The version
is `CLOUDS_JSON_SCHEMA` (`../baker-artifacts/`). The build that writes the
file is [`/scripts/clouds/`](/scripts/clouds/README.md), whose
[Output schema](/scripts/clouds/README.md#output-schema) carries each
field's meaning; the loader that decodes it into the viewer's `Cloud` is
`/src/client/molecular-clouds/cloud-loader.ts`.

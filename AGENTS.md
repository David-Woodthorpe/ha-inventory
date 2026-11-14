# Agent notes

Conventions for AI assistants working in this repository. Human-facing docs live in
`README.md` and `DOCS.md`; this file is about keeping them — and the assistant-facing
docs — from going stale.

## Docs are part of the feature

`/llms.txt`, the OpenAPI schema and the API page are written by hand, so a new or
changed endpoint does not update them automatically. Treat the following as part of
"done", not as follow-up work:

| If you change… | Also update |
| --- | --- |
| an endpoint, request body, field or response shape | `src/routes/llms.txt/+server.ts`, `src/lib/server/openapi.ts`, the endpoint table and examples in `README.md` |
| stock, transfer or component-signout behaviour | `src/routes/llms.txt/+server.ts` ("Rules for AI agents" and "Notes"), `README.md` |
| the Item shape or a validation rule | `src/lib/server/schemas.ts`, `src/routes/llms.txt/+server.ts` ("Item shape"), `src/lib/server/openapi.ts` |
| a database migration | `src/lib/server/db.ts` (append to `migrations`), and note any new field in the Item shape docs |
| an add-on option or environment variable | `config.yaml` (`options` + `schema`), `DOCS.md`, `.env.example`, `README.md` "Configuration" |
| the version number | `package.json`, `config.yaml`, `src/lib/server/config.ts` (`appVersion`) — all three, they are independent literals |
| a user-visible feature | `README.md` "Features" |

## Writing the assistant-facing docs

`/llms.txt` is the file assistants read first, so it is the highest-value document in
the repo. Keep it:

- **Honest about this instance.** Pricing, authentication and Home Assistant status
  change per deployment; say what is true rather than what is possible.
- **Ordered by what an agent should do.** "Call `GET /meta` first", "search before
  creating", "never invent IDs" — rules, then endpoints, then shapes, then examples.
- **Concrete.** One working `curl` per concept beats three paragraphs of prose.

The same rules apply to `src/routes/api/+page.svelte`, which is the same content for
humans.

## External assistant skill

An OpenCode skill lives outside this repository at
`~/.config/opencode/skills/inventory/SKILL.md`. It encodes the workflow and
conventions (naming, SKU/MPN use, datasheet verification, stock-adjustment rules),
not the endpoint list.

If a change alters *how* an assistant should work with the API — a new required
field, a changed stock model, a deprecated endpoint — state that in the commit
message so the skill can be updated alongside it. Endpoint additions alone usually
do not need it, because the skill defers to `/llms.txt` for the endpoint list.

## Before committing

```bash
npm run check    # type-check
npm run build    # verify the production build
```

Both must pass. The UI is dependency-free by design (hand-written CSS, inline SVG,
Svelte 5 runes), so prefer an existing pattern over adding a package.

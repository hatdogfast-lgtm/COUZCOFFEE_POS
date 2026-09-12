# Rework — working documents

Two pieces of work are in flight on this repository. Each has its own document;
this page says what they are, what state they are in, and what has to happen next.

| Track | Document | State |
|---|---|---|
| Visual redesign of the whole app | [`ui-redesign.md`](./ui-redesign.md) | Direction confirmed. **Plan A built 2026-09-12** on local `main` (tokens, shell, till, lock, receipt, Android). Plan B (remaining screens) not started. |
| One import template for ingredients + recipes | [`data-import.md`](./data-import.md) | **Built 2026-09-12** on branch `rework/menu-import`. Decisions recorded in the document; G10 and five minor gaps left open on purpose. |

The import track is built and merged to local `main` (its branch is also on GitHub as
`rework/menu-import`). The UI track's Plan A is built on local `main`. Neither is pushed
to `origin/main`. The pre-existing native-backup edits were committed on their own,
ahead of the redesign, so they stay separate from it.

## How to read these

Each document separates three things, and the distinction matters:

- **Decided** — the shop owner said so. Treat as fixed; changing it is a new decision.
- **Assumed** — inferred from something they said, but never confirmed in those words.
  Every assumption is listed explicitly. Confirm before building on one.
- **Open** — a genuine fork that nobody has settled yet.

Claims about existing behaviour cite `file:line`. Anything not cited is either
stated as unverified or is a decision rather than a fact.

## The one rule spanning both tracks

The owner's words: *"everything but the logic of the current system stays."*

That maps onto a boundary this codebase happens to make checkable:

| | Count | Fate |
|---|---|---|
| `.tsx` — screens, sheets, panels, editors | 49 | May be rewritten |
| `.ts` — db, sync, checkout, printing, pricing | 36 | Do not touch |
| `.test.ts` | 19 | Do not touch, and must stay green |
| `packages/shared` + `packages/server` | 22 | Do not touch |

Verified: **no `.tsx` file in this codebase writes to the database directly.**
(Checked by grepping every `.tsx` for `db.transaction` and `db.*.put/add/delete/bulk` —
no matches.) The separation is real, not aspirational.

`npm test` passing unchanged is therefore the acceptance criterion for the UI
track. It exercises checkout maths, the stock ledger, backups, end-of-day,
receipts and RBAC. If those pass, the logic demonstrably did not move.

**The import track breaks this rule on purpose** — it cannot be done without
editing `importing.ts`, which is a `.ts` file. That is a deliberate exception the
owner asked for, scoped to that one file, and it is flagged again in that document. Done: only `importing.ts` and its test changed.

## Two edges where the boundary blurs

- **`providers.tsx`** (255 lines) is `.tsx` but holds session, permissions and
  money formatting — plumbing, not visuals. Restyle nothing in it; touch it only
  if the new shell genuinely needs a different provider order.
- **`printing.ts`** generates the ESC/POS byte stream for the thermal printer.
  The receipt's on-screen appearance and its print CSS are in scope. The bytes
  going to the printer are not.

## Session context

- Shop: **Couz Coffee** (`android/app/src/main/res/values/strings.xml`)
- Currency: **en-PH**, symbol ₱ (`packages/shared/src/money.ts:76`)
- Package id: `com.pos.offlinefirst`
- Web deploy: Vercel, **static only** — `vercel.json` sets `framework: null`,
  `outputDirectory: dist`, no functions, no API routes. `packages/server` is not
  deployed anywhere.

# profiles

Sample Phase 1 settings for the typed chat. `npm run chat` lists these files and asks you to pick one. Each is the same JSON the browser form produces, checked by `parseIntake` (`src/core/intake.ts`).

| File | Who | Tonight | Streaming |
|---|---|---|---|
| `solo.json` | Alex, 29, alone | no time limit, no genres skipped | Netflix |
| `couple.json` | Maria, 34, with a partner | up to 120 minutes, no war movies | none, so the pool comes from the local catalogue |
| `family.json` | Sam, 38, with kids (youngest 8, so PG) | up to 100 minutes, no horror | Netflix, Disney+, Amazon Prime Video |

All three are in the Netherlands (`NL`). The family pool is the small one (about 600 movies) and the couple's the largest (about 19,000), so between them they cover both ends. The tests check that every JSON file here passes `parseIntake`, and `solo.json` is the profile behind `freshIS` in `test/fixtures.ts`.

To add a profile, copy one of these. `platforms` are TMDB provider ids, `company` is `alone`, `relationship`, `family` or `friends`, and `youngestAge` is only read for family and friends.

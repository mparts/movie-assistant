# dialogue

The dialogue manager and the two LLM calls it makes on each user turn.

- `dme.ts` is the Dialogue Manager Engine, an xstate machine with two states.
  - `Select` calls `respond` and sends Elisa's `say` move to the parent machine as `NEXT_MOVES`.
  - `Update` waits for `SAYS`, then goes Grounding => Understand (the NLU, for user text only) => Integrate (the rules from `core/rules.ts`) => Retrieve (embed new wish and avoid texts, then rank the pool).

  Elisa's own turn comes back through `SAYS` too, so her suggestion is integrated like any other move. After her turn, Update starts again and waits for the user. After a user turn it goes on to Select. `ruleChain` builds the Integrate states: each rule fires if it applies, and the chain moves on either way. Query vectors are cached by text in `context.vectors`, so only new texts are embedded. If embedding fails, the turn is ranked without the wish.
- `nlu.ts` turns an utterance into moves. `understand` sends the last few turns, `stateSummary` and the utterance to the LLM, with the prompt chosen by `qud`. A bare "yes" right after Elisa named her suggestion becomes an `accept` without asking the LLM (`isAffirmation`). The LLM's answer then goes through three checks:
  - `clean` drops anything that is not a well-formed move.
  - `repairMoves` splits refusals out of the wish into avoids. "A magical adventure with no princesses and lots of laughs." gives the wish "A magical adventure with lots of laughs." and the avoid "princesses". This matters because an embedding of "no princesses" is close to princess movies. It also folds a stray `adjust` move ("goofier") into the wish.
  - `ground` drops moves the user's own words do not support: a wish copied from Elisa's last turn, a person the user never named, hesitation ("not sure yet") taken as taste, or an `accept` when nothing was suggested.

  The dropped moves are returned as well, for the debug view.
- `respond.ts` writes Elisa's reply. `replyMode` picks one of four modes from the state:
  - `wrapup` once a suggestion is accepted
  - `discuss` while the last suggestion is still open
  - `recommend` once there is taste and the user has spoken `minUserTurns` times
  - `explore` before that

  `respond` builds the prompt from `respondSystem`, the mode's instructions, the state as JSON and the recent history, then checks the answer. Candidates are shown only in recommend mode, and a recommended id must be one of them. If the reply names a candidate but leaves the id out, that candidate is taken. In any other mode a reply that names a candidate is retried (`respondAttempts`), and after that a fixed fallback line is used. `facts` limits what Elisa knows about a movie to what TMDB returned. The opening and the reply to silence are fixed lines, with no LLM call.
- `debugView.ts` is what prints in the browser console (F12) and in the typed chat. First one line for tonight's settings and pool, then one group per turn: the moves kept and dropped, the state, the reply mode and why, which LLM backend answered, and the top 5 movies with each term of their score. `elisa.state()` in the browser and `/state` in the chat print the same group on demand.

# patches

Fixes to dependencies, applied by `patch-package` from the `postinstall` script on every `npm install`.

- `speechstate+2.17.0.patch` makes speechstate's `asr.js` send `LISTEN_COMPLETE` when recognition fails. Without it, a failed Azure abort ("Another turn started before current completed") leaves speechstate waiting forever and the dialogue freezes. The full story is in `docs/speechstate-asr-hang.md`.

The patch is tied to speechstate 2.17.0. After an upgrade, `npm install` says so if it no longer applies. Drop it once speechstate handles `onerror` itself.

# speechstate: ASR hangs when the Azure abort fails

speechstate 2.17.0, web-speech-cognitive-services 8.1.4, microsoft-cognitiveservices-speech-sdk 1.53.0, bargeIn off, completeTimeout 0.

**What happened.** Now and then the dialogue froze after the user spoke. The console showed `Another turn started before current completed.` from `web-speech-cognitive-services.js`, and speechstate never sent `LISTEN_COMPLETE`.

**Why.** After `RECOGNISED`, the ASR machine goes to `WaitToStop` and calls `recognition.abort()`. The ponyfill then awaits `stopContinuousRecognitionAsync`. If Azure starts a new speech turn during that stop (the user keeps talking, or noise), the SDK rejects with that error (`RequestSession.onServiceTurnStartResponse`). The ponyfill catches it and dispatches an `error` event, but no `end` event. `asr.js` only listens to `onend` and `onabort`, so `LISTEN_COMPLETE` never arrives and speechstate stays in `WaitToStop`.

**Fix we use** (patch-package on `dist/asr.js`, next to `onabort`):

```js
recognition.onerror = function () {
    sendBack({ type: "LISTEN_COMPLETE" });
};
```

Where the ponyfill already sends `end` after an error, the second `LISTEN_COMPLETE` arrives after the actor has stopped and is ignored. We could not trigger the race on demand, so the fix is checked by reading the code, plus a few live turns without a hang.

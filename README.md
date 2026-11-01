# Carbon Cycle

Carbon Cycle is an on-screen keyboard, a five-track loop station, and a pocket studio in one installable web app. v0.1 is the “play, loop, save” slice: you can play a synth or a drum kit, record five loops with RC-505-style transport, keep one project on the device, and export the mix as a WAV.

It is built the same way as the other apps in this family: React, Vite, and TypeScript, with the audio engine kept separate from the interface so it can move to a native shell later.

## Run it

```bash
npm install
npm run dev
```

Open the URL Vite prints. The dev server uses the GitHub Pages base path, so the app is at `/carbon-cycle/` (for example `http://localhost:5173/carbon-cycle/`).

```bash
npm test          # looper state machine and timing math
npm run build     # typecheck and production build
npm run preview   # serve dist/
```

The first screen waits for a tap. That tap resumes the audio context, which is what iOS requires before any sound.

### Install

The production build is a PWA. In Chrome or Edge, use “Install app”. On iPhone, open the site in Safari, share, and choose **Add to Home Screen**. The installed app works offline after the first load.

## What v0.1 does

- **Play, Loop, and Studio**, swipeable, with a transport bar that stays put: start/stop all, tempo (40–300 BPM), tap tempo, metronome, one-bar count-in, and 4/4 or 3/4.
- **Keyboard:** two octaves, octave shift, sustain, several fingers at once. One subtractive synth (two detuned saws, a sub, a filter envelope, a little chorus) and a synthesized drum kit on pads.
- **Web MIDI** input where the browser has it (Chrome, Edge, Firefox on desktop; Chrome on Android). Velocity from a controller is used. The on-screen keys use a fixed velocity.
- **Five loop tracks**, modeled on the RC-505mkII:
  - REC/PLAY cycles **rec → overdub → play**, or **rec → play → overdub** if you switch Record action.
  - Stop, and hold Stop for two seconds to clear. On the keyboard strip: tap to record/play, swipe down to stop, hold to clear.
  - All start / all stop.
  - One level of undo and redo per track.
  - Loop sync. The first loop, quantized to the nearest bar (at least one bar), sets the length. Later tracks lock to that length, or to 2× or 4×.
  - Per-track level (0–200, 100 is unity) and pan.
  - Each track records either the mic or the keyboard/drums.
- **One local project** in IndexedDB, including the recorded audio, plus a WAV export of the mix played four times through.

Studio is a placeholder: save, load, export, and a latency nudge. The timeline, piano roll, and RC-505 effects are later versions.

## How the audio is put together

`src/engine` does not import React.

- `AudioEngine` is the typed API the interface calls.
- The clock, metronome, and looper run in an AudioWorklet (`src/engine/worklet/looper-processor.ts`) so loop edges are sample-accurate. The worklet is bundled as a classic script, because Safari still will not run a module worklet.
- The state machine (`looper-machine.ts`) and the bar/tap math (`timing.ts`) are pure functions with unit tests. The worklet applies that same machine when a quantized moment arrives.
- The synth and drums are ordinary Web Audio graphs. You hear them directly. A copy is an input to the worklet, next to the microphone, and only the armed track is recorded.

Recording is shifted earlier by the context’s output latency, plus a nudge in Studio (−40 to +60 ms). Monitoring does not wait for that shift, so headphones stay responsive. The mute switch on an iPhone is handled with `navigator.audioSession` when Safari provides it (`playback`, then `play-and-record` once the mic is on).

Assumptions, where the RC-505 manual is vague:

- Closing the first loop rounds to the **nearest** bar, with a one-bar minimum.
- Later synced tracks start on the next bar and run for exactly 1×, 2×, or 4× the first loop.
- Undo of the original take clears it (redo brings it back). Undo of an overdub peels off only that layer.
- Loops do not time-stretch. If you change BPM after recording, they keep the speed they were recorded at.

## iPhone and iPad

- No Web MIDI in any iOS browser. The app says so and the on-screen keys still work.
- Audio stops when the app is in the background. Coming back may stay silent until the next tap; that is a WebKit limitation, not something this page can override.
- The first gesture has to unlock audio. The mic needs its own permission. Use headphones if the mic is monitored.
- Storage is best-effort. A home-screen install is more likely to keep the project. v0.1 caps a take at about two minutes so a project stays a reasonable size.

Latency on a phone depends on the device. The compensation above is a best effort from `outputLatency` / `baseLatency`, which do not include the full microphone path. If the downbeat sits late, raise the nudge.

## Publishing

The repo is **private**. GitHub Pages for a private repository needs GitHub Pro, Team, or Enterprise. A public repository can use the free Pages offering.

The workflow `.github/workflows/pages.yml` already deploys `dist/` to GitHub Pages on every push to `main`. To turn it on:

1. Make the repository public, or use a plan that allows Pages on private repos.
2. In the repo on GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main` (or run the workflow by hand).

The site is built with Vite `base: '/carbon-cycle/'`, so it is served at:

`https://jalukum.github.io/carbon-cycle/`

## Roadmap

From the product spec. v0.1 is this release.

| Version | What it adds |
| --- | --- |
| **v0.1** | Play, loop, save. Keyboard, one synth, one drum kit, five tracks, one local project, WAV mix. |
| v0.2 | Scales and chords, velocity by touch, piano and bass, MIDI learn. Reverse, one-shot, fades, single/multi play, dub replace modes, more memories. |
| v0.3 | Studio timeline, capture from the looper, piano roll, simple mixer, sample import, MIDI and stem export. Measure iPhone latency and decide whether to go native. |
| v0.4 | RC-505 input and track FX banks, sends, master comp and reverb. |
| v0.5 | MIDI clock, assignable controls, tempo sync, bounce, performance record. |
| v0.6 | Pitch effects, the rhythm engine, MP3 export. |
| v1.0 | Automation, versions, themes, and a native build if v0.3 says to leave the browser. |

The engine boundary is the hinge for that last step: the worklet and the pure state machine can be reimplemented in JUCE or Swift without rewriting the screens.

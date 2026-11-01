export interface MidiHandlers {
  noteOn(note: number, velocity: number): void;
  noteOff(note: number): void;
  sustain(down: boolean): void;
  panic(): void;
}

export interface MidiStatus {
  available: boolean;
  inputs: string[];
  reason: string | null;
  stop(): void;
}

const IOS_REASON =
  "This browser has no Web MIDI. iPhone and iPad browsers all use WebKit, which cannot see a controller — play the on-screen keys.";

export async function attachMidi(handlers: MidiHandlers): Promise<MidiStatus> {
  const nav = navigator as Navigator & {
    requestMIDIAccess?: () => Promise<MIDIAccess>;
  };
  if (!nav.requestMIDIAccess) {
    return { available: false, inputs: [], reason: IOS_REASON, stop() {} };
  }
  try {
    const access = await nav.requestMIDIAccess();
    const names = () =>
      [...access.inputs.values()].map((input) => input.name || "MIDI input");

    const onMessage = (event: MIDIMessageEvent) => {
      const data = event.data;
      if (!data || data.length < 1) return;
      const status = data[0] ?? 0;
      const command = status & 0xf0;
      const note = data[1] ?? 0;
      const value = data[2] ?? 0;
      if (command === 0x90 && value > 0) {
        handlers.noteOn(note, Math.pow(value / 127, 0.9));
      } else if (command === 0x80 || (command === 0x90 && value === 0)) {
        handlers.noteOff(note);
      } else if (command === 0xb0 && note === 64) {
        handlers.sustain(value >= 64);
      } else if (command === 0xb0 && (note === 120 || note === 123)) {
        handlers.panic();
      }
    };

    const listen = () => {
      for (const input of access.inputs.values()) input.onmidimessage = onMessage;
    };
    listen();
    access.onstatechange = () => listen();

    return {
      available: true,
      inputs: names(),
      reason: names().length === 0 ? "Web MIDI is available — plug in a controller." : null,
      stop() {
        access.onstatechange = null;
        for (const input of access.inputs.values()) input.onmidimessage = null;
      },
    };
  } catch {
    return {
      available: false,
      inputs: [],
      reason: "MIDI permission was blocked. You can still play on screen.",
      stop() {},
    };
  }
}

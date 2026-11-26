// Records microphone audio to WAV (PCM 16-bit, mono, 16kHz). WAV plays on
// every browser including iOS Safari — unlike WebM/Opus, which iOS can't play.
// Uses Web Audio capture so the output format is identical on all platforms.

export class WavRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private buffers: Float32Array[] = [];
  private inRate = 48000;
  private startedAt = 0;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const Ctx: typeof AudioContext =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    this.ctx = new Ctx();
    await this.ctx.resume();
    this.inRate = this.ctx.sampleRate;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.buffers = [];
    this.processor.onaudioprocess = (e) => {
      this.buffers.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    this.source.connect(this.processor);
    this.processor.connect(this.ctx.destination); // keep the node alive (outputs silence)
    this.startedAt = Date.now();
  }

  /** Stop and return a WAV Blob + duration (seconds). */
  stop(): { blob: Blob; dur: number } {
    const dur = Math.round((Date.now() - this.startedAt) / 1000);
    try {
      this.processor?.disconnect();
      this.source?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
    } catch {}
    const flat = flatten(this.buffers);
    const down = downsample(flat, this.inRate, 16000);
    const blob = encodeWav(down, 16000);
    try {
      this.ctx?.close();
    } catch {}
    this.buffers = [];
    return { blob, dur };
  }
}

function flatten(chunks: Float32Array[]): Float32Array {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Float32Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function downsample(buf: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate >= inRate) return buf;
  const ratio = inRate / outRate;
  const outLen = Math.floor(buf.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), buf.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += buf[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

function encodeWav(samples: Float32Array, rate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * audio-streamer.ts
 *
 * This TypeScript class handles:
 *  - Queuing PCM16 audio buffers
 *  - Converting them to Float32 for playback
 *  - Stall detection / auto-restart
 *  - Stopping playback on interruption (barge-in)
 */

export class AudioStreamer {
  /** The AudioContext (web audio engine) for playback. */
  private context: AudioContext;

  /** The sample rate at which the TTS audio is actually encoded (e.g. 24000). */
  private sampleRate: number;

  /** A queue of AudioBuffers awaiting playback. */
  private audioQueue: AudioBuffer[];

  /** Whether we are currently in the middle of playing. */
  private isPlaying: boolean;

  /** The current playing source node (so we can stop on interruption). */
  private currentSource: AudioBufferSourceNode | null;

  /** A master GainNode, if we want to fade out or control volume. */
  private gainNode: GainNode;

  /** Timeout handle for stall detection. */
  private playbackTimeout: ReturnType<typeof setTimeout> | null;

  /** The last time we started playback of a chunk, used for stall detection. */
  private lastPlaybackTime: number;

  /** Whether this instance has been disposed */
  private isDisposed: boolean;

  /**
   * Callback when the audio queue completes (no more buffers).
   * By default, it does nothing unless the hosting code assigns a function.
   */
  public onComplete: () => void;

  /**
   * Callback if we forcibly stop for interruption or other reasons.
   */
  public onInterruption: () => void;

  /**
   * Constructor
   * @param audioContext The AudioContext used for playback
   * @param ttsSampleRate The sample rate for TTS (default 24000 for Gemini Live)
   */
  constructor(audioContext: AudioContext, ttsSampleRate = 24000) {
    this.context = audioContext;
    this.sampleRate = ttsSampleRate;

    this.audioQueue = [];
    this.isPlaying = false;
    this.currentSource = null;
    this.isDisposed = false;

    this.gainNode = this.context.createGain();
    this.gainNode.connect(this.context.destination);

    this.playbackTimeout = null;
    this.lastPlaybackTime = 0;

    this.onComplete = () => {};
    this.onInterruption = () => {};

    // Bind methods if needed
    this.addPCM16 = this.addPCM16.bind(this);
    this.playNextBuffer = this.playNextBuffer.bind(this);
    this.checkPlaybackStatus = this.checkPlaybackStatus.bind(this);
    this.stop = this.stop.bind(this);
    this.dispose = this.dispose.bind(this);
  }

  /**
   * Convert a chunk of PCM16 data to Float32 and queue it for playback.
   * If not already playing, starts playback immediately.
   */
  public addPCM16(chunk: Int16Array) {
    if (!chunk || this.isDisposed) return;

    // Resume AudioContext if it's suspended
    if (this.context.state === "suspended") {
      this.context.resume();
    }

    // Reset gain to ensure audio is heard after interruption
    this.gainNode.gain.setValueAtTime(1, this.context.currentTime);

    // Convert PCM16 -> Float32
    const float32Array = new Float32Array(chunk.length);
    for (let i = 0; i < chunk.length; i++) {
      float32Array[i] = chunk[i] / 32768;
    }

    // Create a WebAudio buffer at the TTS sample rate (e.g. 24000)
    const audioBuffer = this.context.createBuffer(
      1,
      float32Array.length,
      this.sampleRate
    );
    audioBuffer.getChannelData(0).set(float32Array);

    // Enqueue
    this.audioQueue.push(audioBuffer);

    if (!this.isPlaying) {
      this.isPlaying = true;
      this.lastPlaybackTime = this.context.currentTime;
      this.playNextBuffer();
    }

    // Start stall detection cycle
    this.checkPlaybackStatus();
  }

  /**
   * Repeatedly checks if playback might have stalled.
   * If it looks stuck, attempts a manual restart by calling `playNextBuffer()`.
   */
  private checkPlaybackStatus() {
    if (this.playbackTimeout) {
      clearTimeout(this.playbackTimeout);
    }
    if (this.isDisposed) return;

    this.playbackTimeout = setTimeout(() => {
      const now = this.context.currentTime;
      const timeSinceLast = now - this.lastPlaybackTime;
      if (timeSinceLast > 1.0 && this.audioQueue.length > 0 && this.isPlaying) {
        console.warn(
          "[AudioStreamer] Playback stalled >1s, restarting playNextBuffer..."
        );
        this.playNextBuffer();
      }
      if (this.isPlaying && !this.isDisposed) {
        this.checkPlaybackStatus();
      }
    }, 1000);
  }

  /**
   * Dequeue one AudioBuffer and play it. Called automatically until queue is empty.
   */
  private playNextBuffer() {
    if (this.isDisposed || this.audioQueue.length === 0) {
      // No more buffers => done
      this.isPlaying = false;
      this.onComplete();
      return;
    }

    this.lastPlaybackTime = this.context.currentTime;

    const audioBuffer = this.audioQueue.shift()!;
    const source = this.context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.gainNode);

    if (this.currentSource) {
      try {
        this.currentSource.disconnect();
      } catch {
        // ignore
      }
    }
    this.currentSource = source;

    source.onended = () => {
      if (this.isDisposed) return;
      // We finished playing one chunk
      this.lastPlaybackTime = this.context.currentTime;
      if (this.audioQueue.length > 0) {
        // Keep going
        setTimeout(() => this.playNextBuffer(), 0);
      } else {
        // Done playing
        this.isPlaying = false;
        this.onComplete();
      }
    };

    source.start(0);
  }

  /**
   * Stop playback immediately (e.g. barge-in).
   * Clears queue, disconnects source, calls onInterruption.
   */
  public stop() {
    this.isPlaying = false;
    if (this.playbackTimeout) {
      clearTimeout(this.playbackTimeout);
      this.playbackTimeout = null;
    }
    this.audioQueue = [];

    if (this.currentSource) {
      try {
        this.currentSource.stop();
        this.currentSource.disconnect();
      } catch {
        // ignore
      }
    }
    this.currentSource = null;

    // Just set gain to 0 but DON'T disconnect the node
    this.gainNode.gain.setValueAtTime(0, this.context.currentTime);

    this.onInterruption();
  }

  /**
   * If the AudioContext is suspended, resume it.
   * Then set volume back to 1.0 and ensure gainNode is connected.
   */
  public async resume() {
    if (this.isDisposed) return;

    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    // Ensure gainNode is connected to destination
    try {
      this.gainNode.connect(this.context.destination);
    } catch {
      // Ignore if already connected
    }

    this.gainNode.gain.setValueAtTime(1, this.context.currentTime);
  }

  /**
   * Properly dispose of all audio resources.
   * After calling this, the instance cannot be reused.
   */
  public dispose() {
    if (this.isDisposed) return;
    this.isDisposed = true;

    this.stop();

    // Clear callbacks
    this.onComplete = () => {};
    this.onInterruption = () => {};

    // Clear queue
    this.audioQueue = [];

    // Disconnect and null out nodes
    if (this.currentSource) {
      try {
        this.currentSource.stop();
        this.currentSource.disconnect();
      } catch {
        // ignore
      }
      this.currentSource = null;
    }

    if (this.gainNode) {
      try {
        this.gainNode.disconnect();
      } catch {
        // ignore
      }
    }

    // Clear timeouts
    if (this.playbackTimeout) {
      clearTimeout(this.playbackTimeout);
      this.playbackTimeout = null;
    }
  }
}

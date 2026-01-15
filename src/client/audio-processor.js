class AudioRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.isRecording = false;
    this.sampleRate = 16000;
    this.bufferSize = 128; // Small buffer for low latency

    // Listen for messages from main thread
    this.port.onmessage = (event) => {
      if (event.data.type === 'startRecording') {
        this.isRecording = true;
        this.chunks = [];
        console.log('[AudioWorklet] Recording started');
      } else if (event.data.type === 'stopRecording') {
        this.isRecording = false;
        // Send all accumulated chunks
        this.port.postMessage({
          type: 'audioData',
          chunks: this.chunks.slice() // Copy the array
        });
        console.log('[AudioWorklet] Recording stopped, sent', this.chunks.length, 'chunks');
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const inputData = input[0]; // First channel

    if (this.isRecording && inputData) {
      // Convert to 16-bit PCM and store
      const chunk = new Float32Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        chunk[i] = inputData[i];
      }

      this.chunks.push(chunk);

      // Send chunk to main thread for real-time processing
      this.port.postMessage({
        type: 'audioChunk',
        chunk: chunk
      });
    }

    return true;
  }
}

registerProcessor('audio-recorder-processor', AudioRecorderProcessor);
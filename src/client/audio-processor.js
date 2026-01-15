class AudioRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.isRecording = false;

    this.port.onmessage = (event) => {
      if (event.data.type === 'startRecording') {
        this.isRecording = true;
        this.chunks = [];
      } else if (event.data.type === 'stopRecording') {
        this.isRecording = false;
        // Optional: flush remaining chunks if needed
        this.port.postMessage({
          type: 'audioData',
          chunks: this.chunks.slice()
        });
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const inputData = input[0];

    if (this.isRecording) {
      const chunk = new Float32Array(inputData.length);
      chunk.set(inputData);
      this.chunks.push(chunk);

      this.port.postMessage({
        type: 'audioChunk',
        chunk: chunk
      });
    }

    return true;
  }
}

registerProcessor('audio-recorder-processor', AudioRecorderProcessor);
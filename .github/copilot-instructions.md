# AI Coding Agent Instructions for Call Center Simulation System

## Project Overview
This is a real-time AI-powered call center simulation for emergency services (Kazakhstan 102/NG911 system). It features voice calls with AI dispatchers, CAD data analysis, and integration with an external ERDR (Emergency Response Data Repository) system.

## Architecture
- **Node.js Backend** (`src/server.js`): Express + Socket.IO server handling WebRTC calls, AI processing, and data persistence
- **AI Service** (`src/services/aiService.js`): Dual AI system using OpenAI (Whisper STT, GPT analysis/responses, TTS)
- **Recording Service** (`src/services/recordingService.js`): Manages conversation transcripts, audio chunks, and CAD data
- **ERDR Simulator** (`erdr/main.py`): FastAPI app simulating external incident reporting system with SQLite storage
- **Client Interfaces**: Voice call UI (`src/client/index.html`) and admin panel (`src/client/admin.html`)

## Key Patterns & Conventions

### Session Management
- Use UUID v4 for session IDs (stored in `this.sessions` Map)
- Sessions track: caller metadata (IP/location), audio chunks, messages, incident data
- Audio data transmitted as base64 over WebSocket, stored as WAV buffers

### Dual AI Architecture
- **Analyst AI**: Silent CAD data analysis and accumulation (no voice output)
- **Dispatcher AI**: Voice responses to callers using conversation history
- Both run in parallel via `Promise.all()` in `processAudio()`
- Incident data merges across conversation turns

### Data Flow
1. User audio → STT → Dual AI processing → TTS → Response audio
2. CAD data accumulates in `this.incidentData` Map per session
3. Conversations saved as JSON in `conversations/` directory
4. Audio chunks saved in `recordings/` directory
5. Incident reports sent to ERDR via HTTP POST to `/api/external/receive_data`

### File Organization
- `temp/`: Temporary WAV files for OpenAI API (auto-cleaned)
- `recordings/`: Session audio data (user/ai chunks)
- `conversations/`: JSON transcripts with timestamps and CAD data
- `static/audio/`: Uploaded audio files for ERDR integration

### API Integration
- ERDR expects structured incident data with KUI numbers, districts, descriptions
- Audio uploads to ERDR via `/api/external/upload_audio` endpoint
- Search ERDR by KUI number via `/api/internal/search`

### Language & Localization
- Interface in Russian (Kazakhstan emergency services)
- AI responses in Russian dialect appropriate for dispatchers
- Timestamps use Russian locale formatting

## Development Workflow

### Running the System
```bash
# Terminal 1: Node.js server
npm run dev  # Runs on port 8080 with nodemon

# Terminal 2: ERDR simulator
cd erdr && python main.py  # Runs on port 8000
```

### Environment Setup
- Requires `OPENAI_API_KEY` in `.env`
- Node.js: `npm install` (uses CommonJS modules)
- Python: `pip install -r erdr/requirements.txt`

### Testing Calls
- Access `http://localhost:8080` for voice interface
- Access `http://localhost:8080/admin.html` for conversation review
- Admin panel shows CAD data, transcripts, and audio playback

### Debugging
- Server logs session IDs, AI processing status, CAD updates
- Check `conversations/` for JSON transcripts
- Audio chunks saved per session in `recordings/`
- ERDR data in `erdr/erdr_database.db`

## Common Tasks

### Adding New Incident Types
- Update AI prompts in `aiService.js` `analyzeIncident()` and `generateDispatcherResponse()`
- Add CAD fields to `mergeIncidentData()` logic
- Update ERDR schema in `erdr/main.py` if needed

### Modifying Voice Processing
- Audio format: 16-bit WAV, base64 encoded over WebSocket
- STT: OpenAI Whisper with Russian language
- TTS: OpenAI TTS with dispatcher voice settings

### Extending CAD Data
- Incident data accumulates in `this.incidentData` Map
- Fields: priority, category, emotion, location, etc.
- Persisted in conversation JSON and sent to ERDR

### WebSocket Events
- `call-ai`: Start session with caller metadata
- `audio-chunk`: Process user audio (returns AI response)
- `end-ai-call`: Save final data and cleanup

## Code Style Notes
- Node.js: Async/await with error handling
- Python: FastAPI with Pydantic schemas
- Russian comments and variable names in domain-specific code
- UUID-based IDs for all entities
- Base64 audio encoding for WebSocket transport</content>
<parameter name="filePath">c:\Users\Админ\PycharmProjects\call_whatsapp\.github\copilot-instructions.md
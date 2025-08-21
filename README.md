# Free OpusClip Backend

A Node.js/Express backend API for the Free OpusClip application - a free alternative to Opus.pro for creating AI-powered video clips.

## Features

- 🎥 Video upload handling (MP4/MOV up to 500MB)
- 🔗 URL-based video download (YouTube, Vimeo via yt-dlp)
- 🤖 AI transcription using OpenAI Whisper
- 🎯 AI highlight detection using GPT-4
- ✂️ Automated video clipping with FFmpeg
- 📱 Vertical format conversion (9:16 aspect ratio)
- 🔐 Supabase JWT authentication
- 📁 File management and cleanup

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **AI**: OpenAI API (Whisper + GPT-4)
- **Video Processing**: FFmpeg + fluent-ffmpeg
- **Video Download**: yt-dlp-exec
- **Authentication**: Supabase
- **File Upload**: Multer
- **Deployment**: Render.com (free tier)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Copy environment variables:
```bash
cp .env.example .env
```

3. Update environment variables in `.env`:
```
PORT=3001
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-supabase-service-role-key
OPENAI_API_KEY=your-openai-api-key
```

## Development

Run the development server:
```bash
npm run dev
```

The API will be available at [http://localhost:3001](http://localhost:3001).

## API Endpoints

### Authentication
All endpoints except `/health` require a valid Supabase JWT token in the Authorization header:
```
Authorization: Bearer <supabase-jwt-token>
```

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/api/upload` | Upload video file or URL |
| POST | `/api/process` | Start video processing |
| GET | `/api/status/:uploadId` | Get processing status |
| GET | `/api/download/:clipId` | Download processed clip |

#### POST /api/upload
Upload a video file or provide a URL for processing.

**File Upload:**
```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -F "video=@video.mp4" \
  https://api.example.com/api/upload
```

**URL Upload:**
```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://youtube.com/watch?v=..."}' \
  https://api.example.com/api/upload
```

**Response:**
```json
{
  "uploadId": "uuid",
  "message": "Video uploaded successfully"
}
```

#### POST /api/process
Start processing an uploaded video.

```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"uploadId":"uuid"}' \
  https://api.example.com/api/process
```

#### GET /api/status/:uploadId
Get the current processing status.

**Response:**
```json
{
  "id": "uuid",
  "status": "completed",
  "progress": 100,
  "clips": [
    {
      "id": "clip_id",
      "title": "Clip 1: Highlight",
      "duration": 45,
      "download_url": "/api/download/clip_id"
    }
  ]
}
```

## Processing Pipeline

1. **Upload**: Accept video file or download from URL using yt-dlp
2. **Audio Extraction**: Extract audio track using FFmpeg
3. **Transcription**: Transcribe audio using OpenAI Whisper
4. **Analysis**: Analyze transcript with GPT-4 to find highlights
5. **Clipping**: Create video clips using FFmpeg with vertical conversion
6. **Output**: Provide download links for processed clips

## Deployment

### Render.com Deployment

1. Connect your repository to Render.com
2. Choose "Web Service" deployment type
3. Configure build and start commands:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Set environment variables in Render dashboard
5. Deploy on free tier

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port | No (defaults to 3001) |
| `SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_SERVICE_KEY` | Supabase service role key | Yes |
| `OPENAI_API_KEY` | OpenAI API key | Yes |

## Dependencies

### Core Dependencies
- `express` - Web framework
- `cors` - CORS middleware
- `multer` - File upload handling
- `fluent-ffmpeg` - FFmpeg wrapper
- `yt-dlp-exec` - Video download from URLs
- `openai` - OpenAI API client
- `@supabase/supabase-js` - Supabase client

### System Requirements
- Node.js 18+
- FFmpeg (installed on server)
- yt-dlp (installed via npm)

## File Structure

```
├── server.js          # Main application file
├── package.json       # Dependencies and scripts
├── .env.example       # Environment variables template
├── render.yaml        # Render.com deployment config
├── uploads/           # Temporary video uploads
├── output/            # Processed video clips
└── public/            # Static files
```

## Error Handling

The API includes comprehensive error handling for:
- Invalid file types/sizes
- Authentication failures
- Processing errors
- Missing dependencies
- Rate limiting

## Performance Notes

- Files are processed asynchronously
- Temporary files are cleaned up after processing
- Processing status is tracked in memory
- Large files may take several minutes to process

## Limitations (Free Tier)

- Processing is limited by server resources
- No persistent storage (files cleaned periodically)
- Single server instance (no load balancing)
- Limited concurrent processing capacity
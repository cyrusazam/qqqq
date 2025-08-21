require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ytdl = require('yt-dlp-exec');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize services
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Create upload directories
const uploadsDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'output');
fs.ensureDirSync(uploadsDir);
fs.ensureDirSync(outputDir);

// Configure multer for file uploads
const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['video/mp4', 'video/mov', 'video/quicktime'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only MP4 and MOV files are allowed'));
    }
  }
});

// Authentication middleware
const authenticateUser = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
};

// Store for processing jobs
const processingJobs = new Map();

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Upload endpoint
app.post('/api/upload', authenticateUser, upload.single('video'), async (req, res) => {
  try {
    const uploadId = uuidv4();
    let videoPath;

    if (req.file) {
      // File upload
      videoPath = req.file.path;
    } else if (req.body.url) {
      // URL download
      const url = req.body.url;
      const outputPath = path.join(uploadsDir, `${uploadId}.%(ext)s`);
      
      try {
        await ytdl(url, {
          output: outputPath,
          format: 'best[ext=mp4]'
        });
        
        // Find the downloaded file
        const files = fs.readdirSync(uploadsDir).filter(f => f.startsWith(uploadId));
        if (files.length === 0) {
          throw new Error('Download failed');
        }
        videoPath = path.join(uploadsDir, files[0]);
      } catch (error) {
        console.error('Download error:', error);
        return res.status(400).json({ error: 'Failed to download video from URL' });
      }
    } else {
      return res.status(400).json({ error: 'No video file or URL provided' });
    }

    // Store upload info
    processingJobs.set(uploadId, {
      id: uploadId,
      userId: req.user.id,
      status: 'uploaded',
      videoPath,
      createdAt: new Date().toISOString()
    });

    res.json({ uploadId, message: 'Video uploaded successfully' });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Process video endpoint
app.post('/api/process', authenticateUser, async (req, res) => {
  try {
    const { uploadId } = req.body;
    const job = processingJobs.get(uploadId);

    if (!job || job.userId !== req.user.id) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    // Start processing asynchronously
    processVideo(uploadId, job.videoPath);
    
    res.json({ message: 'Processing started', uploadId });
  } catch (error) {
    console.error('Process error:', error);
    res.status(500).json({ error: 'Processing failed to start' });
  }
});

// Get processing status
app.get('/api/status/:uploadId', authenticateUser, (req, res) => {
  const { uploadId } = req.params;
  const job = processingJobs.get(uploadId);

  if (!job || job.userId !== req.user.id) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    id: uploadId,
    status: job.status,
    progress: job.progress || 0,
    clips: job.clips || [],
    error: job.error
  });
});

// Download clip
app.get('/api/download/:clipId', authenticateUser, (req, res) => {
  try {
    const { clipId } = req.params;
    const clipPath = path.join(outputDir, `${clipId}.mp4`);

    if (!fs.existsSync(clipPath)) {
      return res.status(404).json({ error: 'Clip not found' });
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${clipId}.mp4"`);
    
    const stream = fs.createReadStream(clipPath);
    stream.pipe(res);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed' });
  }
});

// Main video processing function
async function processVideo(uploadId, videoPath) {
  const job = processingJobs.get(uploadId);
  
  try {
    // Update status
    job.status = 'transcribing';
    job.progress = 10;

    // Step 1: Extract audio for transcription
    const audioPath = path.join(uploadsDir, `${uploadId}.wav`);
    await extractAudio(videoPath, audioPath);

    job.progress = 30;

    // Step 2: Transcribe with Whisper
    const transcript = await transcribeAudio(audioPath);
    
    job.progress = 50;
    job.status = 'analyzing';

    // Step 3: Find highlight segments
    const highlights = await findHighlights(transcript);

    job.progress = 70;
    job.status = 'clipping';

    // Step 4: Create clips
    const clips = [];
    for (let i = 0; i < highlights.length; i++) {
      const highlight = highlights[i];
      const clipId = `${uploadId}_clip_${i + 1}`;
      const clipPath = path.join(outputDir, `${clipId}.mp4`);

      await createClip(videoPath, clipPath, highlight.start, highlight.duration);
      
      clips.push({
        id: clipId,
        title: `Clip ${i + 1}: ${highlight.title}`,
        duration: highlight.duration,
        download_url: `/api/download/${clipId}`
      });
    }

    job.status = 'completed';
    job.progress = 100;
    job.clips = clips;

    // Clean up temp files
    fs.removeSync(audioPath);

  } catch (error) {
    console.error('Processing error:', error);
    job.status = 'failed';
    job.error = error.message;
  }
}

// Extract audio from video
function extractAudio(videoPath, audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .output(audioPath)
      .audioCodec('pcm_s16le')
      .audioFrequency(16000)
      .audioChannels(1)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

// Transcribe audio using OpenAI Whisper
async function transcribeAudio(audioPath) {
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["word"]
    });

    return transcription;
  } catch (error) {
    console.error('Transcription error:', error);
    throw new Error('Failed to transcribe audio');
  }
}

// Find highlight segments using keyword scoring
async function findHighlights(transcript) {
  try {
    const text = transcript.text;
    
    // Use GPT to analyze the content and find highlights
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are a video clip creator. Analyze the transcript and identify 3-5 engaging segments that would make good 30-90 second clips. 
          Look for:
          - Key insights or tips
          - Emotional moments
          - Surprising facts
          - Action items
          - Dramatic moments
          
          Return a JSON array with segments containing start_time, duration, and title.`
        },
        {
          role: "user",
          content: `Transcript: ${text}\n\nFind the best segments for short clips:`
        }
      ],
      response_format: { type: "json_object" }
    });

    const analysis = JSON.parse(response.choices[0].message.content);
    const segments = analysis.segments || [];

    return segments.slice(0, 5).map(segment => ({
      start: segment.start_time || 0,
      duration: Math.min(segment.duration || 60, 90),
      title: segment.title || 'Highlight'
    }));
  } catch (error) {
    console.error('Highlight analysis error:', error);
    
    // Fallback: Create segments from transcript words
    const words = transcript.words || [];
    const highlights = [];
    
    for (let i = 0; i < Math.min(3, Math.floor(words.length / 100)); i++) {
      const startIdx = i * Math.floor(words.length / 3);
      const endIdx = Math.min(startIdx + 50, words.length - 1);
      
      if (words[startIdx] && words[endIdx]) {
        highlights.push({
          start: words[startIdx].start,
          duration: Math.min(words[endIdx].end - words[startIdx].start, 90),
          title: `Highlight ${i + 1}`
        });
      }
    }
    
    return highlights;
  }
}

// Create video clip
function createClip(inputPath, outputPath, startTime, duration) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .seekInput(startTime)
      .duration(duration)
      .videoFilter([
        'scale=720:1280:force_original_aspect_ratio=increase',
        'crop=720:1280'
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large (max 500MB)' });
    }
  }
  
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, () => {
  console.log(`Free OpusClip Backend running on port ${PORT}`);
  console.log('Environment:', process.env.NODE_ENV || 'development');
});
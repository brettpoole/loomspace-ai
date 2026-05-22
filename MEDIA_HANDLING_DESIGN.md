# Media Handling Design Proposal
**INT-17: Generated Document Outputs and User Uploads**

## Overview
This document outlines the design for implementing media handling in Loomspace AI to support:
1. **Generated document outputs** (PDFs, images, etc.) from AI providers
2. **User uploads** in chat (images, documents, etc.)

## Current State Analysis

### AI Provider Capabilities
- **OpenAI GPT-4V/4o**: Supports image input and can describe images, read documents
- **Anthropic Claude**: Supports image input (PNG, JPEG, GIF, WebP), document analysis  
- **OpenRouter**: Varies by model - many support vision/document inputs

### Current Limitations
- Text-only `ChatMessage` interface (`{ id, role, text }`)
- No file upload UI or infrastructure
- Static site deployment (no backend for file storage)
- Direct frontend-to-AI-provider API calls

## Proposed Solution

### Phase 1: Message Content Enhancement

#### 1.1 Extend Message Types
```typescript
// New content types for messages
export type MessageContentType = 'text' | 'image' | 'document' | 'mixed';

export interface MessageContent {
  type: MessageContentType;
  text?: string;
  media?: MediaAttachment[];
}

export interface MediaAttachment {
  id: string;
  type: 'image' | 'document';
  filename: string;
  mimeType: string;
  size: number;
  url?: string; // For AI-generated content
  data?: string; // base64 for user uploads
  thumbnailUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: MessageContent; // Replace simple 'text' field
  createdAt?: string;
}
```

#### 1.2 Backward Compatibility
- Migrate existing text messages to new format during load
- Maintain simple text interface where appropriate

### Phase 2: User Upload Infrastructure

#### 2.1 File Input UI
```typescript
// New component for file upload
interface FileUploadProps {
  onFilesSelected: (files: MediaAttachment[]) => void;
  acceptedTypes: string[];
  maxSize: number;
}

// Enhanced composer with file support
const SUPPORTED_TYPES = {
  images: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  documents: ['application/pdf', 'text/plain', 'text/markdown']
};
```

#### 2.2 Client-Side Processing
- **File validation**: Size limits, type checking
- **Image processing**: Resize/compress large images for API limits
- **Base64 encoding**: For embedding in API calls (no separate storage needed)
- **Preview generation**: Thumbnails for uploaded files

#### 2.3 Storage Strategy
**Option A (Recommended): Client-side only**
- Store uploads as base64 in browser memory/localStorage
- Pass directly to AI APIs in same request
- Pros: No backend needed, works with current static deployment
- Cons: Size limitations, no persistence across sessions

**Option B: Temporary cloud storage**
- Upload to temporary storage (e.g., Cloudinary, S3)
- Pass URLs to AI APIs
- Auto-expire after 24 hours
- Pros: Better for large files, persistent URLs
- Cons: Requires API keys, additional complexity

### Phase 3: AI Provider Integration

#### 3.1 Vision API Support
```typescript
// Enhanced request functions with media support
async function requestOpenAiWithMedia(
  config: AIProviderConfig, 
  thread: ThreadLane, 
  messages: ChatMessage[]
) {
  const openaiMessages = messages.map(msg => ({
    role: msg.role,
    content: msg.content.type === 'mixed' ? [
      ...(msg.content.text ? [{ type: 'text', text: msg.content.text }] : []),
      ...(msg.content.media?.filter(m => m.type === 'image').map(m => ({
        type: 'image_url',
        image_url: { url: m.data ? `data:${m.mimeType};base64,${m.data}` : m.url }
      })) || [])
    ] : msg.content.text
  }));
  
  // Rest of OpenAI API call
}
```

#### 3.2 Document Processing
- **PDF handling**: Extract text, pass to AI for analysis
- **Image OCR**: Use AI vision capabilities for text extraction
- **Format detection**: Handle different document types appropriately

### Phase 4: Generated Content Handling

#### 4.1 AI Response Processing
```typescript
interface AIResponse {
  text?: string;
  generated_content?: {
    type: 'image' | 'document';
    url?: string;
    data?: string; // base64 if inline
    metadata?: Record<string, any>;
  }[];
}
```

#### 4.2 Provider-Specific Implementation
- **OpenAI DALL-E integration**: For image generation requests
- **Document generation**: Via AI instructions for structured outputs
- **Code execution**: If providers support running code that generates files

### Phase 5: UI/UX Enhancements

#### 5.1 Enhanced Composer
- Drag-and-drop file upload area
- File preview with remove option  
- Progress indicators for large uploads
- Type-specific icons and previews

#### 5.2 Message Display
- Rich message bubbles with media previews
- Expandable image viewer
- Document previews with download options
- Loading states for AI-generated content

#### 5.3 Thread Management
- Media count in thread metadata
- Storage usage indicators
- Bulk media operations

## Implementation Phases

### Phase 1: Foundation (1-2 weeks)
- [ ] Extend `ChatMessage` and related types
- [ ] Update message storage/loading with migration
- [ ] Basic UI components for file display

### Phase 2: User Uploads (2-3 weeks)  
- [ ] File input UI component
- [ ] Client-side file processing (resize, validation)
- [ ] Enhanced composer with upload support
- [ ] Message display for user-uploaded media

### Phase 3: AI Integration (2-3 weeks)
- [ ] Update AI request functions for vision APIs
- [ ] Handle mixed content in all providers
- [ ] Document processing and analysis flows
- [ ] Error handling for media-related failures

### Phase 4: Generated Content (1-2 weeks)
- [ ] AI response parsing for generated media
- [ ] Display generated images/documents
- [ ] Integration with image generation APIs
- [ ] Download/sharing capabilities

### Phase 5: Polish (1 week)
- [ ] Performance optimization
- [ ] Accessibility improvements
- [ ] Mobile responsiveness
- [ ] Testing and bug fixes

## Technical Considerations

### File Size Limits
- **Images**: 4MB max (OpenAI limit), resize client-side if needed
- **Documents**: 10MB max, with text extraction for larger files
- **Base64 overhead**: ~33% size increase, factor into limits

### Security
- File type validation on client and server (if backend added)
- Sanitize file names and metadata
- No executable file uploads
- Rate limiting on upload frequency

### Performance
- Lazy loading of media in threads
- Thumbnail generation for quick previews
- Compression for large images
- Caching strategies for processed content

### Browser Compatibility
- FileReader API for file processing
- Canvas API for image manipulation
- Blob/URL APIs for preview generation
- Graceful degradation for older browsers

## API Impact Assessment

### Provider API Changes Needed
```typescript
// OpenAI - already supports vision via messages array
// Anthropic - supports images in message content  
// OpenRouter - depends on underlying model

// All providers need enhanced message format:
const enhancedMessage = {
  role: 'user',
  content: [
    { type: 'text', text: 'Analyze this image:' },
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,...' }}
  ]
};
```

### Backward Compatibility Strategy
```typescript
// Migration function for existing messages
function migrateTextMessage(oldMessage: { id: string, role: string, text: string }) {
  return {
    id: oldMessage.id,
    role: oldMessage.role,
    content: {
      type: 'text',
      text: oldMessage.text
    }
  };
}
```

## Success Metrics
- [ ] Users can upload images and get AI analysis
- [ ] Users can upload PDFs and get AI summaries  
- [ ] AI can generate and display images when requested
- [ ] No regression in text-only chat performance
- [ ] Mobile upload experience works smoothly
- [ ] File uploads handle network interruptions gracefully

## Risk Mitigation
- **File size limits**: Clear UI feedback, client-side compression
- **API rate limits**: Queue uploads, show progress
- **Storage growth**: Client-side only initially, add cleanup later
- **Browser crashes**: Persist drafts with files to localStorage
- **Network issues**: Resume interrupted uploads, offline indicators

## Future Enhancements
- Multi-file selection and batch processing
- AI-powered file organization and tagging  
- Integration with cloud storage providers
- Real-time collaborative document editing
- Voice message support with transcription
- Video upload and AI analysis capabilities
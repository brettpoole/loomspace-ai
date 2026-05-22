# Media Implementation Plan
**Detailed implementation steps for INT-17**

## Priority Implementation Order

Based on the analysis, I recommend implementing this in phases, with **user uploads** taking priority since that's the more immediately useful feature.

### Phase 1A: Type System Enhancement (CRITICAL)

First, we need to enhance the message type system to support media:

```typescript
// Enhanced types in lib/types.ts
export type MessageContentType = 'text' | 'image' | 'document' | 'mixed';

export interface MediaAttachment {
  id: string;
  type: 'image' | 'document';
  filename: string;
  mimeType: string;
  size: number;
  data: string; // base64 encoded content
  preview?: string; // thumbnail or preview text
}

export interface MessageContent {
  type: MessageContentType;
  text?: string;
  attachments?: MediaAttachment[];
}

// Enhanced ChatMessage interface  
export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: MessageContent; // Replaces simple 'text: string'
  createdAt?: string;
}
```

### Phase 1B: Migration Strategy

Create a migration function to convert existing messages:

```typescript
// In lib/store.ts
function migrateMessage(oldMessage: any): ChatMessage {
  if (oldMessage.content && typeof oldMessage.content === 'object') {
    return oldMessage; // Already migrated
  }
  
  return {
    ...oldMessage,
    content: {
      type: 'text' as MessageContentType,
      text: oldMessage.text || oldMessage.content || ''
    }
  };
}
```

### Phase 2: File Upload Infrastructure

#### 2A: File Processing Utilities
```typescript
// lib/mediaUtils.ts
export async function processFile(file: File): Promise<MediaAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1]; // Remove data URL prefix
      
      resolve({
        id: `media-${crypto.randomUUID().slice(0, 8)}`,
        type: file.type.startsWith('image/') ? 'image' : 'document',
        filename: file.name,
        mimeType: file.type,
        size: file.size,
        data: base64,
        preview: file.type.startsWith('image/') ? result : file.name
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function validateFile(file: File): { valid: boolean; error?: string } {
  const MAX_SIZE = 4 * 1024 * 1024; // 4MB
  const ALLOWED_TYPES = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf', 'text/plain', 'text/markdown'
  ];
  
  if (file.size > MAX_SIZE) {
    return { valid: false, error: 'File too large (max 4MB)' };
  }
  
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { valid: false, error: 'File type not supported' };
  }
  
  return { valid: true };
}
```

#### 2B: File Upload UI Component
```typescript
// components/FileUpload.tsx
interface FileUploadProps {
  onFilesAdded: (attachments: MediaAttachment[]) => void;
  disabled?: boolean;
}

export function FileUpload({ onFilesAdded, disabled }: FileUploadProps) {
  const handleFiles = async (files: FileList) => {
    const attachments: MediaAttachment[] = [];
    
    for (const file of Array.from(files)) {
      const validation = validateFile(file);
      if (!validation.valid) {
        alert(`${file.name}: ${validation.error}`);
        continue;
      }
      
      try {
        const attachment = await processFile(file);
        attachments.push(attachment);
      } catch (error) {
        alert(`Failed to process ${file.name}`);
      }
    }
    
    onFilesAdded(attachments);
  };

  return (
    <div className="file-upload">
      <input
        type="file"
        multiple
        disabled={disabled}
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
        accept="image/*,application/pdf,text/plain,text/markdown"
      />
      {/* Drag-drop overlay */}
    </div>
  );
}
```

### Phase 3: AI Provider Vision Integration

The key insight is that **OpenAI and Anthropic already support vision APIs** - we just need to format the messages correctly:

```typescript
// Enhanced AI request functions
async function requestOpenAiWithVision(config: AIProviderConfig, thread: ThreadLane, messages: ChatMessage[]) {
  const openaiMessages = messages.map(msg => {
    if (msg.content.type === 'text') {
      return { role: msg.role, content: msg.content.text };
    }
    
    // Handle mixed content with attachments
    const content = [];
    if (msg.content.text) {
      content.push({ type: 'text', text: msg.content.text });
    }
    
    msg.content.attachments?.forEach(attachment => {
      if (attachment.type === 'image') {
        content.push({
          type: 'image_url',
          image_url: {
            url: `data:${attachment.mimeType};base64,${attachment.data}`
          }
        });
      }
    });
    
    return { role: msg.role, content };
  });

  // Rest of existing OpenAI request logic...
}

async function requestAnthropicWithVision(config: AIProviderConfig, thread: ThreadLane, messages: ChatMessage[]) {
  const anthropicMessages = messages
    .filter(message => message.role !== 'system')
    .map(msg => {
      if (msg.content.type === 'text') {
        return { role: msg.role, content: msg.content.text };
      }
      
      // Anthropic format for mixed content
      const content = [];
      if (msg.content.text) {
        content.push({ type: 'text', text: msg.content.text });
      }
      
      msg.content.attachments?.forEach(attachment => {
        if (attachment.type === 'image') {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: attachment.mimeType,
              data: attachment.data
            }
          });
        }
      });
      
      return { role: msg.role, content };
    });

  // Rest of existing Anthropic request logic...
}
```

## Implementation Steps

### Step 1: Update Type Definitions (Day 1)
- [ ] Modify `lib/types.ts` with new interfaces
- [ ] Add migration logic to `lib/store.ts` 
- [ ] Test existing functionality still works

### Step 2: File Processing Infrastructure (Day 2)
- [ ] Create `lib/mediaUtils.ts` with file processing
- [ ] Add validation and size limits
- [ ] Create basic file upload component

### Step 3: Enhanced Composer (Day 3)
- [ ] Update composer to handle file attachments
- [ ] Add file preview and removal functionality
- [ ] Update message sending to include attachments

### Step 4: AI Provider Integration (Day 4-5) 
- [ ] Update OpenAI request function for vision
- [ ] Update Anthropic request function for vision
- [ ] Update OpenRouter (depends on selected model)
- [ ] Add error handling for vision API failures

### Step 5: Message Display Enhancement (Day 6)
- [ ] Update message display to show attachments
- [ ] Add image preview functionality
- [ ] Add document download/preview options

### Step 6: Testing & Polish (Day 7)
- [ ] Test with various file types and sizes
- [ ] Test AI responses to images and documents
- [ ] Performance optimization and bug fixes

## Generated Content Strategy

For AI-generated content (Phase 2 requirement), the approach depends on the provider:

1. **OpenAI DALL-E Integration**: Detect image generation requests and call DALL-E API
2. **Document Generation**: AI providers can generate structured text that we format as downloadable files
3. **Code Execution**: Some models can generate data that we convert to downloadable formats

```typescript
// Example: Detect and handle image generation requests
function detectImageGenerationRequest(text: string): boolean {
  const imageKeywords = ['generate image', 'create image', 'draw', 'picture of', 'image of'];
  return imageKeywords.some(keyword => text.toLowerCase().includes(keyword));
}

// Example: Convert AI text to downloadable document
function createDownloadableDocument(content: string, format: 'pdf' | 'txt' | 'md'): MediaAttachment {
  // Implementation depends on chosen document generation library
  const blob = new Blob([content], { type: getMimeType(format) });
  const reader = new FileReader();
  // Convert to base64 and return as MediaAttachment
}
```

## Quick Win Implementation

For immediate value, I recommend starting with **Phase 1-2 (user uploads)** since:

1. It provides immediate user value (upload images for AI analysis)
2. OpenAI GPT-4V and Anthropic Claude already support vision APIs
3. No additional API integrations needed
4. Can be implemented entirely client-side

The generated content feature can be added later as an enhancement once the foundation is solid.
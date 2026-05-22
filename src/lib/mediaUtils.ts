import type { MediaAttachment, MessageContentType, MessageContent, ChatMessage } from './types';

// File processing utilities
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

// Message content utilities
export function createTextMessage(text: string): MessageContent {
  return {
    type: 'text',
    text
  };
}

export function createMixedMessage(text: string, attachments: MediaAttachment[]): MessageContent {
  if (attachments.length === 0) {
    return createTextMessage(text);
  }
  
  return {
    type: attachments.length === 1 && !text ? attachments[0].type : 'mixed',
    text: text || undefined,
    attachments
  };
}

// Backward compatibility - migrate old text messages to new format
export function migrateMessage(oldMessage: any): ChatMessage {
  // If already has content object, it's already migrated
  if (oldMessage.content && typeof oldMessage.content === 'object') {
    return oldMessage;
  }
  
  // Migrate old text-only message
  const text = oldMessage.text || oldMessage.content || '';
  return {
    ...oldMessage,
    content: createTextMessage(text),
    text: text // Keep for backward compatibility
  };
}

// Extract text content for API calls and display
export function getMessageText(message: ChatMessage): string {
  if (message.content?.text) {
    return message.content.text;
  }
  // Fallback to old text field during migration period
  return message.text || '';
}

// Check if message has attachments
export function hasAttachments(message: ChatMessage): boolean {
  return message.content?.attachments && message.content.attachments.length > 0 || false;
}

// Get attachments of specific type
export function getAttachmentsByType(message: ChatMessage, type: 'image' | 'document'): MediaAttachment[] {
  return message.content?.attachments?.filter(att => att.type === type) || [];
}
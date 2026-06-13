"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processFile = processFile;
exports.validateFile = validateFile;
exports.verifyImageBytes = verifyImageBytes;
exports.createTextMessage = createTextMessage;
exports.createMixedMessage = createMixedMessage;
exports.migrateMessage = migrateMessage;
exports.getMessageText = getMessageText;
exports.hasAttachments = hasAttachments;
exports.getAttachmentsByType = getAttachmentsByType;
exports.decodeBase64Text = decodeBase64Text;
// File processing utilities
async function processFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result;
            const base64 = result.split(',')[1]; // Remove data URL prefix
            resolve({
                id: `media-${crypto.randomUUID()}`,
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
function validateFile(file) {
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
// Verify image magic bytes to catch MIME spoofing
async function verifyImageBytes(file) {
    if (file.type === 'image/png') {
        const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
        const pngHeader = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        if (!bytes.every((b, i) => b === pngHeader[i])) {
            return { valid: false, error: `${file.name}: file is not a valid PNG image` };
        }
    }
    else if (file.type === 'image/jpeg') {
        const bytes = new Uint8Array(await file.slice(0, 3).arrayBuffer());
        if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
            return { valid: false, error: `${file.name}: file is not a valid JPEG image` };
        }
    }
    return { valid: true };
}
// Message content utilities
function createTextMessage(text) {
    return {
        type: 'text',
        text
    };
}
function createMixedMessage(text, attachments) {
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
function migrateMessage(oldMessage) {
    // If already has content object, it's already migrated
    if (oldMessage.content && typeof oldMessage.content === 'object') {
        return oldMessage;
    }
    // Migrate old text-only message
    const text = oldMessage.text || oldMessage.content || '';
    return {
        ...oldMessage,
        content: createTextMessage(text),
        text: text // Keep for backward compatibility — clean up after migration period ends
    };
}
// Extract text content for API calls and display
function getMessageText(message) {
    if (message.content?.text) {
        return message.content.text;
    }
    // Fallback to old text field during migration period
    return message.text || '';
}
// Check if message has attachments
function hasAttachments(message) {
    return (message.content?.attachments?.length ?? 0) > 0;
}
// Get attachments of specific type
function getAttachmentsByType(message, type) {
    return message.content?.attachments?.filter(att => att.type === type) || [];
}
// Decode base64-encoded UTF-8 text (e.g. text/plain or text/markdown attachments)
// so their contents can be inlined into a model request.
function decodeBase64Text(base64) {
    try {
        const binary = atob(base64);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    }
    catch {
        return '';
    }
}

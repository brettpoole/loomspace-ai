"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ThreadChat = exports.EMPTY_COMPOSER_STATE = void 0;
exports.EMPTY_COMPOSER_STATE = { draft: '', attachments: [] };
class ThreadChat {
    runtime;
    constructor(runtime) {
        this.runtime = runtime;
    }
    get chatProvider() {
        return this.runtime.provider;
    }
    get thread() {
        return this.runtime.provider.thread;
    }
    get id() {
        return this.runtime.provider.thread?.id ?? null;
    }
    get history() {
        return this.runtime.provider.thread?.context ?? [];
    }
    get nodes() {
        return this.runtime.provider.thread?.nodes ?? [];
    }
    get modelSettings() {
        return this.runtime.provider.thread?.modelSettings;
    }
    get composerKey() {
        return this.runtime.provider.composerKey;
    }
    get composer() {
        return this.runtime.provider.composer;
    }
    get draft() {
        return this.runtime.provider.draft;
    }
    get attachments() {
        return this.runtime.provider.attachments;
    }
    get threadError() {
        return this.runtime.provider.threadError;
    }
    get isBusy() {
        return this.runtime.provider.isBusy;
    }
    get providerConfigId() {
        return this.runtime.provider.providerConfigId;
    }
    get providerConfig() {
        return this.runtime.provider.providerConfig;
    }
    get model() {
        return this.runtime.provider.model;
    }
    get threadParams() {
        return this.runtime.provider.threadParams;
    }
    setDraft(draft) {
        this.runtime.provider.setDraft(draft);
    }
    removeAttachment(attachmentId) {
        this.runtime.provider.removeAttachment(attachmentId);
    }
    appendAttachments(attachments) {
        this.runtime.provider.appendAttachments(attachments);
    }
    clearComposer() {
        this.runtime.provider.clearComposer();
    }
    reportThreadError(message) {
        this.runtime.provider.reportThreadError(message);
    }
    ensureSendableConfig(verb) {
        return this.runtime.provider.ensureSendableConfig(verb);
    }
}
exports.ThreadChat = ThreadChat;

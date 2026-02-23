export default class GeminiKeyManager {
    constructor(envVar) {
        const raw = envVar || process.env.APP_AI_GEMINI_API_KEYS || '';
        this.keys = raw.split(',').map(k => k.trim()).filter(Boolean);
        this.idx = 0;
    }

    getCurrentKey() {
        return this.keys[this.idx];
    }
    
    moveNext() {
        if (this.keys.length === 0) return;
        this.idx = (this.idx + 1) % this.keys.length;
    }

    // Number of available keys. Caller can use this to stop after
    // trying all keys once.
    getKeyCount() {
        return this.keys.length;
    }
}

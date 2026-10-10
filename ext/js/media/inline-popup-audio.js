import {getRequiredAudioSources} from './audio-downloader.js';

/** Recorded sources only, preserving the configured order and default fallbacks. */
export function getInlineAudioSources(options) {
    const sources = options.audio.sources.filter(({type}) => type !== 'text-to-speech' && type !== 'text-to-speech-reading');
    return options.audio.enableDefaultAudioSources ? [...sources, ...getRequiredAudioSources(options.general.language, sources)] : sources;
}

export class InlinePopupAudio {
    constructor(api) {
        this._api = api;
        this._token = 0;
        this._playing = null;
        this._timer = null;
        this._cache = new Map();
        this._languages = null;
        this._ready = new Map();
    }

    clearAutoPlayTimer() {
        if (this._timer !== null) { clearTimeout(this._timer); this._timer = null; }
    }

    stop() {
        ++this._token;
        this.clearAutoPlayTimer();
        if (this._playing !== null) { this._playing.pause(); this._playing = null; }
    }

    attach(entry, node, options, isCurrent) {
        if (entry.type !== 'term') { return; }
        for (const button of node.querySelectorAll('[data-action="play-audio"]')) {
            const headwordNode = button.closest('.headword');
            if (headwordNode === null) { button.hidden = true; continue; }
            const index = Number(headwordNode.dataset.index ?? 0);
            const headword = entry.headwords[index];
            if (!headword) { continue; }
            button.hidden = !options.audio.enabled;
            button.disabled = !options.audio.enabled;
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (isCurrent()) { void this.play(headword, button, options, isCurrent); }
            });
        }
    }

    autoPlay(entry, node, options, isCurrent) {
        if (!options.audio.enabled || !options.audio.autoPlay || entry.type !== 'term') { return; }
        const button = node.querySelector('.headword [data-action="play-audio"]:not([hidden])');
        const headword = entry.headwords[0];
        if (!button || !headword) { return; }
        this.clearAutoPlayTimer();
        this._timer = setTimeout(() => {
            this._timer = null;
            if (isCurrent()) { void this.play(headword, button, options, isCurrent); }
        }, 400);
    }

    async play({term, reading}, button, options, isCurrent) {
        this.stop();
        const token = this._token;
        const current = () => token === this._token && isCurrent();
        const sources = getInlineAudioSources(options);
        const readyKey = JSON.stringify([term, reading, sources]);
        const ready = this._ready.get(readyKey);
        if (ready) {
            // Call play before awaiting the backend, retaining the click gesture
            // when retrying a recording that Safari blocked during autoplay.
            ready.audio.currentTime = 0;
            ready.audio.volume = Number.isFinite(options.audio.volume) ? Math.max(0, Math.min(1, options.audio.volume / 100)) : 1;
            this._playing = ready.audio;
            try {
                await ready.audio.play();
                if (current()) { button.title = `Play audio — ${ready.source.type}`; }
                return;
            } catch (error) {
                if (!current()) { return; }
                ready.audio.pause();
                this._playing = null;
                if (error?.name === 'NotAllowedError') {
                    button.title = 'Safari blocked playback. Click the audio button to play.';
                    return;
                }
                this._ready.delete(readyKey);
            }
        }
        button.title = 'Loading audio…';
        let language;
        try { language = await this._getLanguage(options); } catch (error) {
            if (current()) { button.title = 'Could not prepare audio. Click to retry.'; }
            console.warn('[Yomitan][Safari][Audio]', error);
            return;
        }
        let lastError = null;
        for (const source of sources) {
            if (!current()) { return; }
            try {
                const infos = await this._api.getTermAudioInfoList(source, term, reading, language);
                if (!current()) { return; }
                for (const info of infos) {
                    if (info.type !== 'url') { continue; }
                    let audio;
                    try { audio = await this._getAudio(info.url, source.type); } catch (error) { lastError = error; continue; }
                    if (!current()) { return; }
                    audio.currentTime = 0;
                    audio.volume = Number.isFinite(options.audio.volume) ? Math.max(0, Math.min(1, options.audio.volume / 100)) : 1;
                    this._ready.set(readyKey, {audio, source});
                    if (this._ready.size > 64) { this._ready.delete(this._ready.keys().next().value); }
                    this._playing = audio;
                    try {
                        await audio.play();
                    } catch (error) {
                        if (!current()) { return; }
                        audio.pause();
                        this._playing = null;
                        if (error?.name === 'NotAllowedError') {
                            button.title = 'Safari blocked playback. Click the audio button to play.';
                            return;
                        }
                        this._ready.delete(readyKey);
                        lastError = error;
                        continue;
                    }
                    if (!current()) { return; }
                    button.title = `Play audio — ${source.type}`;
                    return;
                }
            } catch (error) { lastError = error; }
        }
        if (current()) {
            button.title = 'No recorded audio found. Check your Audio settings and connection.';
            if (lastError) { console.warn('[Yomitan][Safari][Audio]', lastError); }
        }
    }

    async _getLanguage(options) {
        if (this._languages === null) {
            this._languages = this._api.getLanguageSummaries().catch((error) => { this._languages = null; throw error; });
        }
        const language = (await this._languages).find(({iso}) => iso === options.general.language);
        if (!language) { throw new Error('Audio language is unavailable'); }
        return language;
    }

    async getMediaOptions(options) {
        return {
            sources: getInlineAudioSources(options), preferredAudioIndex: null,
            idleTimeout: 15000, languageSummary: await this._getLanguage(options),
            enableDefaultAudioSources: false,
        };
    }

    _getAudio(url, type) {
        const key = JSON.stringify([url, type]);
        const cached = this._cache.get(key);
        if (cached) { return cached; }
        const promise = new Promise((resolve, reject) => {
            const audio = new Audio();
            audio.preload = 'auto';
            const finish = (error) => {
                clearTimeout(timer);
                audio.removeEventListener('loadeddata', loaded);
                audio.removeEventListener('error', failed);
                if (error) { audio.removeAttribute('src'); audio.load(); reject(error); } else { resolve(audio); }
            };
            const loaded = () => {
                const invalid = type === 'jpod101' && (audio.duration === 5.694694 || audio.duration === 5.651111);
                finish(invalid ? new Error('Audio source returned its missing-word recording') : null);
            };
            const failed = () => finish(new Error('Could not load recorded audio'));
            const timer = setTimeout(() => finish(new Error('Audio loading timed out')), 15000);
            audio.addEventListener('loadeddata', loaded);
            audio.addEventListener('error', failed);
            audio.src = url;
            audio.load();
        }).catch((error) => { this._cache.delete(key); throw error; });
        this._cache.set(key, promise);
        if (this._cache.size > 64) { this._cache.delete(this._cache.keys().next().value); }
        return promise;
    }
}

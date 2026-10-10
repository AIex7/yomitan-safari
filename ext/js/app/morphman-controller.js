import {distributeFurigana} from '../language/ja/japanese.js';
import {TextSourceRange} from '../dom/text-source-range.js';
import {TextSourceGenerator} from '../dom/text-source-generator.js';

export const WORD_HIGHLIGHT_COLOR = 'rgba(255,200,0,.35)';

/** Highlights kanji-initial dictionary words absent from Anki throughout the page. */
export class MorphmanController {
    constructor(application) {
        this._application = application;
        this._enabled = false;
        this._generation = 0;
        this._timer = null;
        this._running = false;
        this._ranges = [];
        this._resultsOpened = false;
        this._host = document.createElement('div');
        this._host.dataset.yomitanMorphman = 'true';
        this._shadow = this._host.attachShadow({mode: 'closed'});
        this._shadow.innerHTML = `<style>:host{position:fixed;inset:0;pointer-events:none;z-index:2147483000}.mark{position:absolute;background:${WORD_HIGHLIGHT_COLOR};box-sizing:border-box}.status{position:fixed;bottom:12px;right:12px;padding:6px 10px;background:#222;color:white;font:13px -apple-system,sans-serif;border-radius:6px;max-width:360px}</style><div class="marks"></div><div class="status"></div>`;
        this._marks = this._shadow.querySelector('.marks');
        this._status = this._shadow.querySelector('.status');
        this._observer = new MutationObserver((changes) => {
            if (changes.some(({target}) => !this._excluded(target))) { this._schedule(); }
        });
    }

    prepare() {
        chrome.runtime.onMessage.addListener((message, _sender, callback) => {
            if (message.action === 'morphmanGetState') { callback({enabled: this._enabled}); }
            if (message.action === 'morphmanToggle') {
                this._setEnabled(!this._enabled);
                callback({enabled: this._enabled});
            }
        });
        window.addEventListener('scroll', () => {
            if (!this._enabled) { return; }
            this._draw();
        }, {passive: true, capture: true});
        window.addEventListener('resize', () => this._schedule());
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) { this._schedule(); }
        });
        this._application.on('optionsUpdated', () => this._schedule());
        this._application.on('databaseUpdated', () => this._schedule());
    }

    _setEnabled(enabled) {
        this._enabled = enabled;
        ++this._generation;
        if (this._timer !== null) { clearTimeout(this._timer); this._timer = null; }
        this._ranges = [];
        this._resultsOpened = false;
        this._marks.replaceChildren();
        if (!enabled) {
            this._observer.disconnect();
            this._host.remove();
            return;
        }
        document.documentElement.appendChild(this._host);
        this._status.textContent = 'Morphman Mode: collecting page text…';
        this._observer.observe(document.body ?? document.documentElement, {childList: true, subtree: true, characterData: true});
        this._schedule();
    }

    _schedule() {
        if (!this._enabled) { return; }
        ++this._generation;
        if (this._timer !== null) { clearTimeout(this._timer); }
        this._timer = setTimeout(() => {
            this._timer = null;
            void this._scan();
        }, 350);
    }

    _excluded(node) {
        const element = node instanceof Element ? node : node.parentElement;
        return element === null || element.closest('script,style,noscript,textarea,input,select,rt,rp,[contenteditable]:not([contenteditable="false"]),.yomitan-inline-popup,[data-yomitan-morphman]') !== null;
    }

    _collectText() {
        const groups = new Map();
        const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
            if (this._excluded(node) || !node.textContent?.trim()) { continue; }
            const parent = node.parentElement;
            if (parent === null) { continue; }
            const style = getComputedStyle(parent);
            if (style.visibility !== 'visible' || style.display === 'none' || style.opacity === '0') { continue; }
            const range = document.createRange();
            range.selectNodeContents(node);
            if (![...range.getClientRects()].some((r) => r.width > 0 && r.height > 0)) { continue; }
            let block = parent;
            while (block.parentElement !== null && ['inline', 'inline-block', 'ruby', 'ruby-base', 'contents'].includes(getComputedStyle(block).display)) { block = block.parentElement; }
            let group = groups.get(block);
            if (typeof group === 'undefined') { group = {text: '', nodes: []}; groups.set(block, group); }
            group.nodes.push({node, start: group.text.length});
            group.text += node.textContent;
        }
        return [...groups.values()];
    }

    _makeRange(group, start, length) {
        const end = start + length;
        const first = group.nodes.find(({node, start: offset}) => start >= offset && start < offset + node.textContent.length);
        const last = group.nodes.find(({node, start: offset}) => end > offset && end <= offset + node.textContent.length);
        if (typeof first === 'undefined' || typeof last === 'undefined') { return null; }
        const range = document.createRange();
        range.setStart(first.node, start - first.start);
        range.setEnd(last.node, end - last.start);
        return range;
    }

    _getSentence(range, options) {
        const {scanExtent, terminationCharacterMode: mode, terminationCharacters} = options.sentenceParsing;
        const terminators = new Map();
        const forwardQuotes = new Map();
        const backwardQuotes = new Map();
        if (mode === 'custom' || mode === 'custom-no-newlines') {
            for (const {enabled, character1, character2, includeCharacterAtStart, includeCharacterAtEnd} of terminationCharacters) {
                if (!enabled) { continue; }
                if (character2 === null) { terminators.set(character1, [includeCharacterAtStart, includeCharacterAtEnd]); } else {
                    forwardQuotes.set(character1, [character2, includeCharacterAtStart]);
                    backwardQuotes.set(character2, [character1, includeCharacterAtEnd]);
                }
            }
        }
        return new TextSourceGenerator().extractSentence(TextSourceRange.create(range.cloneRange()), options.scanning.layoutAwareScan, scanExtent, mode === 'custom' || mode === 'newlines', terminators, forwardQuotes, backwardQuotes);
    }

    async _scan() {
        if (!this._enabled || document.hidden) { return; }
        if (this._running) { this._schedule(); return; }
        this._running = true;
        const generation = this._generation;
        try {
            const context = {depth: 0, url: location.href};
            const api = this._application.api;
            const options = await api.optionsGet(context);
            const formats = options.anki.cardFormats.filter(({type, model}) => type === 'term' && model);
            const fields = formats.flatMap((format) => {
                const entries = Object.entries(format.fields);
                const field = entries.find(([, {value}]) => value.trim() === '{expression}') ?? entries.find(([, {value}]) => value.trim() === '{furigana-plain}');
                return typeof field === 'undefined' ? [] : [{format, name: field[0], plain: field[1].value.trim() === '{furigana-plain}'}];
            });
            if (fields.length === 0) { throw new Error('Map an Anki word field to {expression} or {furigana-plain}.'); }
            const groups = this._collectText();
            const totalCharacters = groups.reduce((total, {text}) => total + [...text].length, 0);
            let completedCharacters = 0;
            const known = new Set();
            const checked = new Set();
            // Cache the actual Anki field searches, including absent expressions.
            const searchedExpressions = new Map();
            const resultRows = new Map();
            this._ranges = [];
            this._draw();
            const updateProgress = (stage) => {
                this._status.textContent = `Morphman Mode: ${completedCharacters.toLocaleString()} / ${totalCharacters.toLocaleString()} chars complete — ${stage}`;
            };
            updateProgress('parsing');
            for (let i = 0; i < groups.length;) {
                if (generation !== this._generation) { return; }
                const batch = [];
                let batchCharacters = 0;
                do {
                    const group = groups[i++];
                    batch.push(group);
                    batchCharacters += [...group.text].length;
                } while (i < groups.length && batch.length < 20 && batchCharacters < 4000);
                const parsingGroups = batch.filter(({text}) => /\p{Script=Han}/u.test(text));
                updateProgress('parsing');
                const results = parsingGroups.length > 0 ? await api.parseText(parsingGroups.map(({text}) => text), context, options.scanning.length, true, false) : [];
                if (generation !== this._generation) { return; }
                const tokens = [];
                for (const {source, index, content} of results) {
                    if (source !== 'scanning-parser') { continue; }
                    const group = parsingGroups[index];
                    let offset = 0;
                    for (const segments of content) {
                        const text = segments.map((s) => s.text).join('');
                        const headwords = segments[0]?.headwords?.flat() ?? [];
                        if (/^\p{Script=Han}/u.test(text) && headwords.length > 0) {
                            const range = this._makeRange(group, offset, text.length);
                            if (range !== null) { tokens.push({range, headwords, text}); }
                        }
                        offset += text.length;
                    }
                }
                const words = new Map();
                for (const {headwords} of tokens) {
                    for (const {term, reading} of headwords) {
                        const key = JSON.stringify([term, reading]);
                        if (!checked.has(key)) { words.set(key, {term, reading}); }
                    }
                }
                const entries = [...words.entries()];
                const batchSize = Math.max(1, Math.min(40, Math.floor(200 / fields.length)));
                updateProgress('checking Anki');
                for (let j = 0; j < entries.length; j += batchSize) {
                    if (generation !== this._generation) { return; }
                    const wordBatch = entries.slice(j, j + batchSize);
                    const pendingSearches = new Map();
                    const wordSearches = new Map();
                    for (const [key, {term, reading}] of wordBatch) {
                        const searchKeys = [];
                        for (const {format, name, plain} of fields) {
                            const value = plain ? distributeFurigana(term, reading).map(({text, reading: r}, index) => r ? `${index > 0 ? ' ' : ''}${text}[${r}]` : text).join('') : term;
                            // Readings can share an expression; card formats can share
                            // a model and field. Both should reuse the same Anki search.
                            const searchKey = JSON.stringify([format.model, name, value]);
                            searchKeys.push(searchKey);
                            if (!searchedExpressions.has(searchKey) && !pendingSearches.has(searchKey)) {
                                pendingSearches.set(searchKey, {deckName: format.deck, modelName: format.model, fields: {[name]: value}, tags: [], options: {duplicateScope: 'collection'}});
                            }
                        }
                        wordSearches.set(key, searchKeys);
                    }
                    if (pendingSearches.size > 0) {
                        const searches = [...pendingSearches.entries()];
                        const matches = await api.morphmanGetKnownWords(searches.map(([, note]) => note));
                        if (generation !== this._generation) { return; }
                        for (const [index, [searchKey]] of searches.entries()) {
                            searchedExpressions.set(searchKey, matches[index]);
                        }
                    }
                    for (const [key, searchKeys] of wordSearches) {
                        if (searchKeys.some((searchKey) => searchedExpressions.get(searchKey))) { known.add(key); }
                        checked.add(key);
                    }
                }
                if (generation !== this._generation) { return; }
                const missing = tokens.filter(({headwords}) => !headwords.some(({term, reading}) => known.has(JSON.stringify([term, reading]))));
                this._ranges.push(...missing.map(({range}) => range));
                for (const {range, headwords, text} of missing) {
                    const {term, reading} = headwords[0];
                    // Show an expression once, retaining its first source context.
                    const key = term;
                    if (resultRows.has(key)) { continue; }
                    const sentence = this._getSentence(range, options);
                    resultRows.set(key, {text, term, reading, context: {url: location.href, documentTitle: document.title, query: text, fullQuery: sentence.text, sentence}});
                }
                completedCharacters += batchCharacters;
                this._draw();
                updateProgress('scanning page');
                // Let the page paint progress and respond to scrolling between batches.
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
            if (generation !== this._generation) { return; }
            updateProgress(`${this._ranges.length} missing word${this._ranges.length === 1 ? '' : 's'} highlighted`);
            if (!this._resultsOpened) {
                this._resultsOpened = true;
                try {
                    await api.morphmanOpenResults({options, optionsContext: context, rows: [...resultRows.values()]});
                } catch (error) {
                    this._resultsOpened = false;
                    throw error;
                }
            }
        } catch (error) {
            if (generation !== this._generation) { return; }
            this._ranges = [];
            this._draw();
            this._status.textContent = `Morphman Mode: ${error instanceof Error ? error.message : 'Anki check failed'}`;
            console.error('[Yomitan][Morphman]', error);
        } finally {
            this._running = false;
        }
    }

    _draw() {
        const fragment = document.createDocumentFragment();
        for (const range of this._ranges) {
            if (!range.startContainer.isConnected || !range.endContainer.isConnected) { continue; }
            for (const rect of range.getClientRects()) {
                if (rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) { continue; }
                const mark = document.createElement('div');
                mark.className = 'mark';
                Object.assign(mark.style, {left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`});
                fragment.appendChild(mark);
            }
        }
        this._marks.replaceChildren(fragment);
    }
}

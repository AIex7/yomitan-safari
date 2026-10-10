import {Application} from '../application.js';
import {AnkiNoteBuilder} from '../data/anki-note-builder.js';
import {getDynamicTemplates} from '../data/anki-template-util.js';
import {TemplateRendererProxy} from '../templates/template-renderer-proxy.js';
import {Frontend} from '../app/frontend.js';
import {PopupFactory} from '../app/popup-factory.js';
import {HotkeyHandler} from '../input/hotkey-handler.js';

await Application.main(true, async (application) => {
    const status = document.querySelector('#status');
    const tbody = document.querySelector('#rows');
    const formatSelect = document.querySelector('#format');
    const addButton = document.querySelector('#add');
    const table = document.querySelector('table');
    const sortButtons = [...document.querySelectorAll('[data-sort]')];
    const source = document.querySelector('#source');
    const key = `morphman-results-${new URL(location.href).searchParams.get('id')}`;
    let busy = false;
    try {
        const saved = await new Promise((resolve, reject) => {
            chrome.storage.local.get(key, (data) => {
                const error = chrome.runtime.lastError;
                if (error) { reject(new Error(error.message)); } else { resolve(data[key]); }
            });
        });
        if (!saved || !Array.isArray(saved.rows)) { throw new Error('These results are no longer available. Run Morphman Mode again on the original page.'); }
        const {options, optionsContext, contentOrigin} = saved;
        // Also deduplicate snapshots made by older versions of the scanner.
        const uniqueRows = new Map();
        for (const row of saved.rows) {
            const first = uniqueRows.get(row.term);
            if (typeof first === 'undefined') {
                uniqueRows.set(row.term, row);
            } else if (typeof row.noteId === 'number') {
                first.noteId = row.noteId;
            }
        }
        const rows = [...uniqueRows.values()];
        saved.rows = rows;
        source.textContent = rows[0]?.context.documentTitle || optionsContext.url || 'Original page';
        const formats = options.anki.cardFormats.filter(({type, deck, model}) => type === 'term' && deck && model);
        for (const [index, format] of formats.entries()) {
            const option = document.createElement('option');
            option.value = `${index}`;
            option.textContent = `${format.name} — ${format.deck} / ${format.model}`;
            formatSelect.appendChild(option);
        }
        if (formats.length === 0) { throw new Error('Configure an Anki term card format with a deck and model, then scan again.'); }
        const builder = new AnkiNoteBuilder(application.api, new TemplateRendererProxy());
        const entries = [];
        let anchor = null;
        let active = null;
        let sortColumn = null;
        let sortDirection = 1;
        const collator = new Intl.Collator('ja', {numeric: true, sensitivity: 'base'});
        const available = (entry) => typeof entry.row.noteId !== 'number';
        const updateSelection = () => {
            const count = entries.filter((entry) => entry.selected && available(entry)).length;
            addButton.disabled = busy || count === 0;
            addButton.textContent = count > 0 ? `Add selected to Anki (${count})` : 'Add selected to Anki';
            table.setAttribute('aria-busy', `${busy}`);
            for (const entry of entries) {
                entry.tr.classList.toggle('selected', entry.selected);
                entry.tr.setAttribute('aria-selected', `${entry.selected}`);
                entry.tr.setAttribute('aria-disabled', `${busy || !available(entry)}`);
                entry.tr.tabIndex = entry === active || (active === null && entry === entries[0]) ? 0 : -1;
            }
        };
        const selectEntry = (entry, extend, toggle) => {
            if (busy || !available(entry)) { return; }
            if (extend && anchor !== null && entries.includes(anchor)) {
                const start = entries.indexOf(anchor);
                const end = entries.indexOf(entry);
                for (const [index, candidate] of entries.entries()) {
                    const inRange = index >= Math.min(start, end) && index <= Math.max(start, end);
                    candidate.selected = available(candidate) && (inRange || (toggle && candidate.selected));
                }
            } else {
                for (const candidate of entries) {
                    candidate.selected = available(candidate) && (toggle ? (candidate === entry ? !candidate.selected : candidate.selected) : candidate === entry);
                }
                anchor = entry;
            }
            active = entry;
            updateSelection();
        };
        const sortValue = (entry) => {
            switch (sortColumn) {
                case 'word': return entry.row.term;
                case 'reading': return entry.row.reading;
                case 'frequency': return entry.frequencyValue;
                case 'sentence': return entry.row.context.sentence.text;
                default: return entry.result.textContent;
            }
        };
        const sortEntries = () => {
            if (sortColumn === null) { return; }
            entries.sort((a, b) => {
                const left = sortValue(a);
                const right = sortValue(b);
                // Missing frequencies stay last in both directions.
                if (left === null || right === null) {
                    return left === right ? a.index - b.index : left === null ? 1 : -1;
                }
                const difference = sortColumn === 'frequency' ? left - right : collator.compare(left, right);
                return difference * sortDirection || a.index - b.index;
            });
            tbody.append(...entries.map(({tr}) => tr));
            for (const button of sortButtons) {
                button.parentElement.setAttribute('aria-sort', button.dataset.sort === sortColumn ? (sortDirection === 1 ? 'ascending' : 'descending') : 'none');
            }
        };
        for (const button of sortButtons) {
            button.addEventListener('click', () => {
                sortDirection = sortColumn === button.dataset.sort ? -sortDirection : 1;
                sortColumn = button.dataset.sort;
                sortEntries();
            });
        }
        for (const [index, row] of rows.entries()) {
            const tr = document.createElement('tr');
            tr.setAttribute('role', 'row');
            for (const text of [row.term, row.reading]) {
                const cell = document.createElement('td');
                cell.textContent = text;
                tr.appendChild(cell);
            }
            const frequencyCell = document.createElement('td');
            frequencyCell.className = 'frequency';
            frequencyCell.textContent = 'Loading…';
            tr.appendChild(frequencyCell);
            const sentenceCell = document.createElement('td');
            const {text, offset} = row.context.sentence;
            const marked = document.createElement('mark');
            marked.textContent = text.slice(offset, offset + row.text.length);
            sentenceCell.append(document.createTextNode(text.slice(0, offset)), marked, document.createTextNode(text.slice(offset + row.text.length)));
            tr.appendChild(sentenceCell);
            const result = document.createElement('td');
            result.setAttribute('aria-live', 'polite');
            result.textContent = typeof row.noteId === 'number' ? `Added successfully (note ${row.noteId})` : 'Not added';
            if (typeof row.noteId === 'number') { tr.dataset.result = 'success'; }
            tr.appendChild(result);
            tbody.appendChild(tr);
            const entry = {row, tr, result, index, selected: false, frequencyCell, frequencyValue: null};
            entries.push(entry);
            tr.addEventListener('click', (event) => {
                selectEntry(entry, event.shiftKey, event.metaKey || event.ctrlKey);
                if (!busy && available(entry)) { tr.focus({preventScroll: true}); }
            });
            tr.addEventListener('mousedown', (event) => {
                if (event.shiftKey || event.metaKey || event.ctrlKey) { event.preventDefault(); }
            });
        }
        table.addEventListener('keydown', (event) => {
            if (busy || !event.target.closest('tbody')) { return; }
            const toggle = event.metaKey || event.ctrlKey;
            if (toggle && event.key.toLowerCase() === 'a') {
                event.preventDefault();
                for (const entry of entries) { entry.selected = available(entry); }
                updateSelection();
            } else if (event.key === 'Escape') {
                for (const entry of entries) { entry.selected = false; }
                updateSelection();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const candidates = entries.filter(available);
                const current = candidates.indexOf(active);
                const next = candidates[Math.max(0, Math.min(candidates.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))];
                if (next) { selectEntry(next, event.shiftKey, toggle); next.tr.focus(); }
            } else if (event.key === ' ') {
                event.preventDefault();
                const entry = entries.find(({tr}) => tr === event.target);
                if (entry) { selectEntry(entry, event.shiftKey, true); }
            }
        });
        status.textContent = rows.length > 0 ? `${rows.length} missing words. Select rows to add to Anki.` : 'All recognized kanji-initial words already have matching Anki cards.';
        updateSelection();
        // Query once per distinct word/reading, with bounded concurrency. Frequencies
        // are taken only from the matching headword, not related dictionary entries.
        const groups = new Map();
        for (const entry of entries) {
            const wordKey = JSON.stringify([entry.row.text, entry.row.term, entry.row.reading]);
            if (!groups.has(wordKey)) { groups.set(wordKey, []); }
            groups.get(wordKey).push(entry);
        }
        const pending = [...groups.values()];
        const loadFrequencies = async () => {
            while (pending.length > 0) {
                const group = pending.shift();
                const {row} = group[0];
                try {
                    const {dictionaryEntries} = await application.api.termsFind(row.text, {}, optionsContext);
                    const frequencies = dictionaryEntries.flatMap((entry) => entry.frequencies.filter(({headwordIndex}) => {
                        const headword = entry.headwords[headwordIndex];
                        return headword.term === row.term && headword.reading === row.reading;
                    })).sort((a, b) => a.dictionaryIndex - b.dictionaryIndex || a.index - b.index);
                    const unique = [...new Map(frequencies.map((frequency) => [JSON.stringify([frequency.dictionary, frequency.frequency, frequency.displayValue]), frequency])).values()];
                    const labels = unique.map((frequency) => `${frequency.dictionaryAlias || frequency.dictionary}: ${frequency.displayValue ?? frequency.frequency}`);
                    const primary = unique[0];
                    for (const entry of group) {
                        entry.frequencyValue = primary && Number.isFinite(primary.frequency) ? primary.frequency : null;
                        entry.frequencyCell.textContent = labels.join(' · ') || '—';
                        entry.frequencyCell.title = primary ? `Sort value: ${primary.frequency} (${primary.dictionaryAlias || primary.dictionary}). ${labels.join('; ')}` : 'No matching frequency data in enabled dictionaries.';
                    }
                } catch (error) {
                    for (const entry of group) {
                        entry.frequencyCell.textContent = 'Unavailable';
                        entry.frequencyCell.title = error instanceof Error ? error.message : 'Frequency lookup failed';
                    }
                }
            }
        };
        void Promise.all(Array.from({length: Math.min(4, pending.length)}, loadFrequencies)).then(sortEntries);
        let templatePromise = null;
        const getTemplate = () => {
            if (templatePromise === null) {
                templatePromise = (async () => {
                    const dictionaryInfo = await application.api.getDictionaryInfo();
                    const template = typeof options.anki.fieldTemplates === 'string' ? options.anki.fieldTemplates : await application.api.getDefaultAnkiFieldTemplates();
                    return template + getDynamicTemplates(options, dictionaryInfo);
                })().catch((error) => { templatePromise = null; throw error; });
            }
            return templatePromise;
        };
        addButton.addEventListener('click', async () => {
            if (busy) { return; }
            const selected = entries.filter((entry) => entry.selected && available(entry));
            if (selected.length === 0) { return; }
            busy = true;
            formatSelect.disabled = true;
            updateSelection();
            const cardFormat = formats[Number(formatSelect.value)];
            let successes = 0;
            let failures = 0;
            for (const [index, entry] of selected.entries()) {
                const {row, tr, result} = entry;
                result.textContent = 'Adding…';
                status.textContent = `Adding ${index + 1} / ${selected.length}: ${row.term}`;
                try {
                    const {dictionaryEntries} = await application.api.termsFind(row.text, {}, optionsContext);
                    const dictionaryEntry = dictionaryEntries.find(({headwords}) => headwords.some(({term, reading}) => term === row.term && reading === row.reading)) ?? dictionaryEntries[0];
                    if (!dictionaryEntry) { throw new Error('No dictionary entry found for this word.'); }
                    const details = {
                        dictionaryEntry, cardFormat, context: structuredClone(row.context), template: await getTemplate(),
                        tags: options.anki.tags, duplicateScope: options.anki.duplicateScope,
                        duplicateScopeCheckAllModels: options.anki.duplicateScopeCheckAllModels,
                        resultOutputMode: options.general.resultOutputMode, glossaryLayoutMode: options.general.glossaryLayoutMode,
                        compactTags: options.general.compactTags, mediaOptions: null, requirements: [],
                        dictionaryStylesMap: builder.getDictionaryStylesMap(options.dictionaries),
                    };
                    let built = await builder.createNote(details);
                    const requirements = built.requirements.filter(({type}) => type === 'textFurigana');
                    if (requirements.length > 0) {
                        built = await builder.createNote({...details, requirements, mediaOptions: {
                            audio: null,
                            screenshot: {format: options.anki.screenshot.format, quality: options.anki.screenshot.quality, contentOrigin},
                            textParsing: {optionsContext, scanLength: options.scanning.length},
                        }});
                    }
                    if (built.errors.length > 0) { throw built.errors[0]; }
                    if (built.requirements.some(({type}) => type === 'textFurigana')) { throw new Error('Sentence furigana could not be generated.'); }
                    const noteId = await application.api.addAnkiNote(built.note);
                    if (typeof noteId !== 'number' || noteId <= 0) { throw new Error('Anki did not confirm that the note was added.'); }
                    row.noteId = noteId;
                    result.textContent = `Added successfully (note ${noteId})`;
                    tr.dataset.result = 'success';
                    entry.selected = false;
                    updateSelection();
                    ++successes;
                    chrome.storage.local.set({[key]: saved}, () => {
                        const error = chrome.runtime.lastError;
                        if (error) { console.error('[Yomitan][Morphman] Could not save result status', error); }
                    });
                    status.textContent = `Added ${row.term} successfully. ${index + 1} / ${selected.length} processed.`;
                } catch (error) {
                    ++failures;
                    result.textContent = `Failed: ${error instanceof Error ? error.message : 'Unable to add note'}`;
                    tr.dataset.result = 'error';
                }
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
            busy = false;
            formatSelect.disabled = false;
            sortEntries();
            updateSelection();
            status.textContent = `${successes} added successfully${failures > 0 ? `; ${failures} failed — see each row for details and retry` : ''}.`;
        });
        const hotkeyHandler = new HotkeyHandler();
        hotkeyHandler.prepare(application.crossFrame);
        const popupFactory = new PopupFactory(application);
        popupFactory.prepare();
        const frontend = new Frontend({application, popupFactory, depth: 0, parentPopupId: null, parentFrameId: null, useProxyPopup: false, pageType: 'web', canUseWindowPopup: false, allowRootFramePopupProxy: false, childrenSupported: true, hotkeyHandler});
        await frontend.prepare();
    } catch (error) {
        status.textContent = error instanceof Error ? error.message : 'Unable to open results';
    }
});

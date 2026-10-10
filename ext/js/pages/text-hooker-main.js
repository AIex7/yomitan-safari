/*
 * Copyright (C) 2023-2025  Yomitan Authors
 * Copyright (C) 2019-2022  Yomichan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import {Application} from '../application.js';
import {Frontend} from '../app/frontend.js';
import {PopupFactory} from '../app/popup-factory.js';
import {HotkeyHandler} from '../input/hotkey-handler.js';
import {convertKatakanaToHiragana} from '../language/ja/japanese.js';
import {TextHookerHistory} from './text-hooker-history.js';

const storageKey = 'textHookerState';

await Application.main(true, async (application) => {
    const entries = document.querySelector('#entries');
    const status = document.querySelector('#status');
    const limitInput = document.querySelector('#entry-limit');
    const clearButton = document.querySelector('#clear-session');
    if (!(entries instanceof HTMLElement) || !(status instanceof HTMLElement) || !(limitInput instanceof HTMLInputElement) || !(clearButton instanceof HTMLButtonElement)) {
        throw new Error('TextHooker page is incomplete');
    }
    const saved = await new Promise((resolve, reject) => {
        chrome.storage.local.get(storageKey, (result) => {
            const error = chrome.runtime.lastError;
            if (error) { reject(new Error(error.message)); } else { resolve(result[storageKey]); }
        });
    });
    const history = new TextHookerHistory(typeof saved === 'object' && saved !== null ? saved : {});
    limitInput.value = `${history.limit}`;

    const hotkeyHandler = new HotkeyHandler();
    hotkeyHandler.prepare(application.crossFrame);
    const popupFactory = new PopupFactory(application);
    popupFactory.prepare();
    const frontend = new Frontend({
        application,
        popupFactory,
        depth: 0,
        parentPopupId: null,
        parentFrameId: null,
        useProxyPopup: false,
        pageType: 'web',
        canUseWindowPopup: false,
        allowRootFramePopupProxy: false,
        childrenSupported: true,
        hotkeyHandler,
    });
    await frontend.prepare();

    let active = true;
    let renderGeneration = 0;
    const optionsContext = {depth: 0, url: location.href};
    /** @type {Map<string, Promise<import('api').ParseTextLine[]>>} */
    const readings = new Map();
    let parsingQueue = Promise.resolve();
    /** @type {Promise<import('settings').ProfileOptions>|null} */
    let parsingOptions = null;
    /** @param {string} text */
    const getReadings = (text) => {
        const cached = readings.get(text);
        if (typeof cached !== 'undefined') { return cached; }
        const result = parsingQueue.then(async () => {
            if (!active || !history.entries.includes(text)) { return []; }
            if (parsingOptions === null) {
                parsingOptions = application.api.optionsGet(optionsContext);
            }
            const options = await parsingOptions;
            const parsed = await application.api.parseText(text, optionsContext, options.scanning.length, true, false);
            return parsed.find(({source}) => source === 'scanning-parser')?.content ?? [];
        }).catch(() => {
            // Preserve the original clipboard text if dictionaries are unavailable.
            readings.delete(text);
            parsingOptions = null;
            return [];
        });
        readings.set(text, result);
        parsingQueue = result.then(() => {});
        return result;
    };
    /**
     * @param {HTMLElement} entry
     * @param {string} originalText
     * @param {number} generation
     */
    const addFurigana = async (entry, originalText, generation) => {
        const parsed = await getReadings(originalText);
        if (!active || generation !== renderGeneration || !entry.isConnected) { return; }
        const segments = parsed.flat();
        if (segments.map(({text}) => text).join('') !== originalText) { return; }
        const fragment = document.createDocumentFragment();
        for (const {text, reading} of segments) {
            if (reading.length === 0 || !/[\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{323af}]/u.test(text)) {
                fragment.appendChild(document.createTextNode(text));
                continue;
            }
            const ruby = document.createElement('ruby');
            const annotation = document.createElement('rt');
            annotation.textContent = convertKatakanaToHiragana(reading);
            ruby.append(document.createTextNode(text), annotation);
            fragment.appendChild(ruby);
        }
        const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 48;
        entry.replaceChildren(fragment);
        if (atBottom) { window.scrollTo({top: document.documentElement.scrollHeight, behavior: 'auto'}); }
    };
    const render = () => {
        const generation = ++renderGeneration;
        const retained = new Set(history.entries);
        for (const text of readings.keys()) {
            if (!retained.has(text)) { readings.delete(text); }
        }
        const fragment = document.createDocumentFragment();
        for (const text of history.entries) {
            const entry = document.createElement('p');
            entry.className = 'clipboard-entry';
            entry.textContent = text;
            fragment.appendChild(entry);
            void addFurigana(entry, text, generation);
        }
        entries.replaceChildren(fragment);
        window.scrollTo({top: document.documentElement.scrollHeight, behavior: 'auto'});
    };
    const save = () => new Promise((resolve, reject) => {
        chrome.storage.local.set({[storageKey]: history.snapshot()}, () => {
            const error = chrome.runtime.lastError;
            if (error) { reject(new Error(error.message)); } else { resolve(undefined); }
        });
    });
    render();
    application.on('optionsUpdated', () => {
        readings.clear();
        parsingOptions = null;
        render();
    });
    clearButton.addEventListener('click', () => {
        history.clear();
        render();
        status.textContent = 'Waiting for clipboard text…';
        void save().catch(() => { status.textContent = 'Could not save the cleared session.'; });
    });
    limitInput.addEventListener('change', () => {
        if (!history.setLimit(Number(limitInput.value))) {
            limitInput.value = `${history.limit}`;
            return;
        }
        render();
        void save().catch(() => { status.textContent = 'Could not save the entry limit.'; });
    });

    /** @type {ReturnType<typeof setTimeout>|null} */
    let timer = null;
    const poll = async () => {
        timer = null;
        let delay = 500;
        try {
            const clipboard = await application.api.textHookerClipboardGet();
            if (!active) { return; }
            const previousChangeCount = history.lastChangeCount;
            if (history.append(clipboard)) { render(); }
            if (history.lastChangeCount !== previousChangeCount) { await save(); }
            status.textContent = history.entries.length === 0 ? 'Waiting for clipboard text…' : '';
        } catch (error) {
            if (!active) { return; }
            status.textContent = 'Clipboard is unavailable. Retrying automatically…';
            delay = 2000;
        } finally {
            if (active) { timer = setTimeout(() => { void poll(); }, delay); }
        }
    };
    window.addEventListener('pagehide', () => {
        active = false;
        ++renderGeneration;
        readings.clear();
        if (timer !== null) { clearTimeout(timer); timer = null; }
    });
    window.addEventListener('pageshow', (event) => {
        if (!event.persisted || active) { return; }
        active = true;
        render();
        void poll();
    });
    void poll();
});

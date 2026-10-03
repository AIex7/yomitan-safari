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

/**
 * Automatically looks up selected text only on the image viewer page.
 * @param {import('../application.js').Application} application
 * @param {import('../app/frontend.js').Frontend} frontend
 */
export function prepareImageViewerSelection(application, frontend) {
    /** @type {ReturnType<typeof setTimeout>|null} */
    let timer = null;
    let generation = 0;
    let previousSelection = '';
    /** @type {?{x: number, y: number}} */
    let pointer = null;

    const stopPending = () => {
        ++generation;
        if (timer !== null) { clearTimeout(timer); timer = null; }
    };
    const lookup = async () => {
        timer = null;
        const selection = window.getSelection();
        const query = selection !== null ? selection.toString().trim() : '';
        if (selection === null || query.length === 0) { previousSelection = ''; return; }
        const popup = frontend.popup;
        if (popup === null) { return; }
        const container = popup.container;
        const anchor = selection.anchorNode;
        if (container !== null && anchor !== null && (container.contains(anchor) || container.shadowRoot?.contains(anchor))) { return; }

        /** @type {import('popup').Rect[]} */
        const sourceRects = [];
        for (let index = 0; index < selection.rangeCount; ++index) {
            try {
                for (const rect of selection.getRangeAt(index).getClientRects()) {
                    if (rect.width > 0 || rect.height > 0) {
                        sourceRects.push({left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom});
                    }
                }
            } catch (error) {
                // Native Live Text selections may not expose a DOM range.
            }
        }
        if (sourceRects.length === 0 && pointer !== null) {
            sourceRects.push({left: pointer.x, top: pointer.y, right: pointer.x + 1, bottom: pointer.y + 1});
        }
        const token = generation;
        const signature = JSON.stringify({query, sourceRects});
        if (signature === previousSelection && await popup.isVisible()) { return; }
        previousSelection = signature;
        const optionsContext = {depth: 0, url: location.href};
        try {
            const terms = await application.api.termsFind(query, {}, optionsContext);
            /** @type {import('dictionary').DictionaryEntry[]} */
            let dictionaryEntries = terms.dictionaryEntries;
            /** @type {'terms'|'kanji'} */
            let type = 'terms';
            if (dictionaryEntries.length === 0) {
                dictionaryEntries = await application.api.kanjiFind([...query][0], optionsContext);
                type = 'kanji';
            }
            if (token !== generation) { return; }
            await popup.showContent({optionsContext, sourceRects, writingMode: 'horizontal-tb'}, {
                focus: false,
                historyMode: 'clear',
                params: {type, query, wildcards: 'off'},
                state: {
                    focusEntry: 0,
                    optionsContext,
                    url: location.href,
                    pageTheme: 'dark',
                    documentTitle: document.title,
                    sentence: {text: query, offset: 0},
                },
                content: {
                    dictionaryEntries,
                    contentOrigin: {tabId: application.tabId, frameId: application.frameId},
                },
            });
        } catch (error) {
            if (token === generation) { previousSelection = ''; }
        }
    };
    const queueLookup = () => {
        stopPending();
        timer = setTimeout(() => { void lookup(); }, 180);
    };
    /** @param {MouseEvent} event */
    const onPointerRelease = (event) => {
        const container = frontend.popup?.container;
        if (container !== null && typeof container !== 'undefined' && event.composedPath().includes(container)) { return; }
        pointer = {x: event.clientX, y: event.clientY};
        queueLookup();
    };
    document.addEventListener('selectionchange', queueLookup);
    document.addEventListener('mouseup', onPointerRelease, true);
    document.addEventListener('keyup', queueLookup);
    window.addEventListener('scroll', (event) => {
        const container = frontend.popup?.container;
        if (container !== null && typeof container !== 'undefined' && event.target instanceof Node && container.contains(event.target)) { return; }
        stopPending();
    }, true);
    window.addEventListener('pagehide', stopPending);
}

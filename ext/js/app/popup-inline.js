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

import {EventDispatcher} from '../core/event-dispatcher.js';
import {generateId} from '../core/utilities.js';
import {AnkiNoteBuilder} from '../data/anki-note-builder.js';
import {getDynamicTemplates} from '../data/anki-template-util.js';
import {INVALID_NOTE_ID} from '../data/anki-util.js';
import {DisplayContentManager} from '../display/display-content-manager.js';
import {DisplayGenerator} from '../display/display-generator.js';
import {TemplateRendererProxy} from '../templates/template-renderer-proxy.js';
import {InlinePopupAudio} from '../media/inline-popup-audio.js';

export class PopupInline extends EventDispatcher {
    constructor(application, id, depth, frameId, childrenSupported) {
        super();
        this._application = application;
        this._id = id;
        this._depth = depth;
        this._frameId = frameId;
        this._childrenSupported = childrenSupported;
        this._parent = null;
        this._child = null;
        this._optionsContext = null;
        this._container = document.createElement('div');
        this._container.className = 'yomitan-inline-popup';
        this._container.hidden = true;
        this._container.style.position = 'fixed';
        this._container.style.zIndex = '2147483647';
        this._container.style.left = '0';
        this._container.style.top = '0';
        this._container.style.width = '560px';
        this._container.style.maxWidth = '560px';
        this._container.style.maxHeight = '520px';
        this._container.style.overflow = 'visible';
        this._container.style.boxSizing = 'border-box';
        this._container.style.border = '0';
        this._container.style.borderRadius = '0';
        this._container.style.background = 'transparent';
        this._container.style.color = 'CanvasText';
        this._container.style.colorScheme = 'light dark';
        this._container.style.boxShadow = 'none';
        this._container.style.padding = '0';
        this._container.style.font = '14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        this._container.style.wordBreak = 'break-word';
        this._container.style.display = 'none';
        this._container.style.opacity = '0';
        this._container.style.transition = 'opacity 120ms ease';
        this._container.style.whiteSpace = 'normal';
        this._container.style.textAlign = 'left';
        this._container.style.userSelect = 'text';
        this._container.addEventListener('mouseenter', this._onMouseEnter.bind(this), false);
        this._container.addEventListener('mouseleave', this._onMouseLeave.bind(this), false);
        this._container.addEventListener('mousedown', (e) => e.stopPropagation(), false);
        this._container.addEventListener('click', (e) => e.stopPropagation(), false);
        this._visible = false;
        this._isPointerOver = false;
        this._hidePopupTimer = null;
        this._fadeTimer = null;
        this._frameRect = {left: 0, top: 0, right: 0, bottom: 0, valid: false};
        this._initialWidth = 300;
        this._initialHeight = 400;
        this._horizontalOffset = 0;
        this._verticalOffset = 10;
        this._horizontalOffset2 = 10;
        this._verticalOffset2 = 0;
        this._hidePopupOnCursorExit = false;
        this._hidePopupOnCursorExitDelay = 0;
        this._visibleOverrides = new Map();
        this._shadow = this._container.attachShadow({mode: 'open'});
        this._contentRoot = null;
        this._displayGenerator = null;
        this._displayContentManager = null;
        this._dictionaryInfo = null;
        this._setupPromise = null;
        this._options = null;
        this._ankiFieldTemplates = null;
        this._templateRenderer = new TemplateRendererProxy();
        this._ankiNoteBuilder = new AnkiNoteBuilder(this._application.api, this._templateRenderer);
        this._renderToken = null;
        this._audio = new InlinePopupAudio(application.api);
    }

    get id() { return this._id; }
    get parent() { return this._parent; }
    set parent(value) { this._parent = value; }
    get child() { return this._child; }
    set child(value) { this._child = value; }
    get depth() { return this._depth; }
    get frameContentWindow() { return window; }
    get container() { return this._container; }
    get frameId() { return this._frameId; }

    prepare() {
        if (this._container.parentNode === null) {
            document.documentElement.appendChild(this._container);
        }
    }

    async setOptionsContext(optionsContext) {
        const optionsContext2 = this._normalizeOptionsContext(optionsContext);
        this._optionsContext = optionsContext2;
        const options = await this._application.api.optionsGet(optionsContext2);
        this._options = options;
        const {general, scanning} = options;
        this._initialWidth = general.popupWidth;
        this._initialHeight = general.popupHeight;
        this._horizontalOffset = general.popupHorizontalOffset;
        this._verticalOffset = general.popupVerticalOffset;
        this._horizontalOffset2 = general.popupHorizontalOffset2;
        this._verticalOffset2 = general.popupVerticalOffset2;
        this._hidePopupOnCursorExit = scanning.hidePopupOnCursorExit;
        this._hidePopupOnCursorExitDelay = scanning.hidePopupOnCursorExitDelay;
        this._updateContainerSize();
    }

    hide(_changeFocus) {
        this._audio.stop();
        this._renderToken = null;
        this.stopHideDelayed();
        this._visible = false;
        this._container.hidden = true;
        this._container.style.display = 'none';
        this._container.style.opacity = '0';
        this._frameRect = {left: 0, top: 0, right: 0, bottom: 0, valid: false};
        if (this._child !== null) {
            this._child.hide(false);
        }
    }

    hideDelayed(delay) {
        if (this.isPointerOverSelfOrChildren()) { return; }
        if (delay > 0) {
            this.stopHideDelayed();
            this._hidePopupTimer = setTimeout(() => {
                this._hidePopupTimer = null;
                if (!this.isPointerOverSelfOrChildren()) {
                    this._startFadeOut();
                }
            }, delay);
        } else {
            this._startFadeOut();
        }
    }

    stopHideDelayed() {
        if (this._hidePopupTimer !== null) {
            clearTimeout(this._hidePopupTimer);
            this._hidePopupTimer = null;
        }
        if (this._fadeTimer !== null) {
            clearTimeout(this._fadeTimer);
            this._fadeTimer = null;
        }
        if (this._visible) {
            this._container.style.opacity = '1';
        }
    }

    async isVisible() {
        return this.isVisibleSync();
    }

    async setVisibleOverride(value, _priority) {
        const token = generateId(16);
        this._visibleOverrides.set(token, value);
        if (!value) {
            this.hide(false);
        } else if (this._container.textContent !== '') {
            this._visible = true;
            this._container.hidden = false;
            this._container.style.display = 'block';
            this._container.style.opacity = '1';
        }
        return token;
    }

    async clearVisibleOverride(token) {
        return this._visibleOverrides.delete(token);
    }

    async containsPoint(x, y) {
        const {left, top, right, bottom, valid} = this._frameRect;
        return valid && x >= left && x < right && y >= top && y < bottom;
    }

    async showContent(details, displayDetails) {
        const optionsContext = this._normalizeOptionsContext(details.optionsContext);
        this.stopHideDelayed();
        this._visible = false;
        this.prepare();
        this._audio.stop();
        // Keep both first-time rendering and subsequent lookups hidden until
        // the new content and popup geometry are ready to present together.
        this._container.style.transition = 'none';
        this._container.style.opacity = '0';
        this._container.style.pointerEvents = 'none';
        if (this._optionsContext === null) {
            await this.setOptionsContext(optionsContext);
        } else if (JSON.stringify(this._optionsContext) !== JSON.stringify(optionsContext)) {
            await this.setOptionsContext(optionsContext);
        }

        const renderToken = {};
        this._renderToken = renderToken;
        const ankiEntries = await this._render(displayDetails, renderToken);
        if (this._renderToken !== renderToken) { return; }
        this._position(details.sourceRects);
        this._container.hidden = false;
        this._container.style.display = 'block';
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (this._renderToken !== renderToken) { return; }
        this._resetScrollPosition();
        this._visible = true;
        this._container.style.opacity = '1';
        this._container.style.pointerEvents = '';
        requestAnimationFrame(() => {
            if (this._renderToken === renderToken) {
                this._container.style.transition = 'opacity 120ms ease';
            }
        });
        if (displayDetails !== null && typeof ankiEntries !== 'undefined') {
            if (ankiEntries.length > 0 && this._options !== null) {
                const {entry, node} = ankiEntries[0];
                this._audio.autoPlay(entry, node, this._options, () => this._renderToken === renderToken && this._visible);
            }
            void this._prepareAnkiActions(ankiEntries, displayDetails, renderToken);
        }
    }

    async setCustomCss(_css) {}
    async clearAutoPlayTimer() { this._audio.clearAutoPlayTimer(); }
    async setContentScale(scale) {
        this._container.style.fontSize = `${14 * scale}px`;
    }
    isVisibleSync() { return this._visible; }
    async updateTheme() {}
    async setCustomOuterCss(_css, _useWebExtensionApi) {}
    getFrameRect() { return this._frameRect; }
    async getFrameSize() {
        const rect = this._container.getBoundingClientRect();
        return {width: rect.width, height: rect.height, valid: this._visible};
    }
    async setFrameSize(width, height) {
        this._initialWidth = width;
        this._initialHeight = height;
        this._container.style.width = `${width}px`;
        this._container.style.maxWidth = `${width}px`;
        this._container.style.height = `${height}px`;
        this._container.style.maxHeight = `${height}px`;
        return true;
    }
    isPointerOver() { return this._isPointerOver; }

    isPointerOverSelfOrChildren() {
        if (this._isPointerOver) { return true; }
        for (let popup = this._child; popup !== null; popup = popup.child) {
            if (popup.isPointerOver()) { return true; }
        }
        return false;
    }

    _onMouseEnter() {
        this.stopHideDelayed();
        this._isPointerOver = true;
        this.trigger('mouseOver', {});
    }

    _onMouseLeave() {
        this._isPointerOver = false;
        this.trigger('mouseOut', {});
        if (this._hidePopupOnCursorExit) {
            this.hideDelayed(this._hidePopupOnCursorExitDelay);
        }
    }

    _startFadeOut() {
        if (!this._visible) { return; }
        this._container.style.opacity = '0';
        if (this._fadeTimer !== null) {
            clearTimeout(this._fadeTimer);
        }
        this._fadeTimer = setTimeout(() => {
            this._fadeTimer = null;
            if (!this.isPointerOverSelfOrChildren()) {
                this.hide(false);
            }
        }, 180);
    }

    _position(sourceRects) {
        const width = Math.min(this._initialWidth, 600, Math.max(1, window.innerWidth - 24));
        const height = Math.min(this._initialHeight, 520, Math.max(1, window.innerHeight - 32));
        this._container.style.width = `${width}px`;
        this._container.style.maxWidth = `${width}px`;
        this._container.style.height = `${height}px`;
        this._container.style.maxHeight = `${height}px`;
        this._container.style.display = 'block';
        this._container.hidden = false;
        const popupRect = this._container.getBoundingClientRect();
        let left;
        let top;
        if (sourceRects.length > 0) {
            const source = this._getBoundingSourceRect(sourceRects);
            left = (source.left + source.right) / 2 - popupRect.width / 2 + this._horizontalOffset;
            top = source.bottom + this._verticalOffset;
            if (top + popupRect.height > window.innerHeight - 8) {
                top = source.top - popupRect.height - this._verticalOffset;
            }
            ({left, top} = this._clampPosition(left, top));
        } else {
            ({left, top} = this._getDefaultPosition(popupRect.width, popupRect.height));
        }
        this._applyPosition(left, top);

        const finalRect = this._container.getBoundingClientRect();
        this._frameRect = {
            left: finalRect.left,
            top: finalRect.top,
            right: finalRect.right,
            bottom: finalRect.bottom,
            valid: true,
        };
    }

    async _render(displayDetails, renderToken) {
        const contentRoot = await this._ensureRenderer();
        if (this._renderToken !== renderToken) { return; }
        this._resetScrollPosition();
        const fragment = document.createDocumentFragment();
        if (displayDetails === null) {
            if (contentRoot.childElementCount === 0) {
                contentRoot.replaceChildren(this._createMessage('No popup content available.'));
            }
            return;
        }

        const {content} = displayDetails;
        const dictionaryEntries = Array.isArray(content?.dictionaryEntries) ? content.dictionaryEntries : [];
        const displayGenerator = this._displayGenerator;
        const displayContentManager = this._displayContentManager;
        if (displayGenerator === null || displayContentManager === null) {
            throw new Error('Renderer not initialized');
        }

        if (dictionaryEntries.length === 0) {
            fragment.appendChild(this._createMessage('No results found.'));
            if (this._renderToken !== renderToken) { return; }
            contentRoot.replaceChildren(fragment);
            return;
        }

        displayContentManager.unloadAll();
        const dictionaryInfo = await this._getDictionaryInfo();
        if (this._renderToken !== renderToken) { return; }
        const ankiEntries = [];
        const termEntryNodes = [];
        for (const entry of dictionaryEntries) {
            const node = (
                entry.type === 'kanji' ?
                displayGenerator.createKanjiEntry(entry, dictionaryInfo) :
                displayGenerator.createTermEntry(entry, dictionaryInfo)
            );
            for (const icon of node.querySelectorAll('.action-icon[data-icon="play-audio"]')) {
                icon.replaceWith(this._createInlineSvgIcon('audio'));
            }
            if (entry.type !== 'kanji') { termEntryNodes.push(node); }
            // The native dictionary style shows the full definition without a
            // collapsed “more” state; keep each dictionary's complete content.
            for (const element of node.querySelectorAll('.definition-item-inner, .kanji-glyph-data')) {
                element.classList.remove('collapsible', 'collapsed', 'collapse-test');
            }
            if (this._options !== null) {
                this._audio.attach(entry, node, this._options, () => this._renderToken === renderToken && this._visible);
            }
            ankiEntries.push({entry, node});
            fragment.appendChild(node);
        }
        this._combineFirstHeadwordReadings(termEntryNodes);
        if (this._renderToken !== renderToken) { return; }
        contentRoot.replaceChildren(fragment);
        await displayContentManager.executeMediaRequests();
        this._resetScrollPosition();
        return ankiEntries;
    }

    _resetScrollPosition() {
        const scrollContainer = this._shadow.querySelector('.content-scroll');
        if (!(scrollContainer instanceof HTMLElement)) { return; }
        scrollContainer.scrollTop = 0;
        scrollContainer.scrollLeft = 0;
    }

    _combineFirstHeadwordReadings(entryNodes) {
        let firstHeadword = null;
        let firstTerm = '';
        const matchingHeadwords = [];
        const getTerm = (headword) => {
            const term = headword.querySelector('.headword-term');
            if (term === null) { return ''; }
            const clone = term.cloneNode(true);
            for (const rubyText of clone.querySelectorAll('rt')) { rubyText.remove(); }
            return clone.textContent.trim();
        };
        const toHiragana = (reading) => Array.from(reading, (character) => {
            const codePoint = character.codePointAt(0);
            return codePoint >= 0x30a1 && codePoint <= 0x30f6 ? String.fromCodePoint(codePoint - 0x60) : character;
        }).join('');

        for (const entryNode of entryNodes) {
            const headwords = entryNode.querySelectorAll('.headword-list > .headword');
            if (headwords.length === 0) { continue; }
            if (firstHeadword === null) {
                firstHeadword = headwords[0];
                firstTerm = getTerm(firstHeadword);
            }
            for (const headword of headwords) {
                if (getTerm(headword) !== firstTerm) { continue; }
                const reading = toHiragana(headword.querySelector('.headword-reading')?.textContent.trim() ?? '');
                if (reading.length === 0) { continue; }
                matchingHeadwords.push({headword, reading});
            }
        }
        if (firstHeadword === null) { return; }

        const firstReading = matchingHeadwords.find(({headword}) => headword === firstHeadword)?.reading;
        const alternateHeadword = matchingHeadwords.find(({headword, reading}) => headword !== firstHeadword && reading !== firstReading)?.headword;
        if (alternateHeadword === undefined) { return; }

        const firstTermNode = firstHeadword.querySelector('.headword-term');
        const firstRuby = firstTermNode?.querySelectorAll('ruby');
        if (!firstRuby || firstRuby.length === 0) { return; }
        const alternateRuby = alternateHeadword.querySelectorAll('.headword-term ruby');
        const getRubyBase = (ruby) => {
            const clone = ruby.cloneNode(true);
            for (const rubyText of clone.querySelectorAll('rt')) { rubyText.remove(); }
            return clone.textContent.trim();
        };
        const getRubyReading = (ruby) => toHiragana(ruby.querySelector('rt')?.textContent.trim() ?? '');

        for (let i = 0; i < firstRuby.length; ++i) {
            const ruby = firstRuby[i];
            const otherRuby = alternateRuby[i];
            if (otherRuby === undefined || getRubyBase(otherRuby) !== getRubyBase(ruby)) { continue; }
            const alternateReading = getRubyReading(otherRuby);
            if (alternateReading.length === 0 || alternateReading === getRubyReading(ruby)) { continue; }

            const combinedRuby = document.createElement('span');
            combinedRuby.className = 'inline-bipositional-ruby';
            const alternateReadingNode = document.createElement('span');
            alternateReadingNode.className = 'inline-alternate-reading';
            alternateReadingNode.textContent = alternateReading;
            ruby.replaceWith(combinedRuby);
            combinedRuby.append(ruby, alternateReadingNode);
        }

        for (const {headword} of matchingHeadwords) {
            if (headword !== firstHeadword) { headword.hidden = true; }
        }
    }

    async _prepareAnkiActions(entries, displayDetails, renderToken) {
        try {
            const isAnkiConnected = await this._application.api.isAnkiConnected();
            if (this._renderToken !== renderToken || !isAnkiConnected) { return; }
        } catch (error) {
            console.warn('[Yomitan][Safari][InlinePopup][Anki] Availability check failed; hiding Anki buttons', error);
            return;
        }
        for (const {entry, node} of entries) {
            if (this._renderToken !== renderToken) { return; }
            try {
                await this._addAnkiActions(entry, node, displayDetails, renderToken);
            } catch (error) {
                console.error('[Yomitan][Safari][InlinePopup][Anki] Failed to prepare actions', error);
            }
        }
    }

    async _addAnkiActions(dictionaryEntry, node, displayDetails, renderToken) {
        const options = this._options;
        if (options === null || !options.anki.enable) { return; }
        const optionsContext = this._optionsContext;

        const noteActionsContainer = node.querySelector('.note-actions-container');
        if (!(noteActionsContainer instanceof HTMLElement)) { return; }

        const cardFormats = options.anki.cardFormats.filter((cardFormat) => cardFormat.type === dictionaryEntry.type);
        if (cardFormats.length === 0) { return; }

        const template = await this._getAnkiFieldTemplates(options);
        if (this._renderToken !== renderToken) { return; }
        const context = this._createAnkiContext(displayDetails);
        const dictionaryStylesMap = this._ankiNoteBuilder.getDictionaryStylesMap(options.dictionaries);

        for (const [cardFormatIndex, cardFormat] of cardFormats.entries()) {
            if (!cardFormat.deck || !cardFormat.model) { continue; }

            /** @type {import('anki-note-builder').CreateNoteDetails} */
            const noteDetails = {
                dictionaryEntry,
                cardFormat,
                context,
                template,
                tags: options.anki.tags,
                duplicateScope: options.anki.duplicateScope,
                duplicateScopeCheckAllModels: options.anki.duplicateScopeCheckAllModels,
                resultOutputMode: options.general.resultOutputMode,
                glossaryLayoutMode: options.general.glossaryLayoutMode,
                compactTags: options.general.compactTags,
                mediaOptions: null,
                requirements: [],
                dictionaryStylesMap,
            };
            let note;
            let requirements;
            try {
                ({note, requirements} = await this._ankiNoteBuilder.createNote(noteDetails));
            } catch (e) {
                console.error('[Yomitan][Safari][InlinePopup][Anki] Failed to build note', e);
                continue;
            }
            if (this._renderToken !== renderToken) { return; }

            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'action-button-container';
            buttonContainer.dataset.cardFormatIndex = `${cardFormatIndex}`;

            const saveButton = this._createInlineActionButton('anki-add', `Add ${cardFormat.name} note`);
            saveButton.dataset.action = 'save-note';
            saveButton.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                saveButton.disabled = true;
                try {
                    let noteToSave = note;
                    const mediaRequirements = requirements.filter(({type}) => type === 'textFurigana' || type === 'audio');
                    if (mediaRequirements.length > 0) {
                        if (optionsContext === null) { throw new Error('Options context not initialized'); }
                        const result = await this._ankiNoteBuilder.createNote({
                            ...noteDetails,
                            requirements: mediaRequirements,
                            mediaOptions: {
                                audio: mediaRequirements.some(({type}) => type === 'audio') ? await this._audio.getMediaOptions(options) : null,
                                screenshot: {
                                    format: options.anki.screenshot.format,
                                    quality: options.anki.screenshot.quality,
                                    contentOrigin: {tabId: this._application.tabId, frameId: this._frameId},
                                },
                                textParsing: {optionsContext, scanLength: options.scanning.length},
                            },
                        });
                        if (result.errors.length > 0) { throw result.errors[0]; }
                        if (result.requirements.some(({type}) => type === 'textFurigana')) {
                            throw new Error('Sentence furigana could not be generated');
                        }
                        noteToSave = result.note;
                    }
                    const noteId = await this._application.api.addAnkiNote(noteToSave);
                    console.log('[Yomitan][Safari][InlinePopup][Anki] addAnkiNote', {noteId, cardFormat: cardFormat.name});
                    if (typeof noteId === 'number' && noteId > 0) {
                        const viewButton = this._createInlineActionButton('anki-view', `View ${cardFormat.name} note`);
                        viewButton.dataset.action = 'view-note';
                        viewButton.addEventListener('click', async (event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            await this._application.api.viewNotes([noteId], options.anki.noteGuiMode, false);
                        }, false);
                        buttonContainer.replaceChildren(viewButton);
                    } else {
                        saveButton.disabled = false;
                    }
                } catch (error) {
                    console.error('[Yomitan][Safari][InlinePopup][Anki] addAnkiNote failed', error);
                    saveButton.disabled = false;
                }
            }, false);
            buttonContainer.appendChild(saveButton);

            try {
                const expressionFieldName = this._getExpressionFieldName(cardFormat);
                const definitionDetails = this._ankiNoteBuilder.getDictionaryEntryDetailsForNote(dictionaryEntry);
                const term = ('term' in definitionDetails ? definitionDetails.term : null);
                const previewNote = (
                    expressionFieldName !== null && typeof term === 'string' && term.length > 0 ?
                    {...note, fields: {[expressionFieldName]: term}} :
                    note
                );
                const [noteInfo] = await this._application.api.getAnkiNoteInfo([previewNote], false);
                if (this._renderToken !== renderToken) { return; }
                const noteIds = Array.isArray(noteInfo?.noteIds) ? noteInfo.noteIds.filter((id) => id !== INVALID_NOTE_ID) : [];
                if (noteIds.length > 0) {
                    buttonContainer.replaceChildren(this._createInlineViewNoteButton(cardFormat, noteIds, options.anki.noteGuiMode));
                }
            } catch (error) {
                console.error('[Yomitan][Safari][InlinePopup][Anki] getAnkiNoteInfo failed', error);
            }

            if (this._renderToken !== renderToken) { return; }
            noteActionsContainer.appendChild(buttonContainer);
        }
    }

    _createInlineActionButton(icon, title) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'action-button';
        button.title = title;
        const iconNode = this._createInlineSvgIcon(icon === 'anki-view' ? 'note' : 'note-add');
        if (icon !== 'anki-view') { iconNode.classList.add('inline-popup-svg-icon-add'); }
        button.appendChild(iconNode);
        return button;
    }

    _createInlineSvgIcon(type) {
        const namespace = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(namespace, 'svg');
        svg.classList.add('inline-popup-svg-icon');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        const addPath = (path, attributes = {}) => {
            const element = document.createElementNS(namespace, 'path');
            element.setAttribute('d', path);
            for (const [name, value] of Object.entries(attributes)) { element.setAttribute(name, value); }
            svg.appendChild(element);
        };

        if (type === 'audio') {
            addPath('M4 9v6h4l5 4V5L8 9H4Z', {fill: 'currentColor'});
            addPath('M16 9a5 5 0 0 1 0 6M18.5 6.5a8.5 8.5 0 0 1 0 11', {
                fill: 'none',
                stroke: 'currentColor',
                'stroke-width': '1.8',
                'stroke-linecap': 'round',
            });
        } else {
            addPath('M6 3.75h8l4 4v12.5H6a2 2 0 0 1-2-2v-12.5a2 2 0 0 1 2-2Z', {
                fill: 'none',
                stroke: 'currentColor',
                'stroke-width': '1.7',
                'stroke-linejoin': 'round',
            });
            addPath('M14 3.9v4h3.8M8 11h8M8 14.5h8', {
                fill: 'none',
                stroke: 'currentColor',
                'stroke-width': '1.7',
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
            });
            if (type === 'note-add') {
                addPath('M18.5 15.5v6M15.5 18.5h6', {
                    fill: 'none',
                    stroke: 'currentColor',
                    'stroke-width': '1.8',
                    'stroke-linecap': 'round',
                });
            }
        }
        return svg;
    }

    /**
     * @param {import('settings').AnkiCardFormat} cardFormat
     * @returns {?string}
     */
    _getExpressionFieldName(cardFormat) {
        for (const [fieldName, field] of Object.entries(cardFormat.fields)) {
            if (typeof field.value === 'string' && field.value.includes('{expression}')) {
                return fieldName;
            }
        }
        return null;
    }

    _createInlineViewNoteButton(cardFormat, noteIds, noteGuiMode) {
        const viewButton = this._createInlineActionButton('anki-view', `View added ${cardFormat.name} note`);
        viewButton.dataset.action = 'view-note';
        viewButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await this._application.api.viewNotes(noteIds, noteGuiMode, false);
        }, false);
        return viewButton;
    }

    _createAnkiContext(displayDetails) {
        const historyState = (typeof displayDetails?.state === 'object' && displayDetails.state !== null) ? displayDetails.state : {};
        const sentence = (typeof historyState.sentence === 'object' && historyState.sentence !== null) ? historyState.sentence : null;
        const query = typeof displayDetails?.params?.query === 'string' ? displayDetails.params.query : '';
        return {
            url: typeof historyState.url === 'string' ? historyState.url : window.location.href,
            documentTitle: typeof historyState.documentTitle === 'string' ? historyState.documentTitle : document.title,
            query,
            fullQuery: typeof sentence?.text === 'string' ? sentence.text : query,
            sentence: {
                text: typeof sentence?.text === 'string' ? sentence.text : query,
                offset: typeof sentence?.offset === 'number' ? sentence.offset : 0,
            },
        };
    }

    async _getAnkiFieldTemplates(options) {
        if (typeof options.anki.fieldTemplates === 'string') {
            return options.anki.fieldTemplates;
        }
        if (typeof this._ankiFieldTemplates === 'string') {
            return this._ankiFieldTemplates;
        }
        const dictionaryInfo = await this._getDictionaryInfo();
        const staticTemplates = await this._application.api.getDefaultAnkiFieldTemplates();
        this._ankiFieldTemplates = staticTemplates + getDynamicTemplates(options, dictionaryInfo);
        return this._ankiFieldTemplates;
    }

    _createMessage(text) {
        const node = document.createElement('div');
        node.className = 'inline-message';
        node.textContent = text;
        return node;
    }

    async _ensureRenderer() {
        let setupPromise = this._setupPromise;
        if (setupPromise === null) {
            setupPromise = this._setupRenderer();
            this._setupPromise = setupPromise;
        }
        await setupPromise;
        if (this._contentRoot === null) {
            throw new Error('Renderer root not initialized');
        }
        return this._contentRoot;
    }

    async _setupRenderer() {
        const display = {
            application: this._application,
            setContent() {},
        };
        const displayContentManager = new DisplayContentManager(display);
        const displayGenerator = new DisplayGenerator(displayContentManager, null);
        let [materialCss, displayCss, displayPronunciationCss, structuredContentCss] = await Promise.all([
            this._fetchExtensionText('/css/material.css'),
            this._fetchExtensionText('/css/display.css'),
            this._fetchExtensionText('/css/display-pronunciation.css'),
            this._fetchExtensionText('/css/structured-content.css'),
        ]);
        materialCss = this._transformInlineCss(materialCss);
        displayCss = this._transformInlineCss(displayCss);
        displayPronunciationCss = this._transformInlineCss(displayPronunciationCss);
        structuredContentCss = this._transformInlineCss(structuredContentCss);

        const style = document.createElement('style');
        style.textContent = `${materialCss}\n${displayCss}\n${displayPronunciationCss}\n${structuredContentCss}\n${this._getInlineCssOverrides()}`;

        const wrapper = document.createElement('div');
        wrapper.className = 'content-outer';
        wrapper.dataset.browser = 'safari';
        wrapper.dataset.theme = 'default';
        wrapper.dataset.outerTheme = 'default';
        wrapper.innerHTML = '<div class="content"><div class="content-scroll contain-overscroll scrollbar"><div class="content-body"><div class="content-body-inner"></div></div></div></div>';

        this._shadow.replaceChildren(style, wrapper);
        this._contentRoot = wrapper.querySelector('.content-body-inner');
        this._displayGenerator = displayGenerator;
        this._displayContentManager = displayContentManager;
        await this._prepareDisplayGenerator(displayGenerator);
    }

    async _getDictionaryInfo() {
        if (this._dictionaryInfo === null) {
            this._dictionaryInfo = await this._application.api.getDictionaryInfo();
        }
        return this._dictionaryInfo;
    }

    _normalizeOptionsContext(optionsContext) {
        return (
            typeof optionsContext === 'object' &&
            optionsContext !== null ?
            optionsContext :
            {current: true}
        );
    }

    async _fetchExtensionText(path) {
        const response = await fetch(chrome.runtime.getURL(path), {
            method: 'GET',
            cache: 'default',
            credentials: 'omit',
            redirect: 'follow',
            referrerPolicy: 'no-referrer',
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch ${path}: ${response.status}`);
        }
        return await response.text();
    }

    async _prepareDisplayGenerator(displayGenerator) {
        const htmlRaw = await this._fetchExtensionText('/templates-display.html');
        const domParser = new DOMParser();
        const templatesDocument = domParser.parseFromString(htmlRaw, 'text/html');
        displayGenerator._templates.load(templatesDocument);
        displayGenerator.updateHotkeys();
    }

    _updateContainerSize() {
        this._container.style.width = `${this._initialWidth}px`;
        this._container.style.maxWidth = `${this._initialWidth}px`;
        this._container.style.minHeight = '0';
        this._container.style.maxHeight = `${this._initialHeight}px`;
    }

    _getDefaultPosition(width, height) {
        return this._clampPosition(
            window.innerWidth - width - 16,
            Math.round((window.innerHeight - height) / 2),
        );
    }

    _clampPosition(left, top) {
        const rect = this._container.getBoundingClientRect();
        const width = rect.width || this._initialWidth;
        const height = rect.height || this._initialHeight;
        const margin = 8;
        return {
            left: Math.max(margin, Math.min(Math.round(left), window.innerWidth - width - margin)),
            top: Math.max(margin, Math.min(Math.round(top), window.innerHeight - height - margin)),
        };
    }

    _applyPosition(left, top) {
        this._container.style.left = `${left}px`;
        this._container.style.top = `${top}px`;
    }

    _transformInlineCss(css) {
        const extensionRoot = chrome.runtime.getURL('/');
        return css
            .replaceAll("url('/", `url('${extensionRoot}`)
            .replaceAll('url("/', `url("${extensionRoot}`)
            .replaceAll(':root', ':host')
            .replaceAll('html[data-page-type=popup]', ':host')
            .replaceAll('html[data-page-type="popup"]', ':host')
            .replaceAll('body', '.content-outer');
    }

    _getInlineCssOverrides() {
        return `
:host {
    display: block;
    all: initial;
    contain: layout style;
    color-scheme: light dark;
    --font-size-no-units: 15;
    --font-size: 15px;
    --line-height-no-units: 22;
    --headword-font-size-no-units: 2.05;
    --entry-vertical-padding: 0.8em;
    --entry-horizontal-padding: 0.25em;
    --query-horizontal-padding: 0.25em;
    --accent-color: #5c5c60;
    --background-color: Canvas;
    --text-color: CanvasText;
    --reason-text-color: color-mix(in srgb, CanvasText 58%, transparent);
    --text-color-light1: color-mix(in srgb, CanvasText 68%, transparent);
    --text-color-light2: color-mix(in srgb, CanvasText 58%, transparent);
    --text-color-light3: color-mix(in srgb, CanvasText 48%, transparent);
    --text-color-light4: color-mix(in srgb, CanvasText 40%, transparent);
    --light-border-color: color-mix(in srgb, CanvasText 14%, transparent);
    --medium-border-color: color-mix(in srgb, CanvasText 22%, transparent);
    --dark-border-color: color-mix(in srgb, CanvasText 36%, transparent);
    --accent-color: #5c5c60;
    --tag-default-background-color: #77777b;
    --tag-name-background-color: #77777b;
    --tag-expression-background-color: #77777b;
    --tag-popular-background-color: #77777b;
    --tag-frequent-background-color: #77777b;
    --tag-archaism-background-color: #77777b;
    --tag-dictionary-background-color: #77777b;
    --tag-frequency-background-color: #77777b;
    --tag-part-of-speech-background-color: #77777b;
    --tag-search-background-color: #77777b;
    --tag-pronunciation-dictionary-background-color: #77777b;
}
.content-outer {
    display: block;
    position: relative;
    z-index: 1;
    box-sizing: border-box;
    height: 100% !important;
    border: 1px solid color-mix(in srgb, CanvasText 24%, transparent);
    border-radius: 22px;
    background: color-mix(in srgb, Canvas 38%, transparent);
    -webkit-backdrop-filter: blur(36px) saturate(1.9);
    backdrop-filter: blur(36px) saturate(1.9);
    box-shadow: 0 24px 70px rgba(0, 0, 0, .22), inset 0 1px 0 rgba(255, 255, 255, .68), inset 0 -1px 0 rgba(255, 255, 255, .18);
    color: CanvasText;
    width: 100%;
    overflow: hidden !important;
}
.content-outer::before {
    content: '';
    position: absolute;
    z-index: 0;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(145deg, rgba(255, 255, 255, .38), rgba(255, 255, 255, .035) 32%, rgba(255, 255, 255, .10) 68%, rgba(255, 255, 255, .25));
}
.content {
    display: block;
    position: relative !important;
    z-index: 1;
    height: 100% !important;
    overflow: hidden !important;
}
.content-scroll {
    position: static !important;
    left: auto !important;
    top: auto !important;
    right: auto !important;
    bottom: auto !important;
    display: block !important;
    overflow-x: hidden !important;
    overflow-y: scroll !important;
    box-sizing: border-box !important;
    padding: 14px 16px !important;
    max-height: none !important;
    height: 100% !important;
}
.content-body {
    position: static !important;
    height: auto !important;
    padding: 0;
    overflow: visible !important;
}
.content-body-inner {
    display: block !important;
    position: static !important;
    padding: 0;
    overflow: visible !important;
}
.entry {
    margin: 0;
    border: 0;
    box-shadow: none;
    border-radius: 0;
    content-visibility: visible !important;
    contain: none !important;
    contain-intrinsic-height: auto !important;
    visibility: visible !important;
    opacity: 1 !important;
}
.entry * {
    visibility: visible;
}
.entry + .entry {
    border-top: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
}
.entry-header { font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
.headword-list { font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
.headword-term .headword-kanji-link {
    text-decoration: none;
}
.headword-term .inline-bipositional-ruby {
    position: relative;
    display: inline-block;
    margin-bottom: 0.58em;
    line-height: 1;
    vertical-align: baseline;
}
.headword-term .inline-alternate-reading {
    position: absolute;
    left: 50%;
    bottom: -1.16em;
    transform: translateX(-50%);
    color: var(--headword-current-furigana-text-color);
    font-size: 0.5em;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
    pointer-events: none;
}
.headword { font-family: 'Hiragino Mincho ProN', 'Yu Mincho', serif; }
.headword-list-tag-list > .tag[data-category="search"] {
    display: none !important;
}
.inline-popup-svg-icon {
    display: block;
    width: 20px;
    height: 20px;
    color: color-mix(in srgb, CanvasText 78%, transparent);
}
.inline-popup-svg-icon-add {
    color: #34a853;
}
.definition-item-inner.collapsible.collapsed,
.kanji-glyph-data.collapsible.collapsed {
    max-height: none !important;
    overflow: visible !important;
}
.headword-list .headword-details > .action-button[data-action="play-audio"]:not([hidden]) {
    display: inline-block !important;
    position: static !important;
}
.tag[data-category="dictionary"] {
    display: flex;
    width: 100%;
    min-height: 0;
    margin: 0.65em 0 0.45em;
    padding: 0 0 0.3em;
    border-bottom: 1px solid color-mix(in srgb, CanvasText 16%, transparent);
}
.tag[data-category="dictionary"] > .tag-label {
    padding: 0;
    border-radius: 0;
    background: transparent;
    color: color-mix(in srgb, CanvasText 62%, transparent);
}
.tag[data-category="dictionary"] .tag-label-content {
    font-size: 0.9em;
    font-weight: 600;
}
.definition-list {
    list-style: none !important;
    padding-left: 0 !important;
}
.definition-tag-list > .tag:not([data-category="dictionary"]) {
    display: none !important;
}
.definition-tag-list .tag[data-category="dictionary"] .tag-label-content {
    display: none !important;
}
.definition-tag-list .tag[data-category="dictionary"] {
    margin-top: 0.25em;
    margin-bottom: 0.35em;
    padding-bottom: 0.2em;
}
.entry-current-indicator,
.entry-current-indicator-icon,
.action-popup-menu-button,
.action-popup-button,
.action-button-badge,
.headword-current-indicator,
.entry .expansion-button {
    display: none !important;
}
.entry-header,
.entry-body,
.kanji-glyph-data {
    padding-right: 0 !important;
}
.entry-body-section:first-child,
.entry-body-section[data-section-type="pronunciations"] {
    display: none;
}
.headword-list-tag-list,
.tag-list {
    margin-top: 0.3em;
}
.gloss-sc-table-container {
    overflow-x: auto;
}
.inline-message {
    padding: 0.72em;
    color: var(--text-color);
}
@media (prefers-color-scheme: dark) {
    :host {
        --background-color: #242426;
        --text-color: #f5f5f7;
        --reason-text-color: rgba(245, 245, 247, .68);
        --text-color-light1: rgba(245, 245, 247, .76);
        --text-color-light2: rgba(245, 245, 247, .66);
        --text-color-light3: rgba(245, 245, 247, .56);
        --text-color-light4: rgba(245, 245, 247, .46);
        --light-border-color: rgba(255, 255, 255, .14);
        --medium-border-color: rgba(255, 255, 255, .22);
        --dark-border-color: rgba(255, 255, 255, .34);
    }
    .content-outer {
        color: CanvasText;
        background: rgba(34, 34, 37, .78);
        box-shadow: 0 24px 70px rgba(0, 0, 0, .52), inset 0 1px 0 rgba(255, 255, 255, .24), inset 0 -1px 0 rgba(255, 255, 255, .08);
    }
    .content-outer::before { background: linear-gradient(145deg, rgba(255, 255, 255, .14), rgba(255, 255, 255, .008) 32%, rgba(255, 255, 255, .025) 68%, rgba(255, 255, 255, .08)); }
    .entry + .entry { border-top-color: rgba(255, 255, 255, .18); }
    .tag[data-category="dictionary"] { border-bottom-color: rgba(255, 255, 255, .18); }
}
`;
    }

    _getBoundingSourceRect(sourceRects) {
        switch (sourceRects.length) {
            case 0: return {left: 0, top: 0, right: 0, bottom: 0};
            case 1: return sourceRects[0];
        }
        let {left, top, right, bottom} = sourceRects[0];
        for (let i = 1; i < sourceRects.length; ++i) {
            const sourceRect = sourceRects[i];
            left = Math.min(left, sourceRect.left);
            top = Math.min(top, sourceRect.top);
            right = Math.max(right, sourceRect.right);
            bottom = Math.max(bottom, sourceRect.bottom);
        }
        return {left, top, right, bottom};
    }
}

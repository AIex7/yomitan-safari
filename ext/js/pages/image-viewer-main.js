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
import {getImageFiles, imageTitle} from './image-viewer-files.js';
import {prepareImageViewerSelection} from './image-viewer-selection.js';

await Application.main(true, async (application) => {
    const viewer = document.querySelector('#viewer');
    const counter = document.querySelector('#counter');
    const openButton = document.querySelector('#open-button');
    const fitButton = document.querySelector('#fit-button');
    const folderInput = document.querySelector('#folder-input');
    if (!(viewer instanceof HTMLElement) || !(counter instanceof HTMLElement) || !(openButton instanceof HTMLButtonElement) || !(fitButton instanceof HTMLButtonElement) || !(folderInput instanceof HTMLInputElement)) {
        throw new Error('Image viewer page is incomplete');
    }

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
    prepareImageViewerSelection(application, frontend);

    /** @type {HTMLElement[]} */
    let items = [];
    /** @type {string[]} */
    let imageUrls = [];
    let currentIndex = 0;
    let fitScreen = false;
    const updateCounter = () => { counter.textContent = items.length > 0 ? `${currentIndex + 1}/${items.length}` : '0/0'; };
    const releaseImages = () => {
        for (const url of imageUrls) { URL.revokeObjectURL(url); }
        imageUrls = [];
    };
    const nearestIndex = () => {
        let bestIndex = 0;
        let bestDistance = Infinity;
        for (let index = 0; index < items.length; ++index) {
            const distance = Math.abs(items[index].getBoundingClientRect().top);
            if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
        }
        return bestIndex;
    };
    /** @param {number} index */
    const scrollToIndex = (index) => {
        if (items.length === 0) { return; }
        currentIndex = Math.max(0, Math.min(items.length - 1, index));
        items[currentIndex].scrollIntoView({behavior: 'smooth', block: 'start'});
        updateCounter();
    };
    /** @param {string} message */
    const showEmpty = (message) => {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = message;
        viewer.replaceChildren(empty);
        items = [];
        currentIndex = 0;
        updateCounter();
    };
    /** @param {File[]} files */
    const render = (files) => {
        frontend.popup?.hide(false);
        releaseImages();
        if (files.length === 0) { showEmpty('No supported images found in this folder.'); return; }
        const fragment = document.createDocumentFragment();
        items = files.map((file, index) => {
            const section = document.createElement('section');
            section.className = 'item';
            section.id = `item-${index}`;
            const wrap = document.createElement('div');
            wrap.className = 'image-wrap';
            const image = document.createElement('img');
            const url = URL.createObjectURL(file);
            imageUrls.push(url);
            image.src = url;
            image.alt = imageTitle(file.name);
            image.title = imageTitle(file.name);
            image.addEventListener('error', () => {
                const message = document.createElement('p');
                message.className = 'image-error';
                message.textContent = `Safari could not display ${file.name}.`;
                image.replaceWith(message);
            }, {once: true});
            wrap.appendChild(image);
            section.appendChild(wrap);
            fragment.appendChild(section);
            return section;
        });
        viewer.replaceChildren(fragment);
        currentIndex = 0;
        updateCounter();
        scrollToIndex(0);
    };
    const toggleFitScreen = () => {
        const index = nearestIndex();
        fitScreen = !fitScreen;
        document.body.classList.toggle('fit-screen', fitScreen);
        fitButton.textContent = fitScreen ? 'Natural Size' : 'Fit Screen';
        scrollToIndex(index);
    };
    openButton.addEventListener('click', () => {
        folderInput.value = '';
        folderInput.click();
    });
    folderInput.addEventListener('change', () => {
        if (folderInput.files === null || folderInput.files.length === 0) { return; }
        render(getImageFiles(folderInput.files));
    });
    fitButton.addEventListener('click', toggleFitScreen);
    document.addEventListener('keydown', (event) => {
        if (event.defaultPrevented) { return; }
        const target = event.target;
        if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input,textarea,select,.yomitan-inline-popup') !== null)) { return; }
        switch (event.key) {
            case 'ArrowRight':
            case 'ArrowDown': event.preventDefault(); scrollToIndex(nearestIndex() + 1); break;
            case 'ArrowLeft':
            case 'ArrowUp': event.preventDefault(); scrollToIndex(nearestIndex() - 1); break;
            case 'f':
            case 'F': event.preventDefault(); toggleFitScreen(); break;
        }
    });
    window.addEventListener('scroll', () => { currentIndex = nearestIndex(); updateCounter(); }, {passive: true});
    window.addEventListener('pagehide', (event) => { if (!event.persisted) { releaseImages(); } });
    showEmpty('Click Open Folder');
});

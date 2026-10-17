import {Application} from '../application.js';
import {Frontend} from '../app/frontend.js';
import {PopupFactory} from '../app/popup-factory.js';
import {HotkeyHandler} from '../input/hotkey-handler.js';
import {EpubBook} from './epub-book.js';
import {prepareImageViewerSelection} from './image-viewer-selection.js';

await Application.main(true, async (application) => {
    const root = document.documentElement;
    const area = document.querySelector('#reading-area');
    const chapter = document.querySelector('#chapter');
    const empty = document.querySelector('#empty-state');
    const fileInput = document.querySelector('#book-file');
    const openButton = document.querySelector('#open-book');
    const previous = document.querySelector('#previous');
    const next = document.querySelector('#next');
    const contents = document.querySelector('#contents');
    const contentsButton = document.querySelector('#toggle-contents');
    const links = document.querySelector('#chapter-links');
    const chapterSelect = document.querySelector('#chapter-select');
    const title = document.querySelector('#book-title');
    const author = document.querySelector('#book-author');
    const position = document.querySelector('#position');
    const status = document.querySelector('#status');
    const appearance = document.querySelector('#appearance');
    const fontSize = document.querySelector('#font-size');
    const fontSizeLabel = document.querySelector('#font-size-label');
    const theme = document.querySelector('#theme');
    const typeface = document.querySelector('#typeface');
    const writingMode = document.querySelector('#writing-mode');
    const dropHint = document.querySelector('#drop-hint');
    const hotkeys = new HotkeyHandler();
    hotkeys.prepare(application.crossFrame);
    const popupFactory = new PopupFactory(application);
    popupFactory.prepare();
    const frontend = new Frontend({application, popupFactory, depth: 0, parentPopupId: null, parentFrameId: null, useProxyPopup: false, pageType: 'web', canUseWindowPopup: false, allowRootFramePopupProxy: false, childrenSupported: true, hotkeyHandler: hotkeys});
    await frontend.prepare();
    let selectedImage = null;
    document.addEventListener('mousedown', (event) => {
        selectedImage = event.composedPath().find((node) => node instanceof HTMLImageElement && chapter.contains(node)) || null;
    }, true);
    prepareImageViewerSelection(application, frontend, {shouldLookup: (selection) => {
        const anchor = selection.anchorNode;
        const element = anchor instanceof Element ? anchor : anchor?.parentElement;
        return (selectedImage !== null && chapter.contains(selectedImage)) || (element instanceof HTMLImageElement && chapter.contains(element));
    }});

    let book = null;
    let characterCounts = null;
    let characterCountError = false;
    let chapterIndex = 0;
    let opening = false;
    let loadingChapter = false;
    let openGeneration = 0;
    let chapterGeneration = 0;
    const preferenceKey = 'epubReaderPreferences';
    const vertical = () => writingMode.value === 'vertical' && chapter.dataset.imageOnly !== 'true';
    const reverse = () => writingMode.value === 'vertical' || book?.direction === 'rtl';
    const resizeReadingArea = () => {
        area.style.setProperty('--reading-height', `${area.clientHeight}px`);
    };
    const readingAreaObserver = new ResizeObserver(() => { resizeReadingArea(); updatePosition(); });
    readingAreaObserver.observe(area);
    resizeReadingArea();
    const metrics = () => {
        const maximum = vertical() ? area.scrollWidth - area.clientWidth : area.scrollHeight - area.clientHeight;
        const offset = vertical() ? Math.abs(area.scrollLeft) : area.scrollTop;
        return {maximum: Math.max(0, maximum), offset: Math.max(0, offset)};
    };
    const fraction = () => {
        const {offset, maximum} = metrics();
        return maximum > 0 ? Math.min(1, offset / maximum) : 0;
    };
    const restoreFraction = (value) => {
        const {maximum} = metrics();
        area.scrollTo({left: vertical() ? -maximum * value : 0, top: vertical() ? 0 : maximum * value, behavior: 'instant'});
    };
    const updatePosition = () => {
        if (!book) { return; }
        const {maximum, offset} = metrics();
        const atStart = offset <= 2;
        const atEnd = offset >= maximum - 2;
        const pageSize = Math.max(1, vertical() ? area.clientWidth : area.clientHeight);
        const pages = Math.max(1, Math.ceil((maximum + pageSize) / pageSize));
        const currentPage = maximum > 0 ? Math.min(pages, Math.ceil(offset / pageSize) + 1) : 1;
        if (characterCountError) {
            position.textContent = 'Progress unavailable';
            position.title = 'Could not calculate character progress for this book.';
        } else if (characterCounts === null) {
            position.textContent = 'Counting book text…';
            position.title = 'Calculating character progress for the whole book';
        } else {
            const total = characterCounts.reduce((sum, value) => sum + value, 0);
            const before = characterCounts.slice(0, chapterIndex).reduce((sum, value) => sum + value, 0);
            const current = Math.round(characterCounts[chapterIndex] * fraction());
            const completed = Math.min(total, before + current);
            position.textContent = `${total > 0 ? Math.floor(completed / total * 100) : 0}% · ${completed.toLocaleString()} / ${total.toLocaleString()} chars`;
            position.title = `Whole-book character progress. About page ${currentPage} of ${pages} in this section.`;
        }
        previous.disabled = opening || loadingChapter || (chapterIndex === 0 && atStart);
        next.disabled = opening || loadingChapter || (chapterIndex === book.spine.length - 1 && atEnd);
        chapterSelect.disabled = opening || loadingChapter;
        contentsButton.disabled = opening;
    };
    const updateAppearance = () => {
        root.dataset.theme = theme.value;
        root.dataset.writingMode = writingMode.value;
        root.dataset.pageDirection = reverse() ? 'rtl' : 'ltr';
        root.style.setProperty('--reading-size', `${fontSize.value}px`);
        root.style.setProperty('--reading-font', typeface.value === 'sans' ? '-apple-system, BlinkMacSystemFont, sans-serif' : "'Hiragino Mincho ProN', 'Yu Mincho', 'Noto Serif CJK JP', Georgia, serif");
        fontSizeLabel.value = `${fontSize.value} px`;
    };
    try {
        const saved = await new Promise((resolve) => chrome.storage.local.get(preferenceKey, (data) => {
            if (chrome.runtime.lastError) { resolve(null); } else { resolve(data[preferenceKey]); }
        }));
        if (saved && typeof saved === 'object') {
            if (Number.isFinite(saved.fontSize) && saved.fontSize >= 16 && saved.fontSize <= 36) { fontSize.value = `${saved.fontSize}`; }
            if (['system', 'light', 'paper', 'dark'].includes(saved.theme)) { theme.value = saved.theme; }
            if (['serif', 'sans'].includes(saved.typeface)) { typeface.value = saved.typeface; }
            if (['horizontal', 'vertical'].includes(saved.writingMode)) { writingMode.value = saved.writingMode; }
        }
    } catch (error) { console.warn('[Yomitan][EPUB] Could not load preferences', error); }
    updateAppearance();
    const savePreferences = () => chrome.storage.local.set({[preferenceKey]: {fontSize: Number(fontSize.value), theme: theme.value, typeface: typeface.value, writingMode: writingMode.value}}, () => {
        const error = chrome.runtime.lastError;
        if (error) { console.warn('[Yomitan][EPUB] Could not save preferences', error.message); }
    });
    const changeAppearance = () => {
        const readingFraction = fraction();
        frontend.popup?.hide(false);
        updateAppearance();
        restoreFraction(readingFraction);
        updatePosition();
        savePreferences();
    };
    fontSize.addEventListener('input', changeAppearance);
    for (const control of [theme, typeface, writingMode]) { control.addEventListener('change', changeAppearance); }

    const highlightContents = (target) => {
        let matching = false;
        for (const link of links.querySelectorAll('a')) {
            if (link.dataset.epubTarget === target) { link.setAttribute('aria-current', 'location'); matching = true; } else { link.removeAttribute('aria-current'); }
        }
        if (!matching) {
            const first = [...links.querySelectorAll('a')].find((link) => link.dataset.epubTarget.split('#')[0] === book.spine[chapterIndex].path);
            first?.setAttribute('aria-current', 'location');
        }
    };
    const scrollToFragment = (target) => {
        const hash = target.indexOf('#');
        if (hash < 0) { return; }
        let id;
        try { id = decodeURIComponent(target.slice(hash + 1)); } catch (error) { return; }
        const element = [...chapter.querySelectorAll('[data-epub-id]')].find((item) => item.dataset.epubId === id);
        element?.scrollIntoView({block: 'start', inline: 'start', behavior: 'instant'});
    };
    const showChapter = async (index, {target = '', end = false} = {}) => {
        if (!book || index < 0 || index >= book.spine.length) { return; }
        const currentBook = book;
        const generation = ++chapterGeneration;
        loadingChapter = true;
        updatePosition();
        status.textContent = 'Loading section…';
        frontend.popup?.hide(false);
        window.getSelection()?.removeAllRanges();
        try {
            const fragment = await currentBook.chapter(index);
            if (generation !== chapterGeneration || book !== currentBook) { return; }
            chapter.replaceChildren(fragment);
            selectedImage = null;
            chapter.dataset.imageOnly = `${chapter.querySelector('img') !== null && chapter.textContent.trim() === ''}`;
            chapter.lang = book.language;
            chapter.hidden = false;
            empty.hidden = true;
            chapterIndex = index;
            chapterSelect.value = `${index}`;
            await Promise.all([...chapter.querySelectorAll('img')].map((image) => image.decode().catch(() => {})));
            if (generation !== chapterGeneration || book !== currentBook) { return; }
            restoreFraction(end ? 1 : 0);
            if (target) { scrollToFragment(target); }
            highlightContents(target || book.spine[index].path);
            status.textContent = '';
            area.focus({preventScroll: true});
        } catch (error) {
            if (generation !== chapterGeneration) { return; }
            status.textContent = error instanceof Error ? error.message : 'Could not display this section.';
        } finally {
            if (generation === chapterGeneration) { loadingChapter = false; updatePosition(); }
        }
    };
    const navigate = async (target) => {
        if (!book || opening) { return; }
        const index = book.spine.findIndex((item) => item.path === target.split('#')[0]);
        if (index < 0) { status.textContent = 'This link points to a section outside the reading order.'; return; }
        appearance.open = false;
        if (index === chapterIndex && !loadingChapter) {
            frontend.popup?.hide(false);
            if (target.includes('#')) { scrollToFragment(target); } else { restoreFraction(0); }
            highlightContents(target);
            updatePosition();
        } else { await showChapter(index, {target}); }
    };
    const buildContents = () => {
        links.replaceChildren();
        for (const item of book.contents) {
            const link = document.createElement('a');
            link.href = '#';
            link.dataset.epubTarget = item.target;
            link.textContent = item.label;
            link.style.paddingLeft = `${10 + Math.min(5, item.depth) * 14}px`;
            links.appendChild(link);
        }
        chapterSelect.replaceChildren();
        for (const [index, item] of book.spine.entries()) {
            const option = document.createElement('option');
            option.value = `${index}`;
            option.textContent = item.label;
            chapterSelect.appendChild(option);
        }
    };
    const openFile = async (file) => {
        if (!file || !/\.epub$/i.test(file.name)) { status.textContent = 'Choose an EPUB file.'; return; }
        const generation = ++openGeneration;
        ++chapterGeneration;
        opening = true;
        loadingChapter = false;
        previous.disabled = true;
        next.disabled = true;
        chapterSelect.disabled = true;
        contentsButton.disabled = true;
        status.textContent = 'Opening book…';
        try {
            const opened = await EpubBook.open(file);
            if (generation !== openGeneration) { await opened.close(); return; }
            const oldBook = book;
            book = opened;
            characterCounts = null;
            characterCountError = false;
            chapterIndex = 0;
            title.textContent = book.title;
            title.title = book.title;
            author.textContent = book.author;
            document.title = `${book.title} — EPUB Reader`;
            buildContents();
            updateAppearance();
            opening = false;
            void book.characterCounts((complete, total) => {
                if (book !== opened) { return; }
                status.textContent = `Counting book text (${complete}/${total} sections)…`;
            }).then((counts) => {
                if (book !== opened) { return; }
                characterCounts = counts;
                if (status.textContent.startsWith('Counting book text')) { status.textContent = ''; }
                updatePosition();
            }).catch((error) => {
                if (book !== opened) { return; }
                console.warn('[Yomitan][EPUB] Could not count all book text', error);
                characterCountError = true;
                updatePosition();
            });
            await showChapter(0);
            if (oldBook) { await oldBook.close(); }
        } catch (error) {
            if (generation === openGeneration) { status.textContent = error instanceof Error ? error.message : 'Could not open this EPUB.'; }
        } finally {
            if (generation === openGeneration) { opening = false; updatePosition(); }
        }
    };
    const turnPage = (step) => {
        if (!book || opening || loadingChapter) { return; }
        appearance.open = false;
        frontend.popup?.hide(false);
        const {maximum, offset} = metrics();
        if (step > 0 && offset >= maximum - 2) { void showChapter(chapterIndex + 1); return; }
        if (step < 0 && offset <= 2) { void showChapter(chapterIndex - 1, {end: true}); return; }
        const amount = Math.max(1, vertical() ? area.clientWidth : area.clientHeight) * step;
        area.scrollBy({left: vertical() ? -amount : 0, top: vertical() ? 0 : amount, behavior: 'instant'});
        updatePosition();
    };
    openButton.addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
    fileInput.addEventListener('change', () => { void openFile(fileInput.files?.[0]); });
    previous.addEventListener('click', () => turnPage(-1));
    next.addEventListener('click', () => turnPage(1));
    contentsButton.addEventListener('click', () => {
        contents.hidden = !contents.hidden;
        contentsButton.setAttribute('aria-expanded', `${!contents.hidden}`);
        updatePosition();
    });
    for (const container of [links, chapter]) {
        container.addEventListener('click', (event) => {
            const link = event.target instanceof Element ? event.target.closest('a[data-epub-target]') : null;
            if (!link) { return; }
            event.preventDefault();
            void navigate(link.dataset.epubTarget);
        });
    }
    chapterSelect.addEventListener('change', () => { void showChapter(Number(chapterSelect.value)); });
    area.addEventListener('scroll', updatePosition, {passive: true});
    window.addEventListener('resize', updatePosition);
    document.addEventListener('click', (event) => { if (!appearance.contains(event.target)) { appearance.open = false; } });
    document.addEventListener('keydown', (event) => {
        if (event.defaultPrevented || event.isComposing) { return; }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') {
            event.preventDefault(); fileInput.value = ''; fileInput.click(); return;
        }
        const target = event.target;
        if (target instanceof Element && target.closest('input,select,textarea,[contenteditable],.yomitan-inline-popup') !== null) { return; }
        if (event.key === ' ' && target instanceof Element && target.closest('button,summary,a')) { return; }
        if (event.key === 'Escape') {
            appearance.open = false;
            contents.hidden = true;
            contentsButton.setAttribute('aria-expanded', 'false');
            return;
        }
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || appearance.open || target?.closest?.('#contents')) { return; }
        let step = 0;
        switch (event.key) {
            case 'ArrowRight': step = reverse() ? -1 : 1; break;
            case 'ArrowLeft': step = reverse() ? 1 : -1; break;
            case 'ArrowDown':
            case 'PageDown':
            case ' ': step = 1; break;
            case 'ArrowUp':
            case 'PageUp': step = -1; break;
        }
        if (step && book) { event.preventDefault(); turnPage(step); }
    });
    let dragDepth = 0;
    let internalDrag = false;
    document.addEventListener('dragstart', (event) => {
        if (event.target instanceof HTMLImageElement && chapter.contains(event.target)) {
            event.preventDefault();
            dragDepth = 0;
            dropHint.hidden = true;
            return;
        }
        internalDrag = true;
    }, true);
    document.addEventListener('dragend', () => { internalDrag = false; dragDepth = 0; dropHint.hidden = true; });
    document.addEventListener('dragenter', (event) => {
        if (internalDrag || !event.dataTransfer?.types.includes('Files')) { return; }
        event.preventDefault(); ++dragDepth; dropHint.hidden = false;
    });
    document.addEventListener('dragover', (event) => {
        if (!internalDrag && event.dataTransfer?.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }
    });
    document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dropHint.hidden = true; } });
    document.addEventListener('drop', (event) => {
        event.preventDefault(); dragDepth = 0; dropHint.hidden = true;
        if (internalDrag) { internalDrag = false; return; }
        void openFile(event.dataTransfer?.files[0]);
    });
    window.addEventListener('pagehide', (event) => {
        if (event.persisted) { return; }
        ++openGeneration; ++chapterGeneration;
        if (book) { void book.close().catch(() => {}); }
    });
});

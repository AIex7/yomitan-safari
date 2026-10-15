import {BlobReader, BlobWriter, TextWriter, ZipReader} from '../../lib/zip.js';

const BOOK_ORIGIN = 'https://epub.invalid/';
const MAX_TEXT_SIZE = 8 * 1024 * 1024;
const ALLOWED_TAGS = new Set('a abbr address article aside b bdi bdo blockquote br caption cite code col colgroup dd del details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img li main mark nav ol p pre q rp rt ruby s samp section small span strong sub summary sup table tbody td tfoot th thead time tr u ul var wbr'.split(' '));
const DROP_TAGS = new Set('script style link meta head title iframe object embed form input button select textarea canvas video audio source track applet noscript'.split(' '));
const IMAGE_TYPES = new Map([['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['png', 'image/png'], ['gif', 'image/gif'], ['webp', 'image/webp'], ['avif', 'image/avif'], ['svg', 'image/svg+xml']]);

function elements(root, name) { return [...root.getElementsByTagNameNS('*', name)]; }
function parseXml(text, label) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (elements(doc, 'parsererror').length > 0) { throw new Error(`Could not read ${label}. The EPUB may be damaged or protected.`); }
    return doc;
}

/** Local EPUB archive. Book text and image URLs live only in this page's memory. */
export class EpubBook {
    constructor(reader, files) {
        this.reader = reader;
        this.files = files;
        this.spine = [];
        this.contents = [];
        this.title = '';
        this.author = '';
        this.language = '';
        this.direction = 'ltr';
        this.assets = new Map();
        this.urls = new Set();
        this.closed = false;
    }

    static async open(file) {
        if (file.size > 256 * 1024 * 1024) { throw new Error('This EPUB is too large to open (maximum 256 MB).'); }
        const reader = new ZipReader(new BlobReader(file), {useWebWorkers: false});
        let book;
        try {
            const entries = await reader.getEntries();
            if (entries.length > 20000 || entries.reduce((sum, entry) => sum + (entry.uncompressedSize || 0), 0) > 512 * 1024 * 1024) {
                throw new Error('This EPUB contains too much data to open.');
            }
            book = new EpubBook(reader, new Map(entries.filter((entry) => !entry.directory).map((entry) => [entry.filename, entry])));
            const container = parseXml(await book.text('META-INF/container.xml'), 'the book container');
            const packagePath = elements(container, 'rootfile')[0]?.getAttribute('full-path');
            if (!packagePath) { throw new Error('No EPUB package was found.'); }
            const packageDoc = parseXml(await book.text(packagePath), 'the book package');
            book.title = elements(packageDoc, 'title')[0]?.textContent?.trim() || file.name.replace(/\.epub$/i, '');
            book.author = elements(packageDoc, 'creator').map((element) => element.textContent?.trim()).filter(Boolean).join(', ');
            book.language = elements(packageDoc, 'language')[0]?.textContent?.trim() || '';
            book.direction = elements(packageDoc, 'spine')[0]?.getAttribute('page-progression-direction') === 'rtl' ? 'rtl' : 'ltr';
            const manifest = new Map(elements(packageDoc, 'item').map((item) => [item.getAttribute('id'), {
                path: book.resolve(item.getAttribute('href') || '', packagePath),
                type: item.getAttribute('media-type'),
                properties: (item.getAttribute('properties') || '').split(/\s+/),
            }]));
            for (const ref of elements(packageDoc, 'itemref')) {
                const item = manifest.get(ref.getAttribute('idref'));
                if (!item || !['application/xhtml+xml', 'text/html'].includes(item.type)) { continue; }
                book.spine.push({path: item.path, label: `Section ${book.spine.length + 1}`});
            }
            if (book.spine.length === 0) { throw new Error('No readable chapters were found in this EPUB.'); }
            const nav = [...manifest.values()].find((item) => item.properties.includes('nav'));
            const ncx = [...manifest.values()].find((item) => item.type === 'application/x-dtbncx+xml');
            try {
                if (nav) {
                    const doc = parseXml(await book.text(nav.path), 'the table of contents');
                    const toc = elements(doc, 'nav').find((element) => (element.getAttribute('epub:type') || element.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '').split(/\s+/).includes('toc'));
                    if (toc) {
                        for (const link of elements(toc, 'a')) {
                            const href = link.getAttribute('href');
                            if (!href) { continue; }
                            let depth = 0;
                            for (let parent = link.parentElement; parent && parent !== toc; parent = parent.parentElement) {
                                if (parent.localName === 'ol') { ++depth; }
                            }
                            book.addContent(link.textContent, book.resolve(href, nav.path, true), Math.max(0, depth - 1));
                        }
                    }
                } else if (ncx) {
                    const doc = parseXml(await book.text(ncx.path), 'the table of contents');
                    for (const point of elements(doc, 'navPoint')) {
                        const content = elements(point, 'content')[0]?.getAttribute('src');
                        if (!content) { continue; }
                        let depth = 0;
                        for (let parent = point.parentElement; parent?.localName === 'navPoint'; parent = parent.parentElement) { ++depth; }
                        book.addContent(elements(point, 'text')[0]?.textContent, book.resolve(content, ncx.path, true), depth);
                    }
                }
            } catch (error) { console.warn('[Yomitan][EPUB] Using the spine as contents', error); }
            if (book.contents.length === 0) {
                book.contents = book.spine.map((chapter, index) => ({...chapter, index, depth: 0, target: chapter.path}));
            }
            return book;
        } catch (error) {
            if (book) { await book.close(); } else { await reader.close(); }
            throw error;
        }
    }

    resolve(href, base, keepFragment = false) {
        const url = new URL(href, new URL(base, BOOK_ORIGIN));
        if (url.origin !== new URL(BOOK_ORIGIN).origin) { throw new Error('External book resources are not loaded.'); }
        return decodeURIComponent(url.pathname.slice(1)) + (keepFragment ? url.hash : '');
    }

    addContent(label, target, depth) {
        const path = target.split('#')[0];
        const index = this.spine.findIndex((chapter) => chapter.path === path);
        const text = label?.trim();
        if (index < 0 || !text) { return; }
        if (this.spine[index].label.startsWith('Section ')) { this.spine[index].label = text; }
        this.contents.push({label: text, target, index, depth});
    }

    async text(path) {
        const entry = this.files.get(path);
        if (!entry || entry.encrypted) { throw new Error(`Cannot read ${path}. The book may be incomplete or protected.`); }
        if (entry.uncompressedSize > MAX_TEXT_SIZE) { throw new Error('A book section is too large to display.'); }
        return await entry.getData(new TextWriter(), {useWebWorkers: false});
    }

    async image(path) {
        if (this.assets.has(path)) { return await this.assets.get(path); }
        const promise = (async () => {
            const entry = this.files.get(path);
            const type = IMAGE_TYPES.get(path.split('.').pop().toLowerCase());
            if (!entry || !type || entry.encrypted || entry.uncompressedSize > 40 * 1024 * 1024) { return null; }
            // SVG resources are decoded as images, never inserted as active markup.
            const blob = await entry.getData(new BlobWriter(type), {useWebWorkers: false});
            if (this.closed) { return null; }
            const url = URL.createObjectURL(blob);
            this.urls.add(url);
            return url;
        })();
        this.assets.set(path, promise);
        return await promise;
    }

    async chapter(index) {
        const path = this.spine[index].path;
        const markup = await this.text(path);
        let parsed = new DOMParser().parseFromString(markup, 'application/xhtml+xml');
        if (elements(parsed, 'parsererror').length > 0) { parsed = new DOMParser().parseFromString(markup, 'text/html'); }
        const body = elements(parsed, 'body')[0];
        if (!body) { throw new Error('This chapter has no readable content.'); }
        const fragment = document.createDocumentFragment();
        const pending = [];
        const copy = (node, target) => {
            if (node.nodeType === Node.TEXT_NODE) { target.appendChild(document.createTextNode(node.textContent || '')); return; }
            if (node.nodeType !== Node.ELEMENT_NODE) { return; }
            const name = node.localName.toLowerCase();
            if (DROP_TAGS.has(name)) { return; }
            // EPUB covers frequently wrap their bitmap in an SVG image element.
            if (name === 'svg') {
                for (const image of elements(node, 'image')) {
                    const href = image.getAttribute('href') || image.getAttribute('xlink:href');
                    if (href) { appendImage(href, image.getAttribute('aria-label') || '', target); }
                }
                return;
            }
            if (!ALLOWED_TAGS.has(name)) {
                for (const child of node.childNodes) { copy(child, target); }
                return;
            }
            if (name === 'img') {
                const src = node.getAttribute('src');
                if (src) { appendImage(src, node.getAttribute('alt') || '', target); }
                return;
            }
            const element = document.createElement(name);
            for (const attr of ['id', 'title', 'lang', 'dir', 'colspan', 'rowspan', 'start', 'reversed']) {
                const value = node.getAttribute(attr);
                if (value !== null) {
                    if (attr === 'id') { element.id = `epub-content-${value}`; element.dataset.epubId = value; } else { element.setAttribute(attr, value); }
                }
            }
            const inline = node.getAttribute('style');
            if (inline) {
                const style = document.createElement('span').style;
                style.cssText = inline;
                for (const property of ['text-align', 'font-weight', 'font-style', 'text-indent']) {
                    const value = style.getPropertyValue(property);
                    if (value && !/url\s*\(|var\s*\(/i.test(value)) { element.style.setProperty(property, value); }
                }
            }
            if (name === 'a') {
                const href = node.getAttribute('href');
                if (href) {
                    try {
                        const url = new URL(href, new URL(path, BOOK_ORIGIN));
                        if (url.origin === new URL(BOOK_ORIGIN).origin) {
                            element.href = '#';
                            element.dataset.epubTarget = this.resolve(href, path, true);
                        } else if (url.protocol === 'https:' || url.protocol === 'http:') {
                            element.href = url.href;
                            element.target = '_blank';
                            element.rel = 'noopener noreferrer';
                        }
                    } catch (error) { /* Leave invalid links as plain text. */ }
                }
            }
            target.appendChild(element);
            for (const child of node.childNodes) { copy(child, element); }
        };
        const appendImage = (href, alt, target) => {
            const image = document.createElement('img');
            image.alt = alt;
            image.decoding = 'async';
            target.appendChild(image);
            try {
                const imagePath = this.resolve(href, path);
                pending.push(this.image(imagePath).then((url) => {
                    if (url) { image.src = url; } else if (!alt) { image.remove(); }
                }).catch(() => { if (!alt) { image.remove(); } }));
            } catch (error) { if (!alt) { image.remove(); } }
        };
        for (const child of body.childNodes) { copy(child, fragment); }
        await Promise.all(pending);
        return fragment;
    }

    async close() {
        if (this.closed) { return; }
        this.closed = true;
        for (const url of this.urls) { URL.revokeObjectURL(url); }
        this.urls.clear();
        this.assets.clear();
        await this.reader.close();
    }
}

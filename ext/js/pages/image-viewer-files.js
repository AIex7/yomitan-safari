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

const supportedExtensions = new Set(['avif', 'bmp', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'tif', 'tiff', 'webp']);
const nameComparer = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});

/**
 * @param {string} name
 * @returns {string}
 */
export function imageTitle(name) {
    const dot = name.lastIndexOf('.');
    return dot < 0 ? name : name.substring(0, dot);
}

/**
 * @param {Iterable<File>} files
 * @returns {File[]}
 */
export function getImageFiles(files) {
    return [...files].filter((file) => {
        const path = file.webkitRelativePath.split('/');
        if (path.length > 2) { return false; }
        if (file.name.startsWith('.')) { return false; }
        const extension = file.name.substring(file.name.lastIndexOf('.') + 1).toLowerCase();
        return supportedExtensions.has(extension);
    }).sort((left, right) => nameComparer.compare(imageTitle(left.name), imageTitle(right.name)));
}

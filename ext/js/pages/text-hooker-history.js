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

/** @typedef {{entries: string[], limit: number, lastChangeCount: number|null}} TextHookerState */

export class TextHookerHistory {
    /** @param {Partial<TextHookerState>} [state] */
    constructor(state = {}) {
        this.limit = 200;
        /** @type {string[]} */
        this.entries = [];
        /** @type {number|null} */
        this.lastChangeCount = Number.isInteger(state.lastChangeCount) ? state.lastChangeCount ?? null : null;
        this.setLimit(state.limit ?? 200);
        if (Array.isArray(state.entries)) {
            this.entries = state.entries.filter((entry) => typeof entry === 'string' && entry.trim().length > 0).slice(-this.limit);
        }
    }

    /** @param {number} limit */
    setLimit(limit) {
        if (!Number.isInteger(limit) || limit < 1 || limit > 5000) { return false; }
        this.limit = limit;
        this.entries = this.entries.slice(-limit);
        return true;
    }

    /**
     * @param {{text: string, changeCount: number}} clipboard
     * @returns {boolean}
     */
    append({text, changeCount}) {
        if (changeCount === this.lastChangeCount) { return false; }
        this.lastChangeCount = changeCount;
        if (text.trim().length === 0) { return false; }
        this.entries.push(text);
        this.entries = this.entries.slice(-this.limit);
        return true;
    }

    /** @returns {TextHookerState} */
    snapshot() {
        return {entries: [...this.entries], limit: this.limit, lastChangeCount: this.lastChangeCount};
    }
}

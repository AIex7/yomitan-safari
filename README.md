# Yomitan


## Features

This extension adds several features no top of the original Yomitan:

<table>
  <tr>
    <td width="50%" align="center">
      <img src="https://github.com/user-attachments/assets/42242501-39b4-4757-bcba-0a99e04628b4" width="100%" alt="Multi-line Texthooker" />
      <br />
      <b>Multi-line Texthooker</b>
    </td>
    <td width="50%" align="center">
      <img src="https://github.com/user-attachments/assets/197403b8-2d22-4ef6-83e2-3296c7a7cf58" width="100%" alt="Image Viewer with OCR" />
      <br />
      <b>Image Viewer with Live OCR</b>
    </td>
  </tr>
  <tr>
    <td valign="top">
      A separate texthooker that supports displaying multiple lines of text with furigana.
    </td>
    <td valign="top">
      An image viewer that supports live text scanning using macOS's native OCR model.
    </td>
  </tr>
</table>



<table>
  <tr>
    <td width="50%" align="center">
      <img src="https://github.com/user-attachments/assets/24cb6569-f6dd-407c-8314-534d98836518" width="100%" alt="Morphman Mode highlighting unknown words" />
      <br />
      <b>Morphman Mode</b>
    </td>
    <td width="50%" align="center">
      <img src="https://github.com/user-attachments/assets/f76b2dc5-b937-43e3-a56a-524b018a2e0c" width="100%" alt="Morphman results with sorting and bulk Anki adding" />
      <br />
      <b>Morphman Results</b>
    </td>
  </tr>
  <tr>
    <td valign="top">
      Toggle Morphman Mode to highlight Japanese words starting with kanji that are missing from your Anki collection.
    </td>
    <td valign="top">
      View and sort unknown words with their frequencies and sentences, select multiple rows, and add them to Anki with their original context.
    </td>
  </tr>
</table>



## Building

1. Install [Node.js](https://nodejs.org/) and [npm](https://www.npmjs.com/).
2. Run `npm ci`.
3. Run `npm run license-report:html`.
4. Run `npm run build`.
5. Build output is written to `builds/`.

## Safari on macOS

Run:

```sh
./build-safari.sh --version 26.2.17.0
```

This generates:

- `builds/yomitan-safari-web-extension`
- `builds/yomitan-safari-app`

Open the generated Xcode project:

- `builds/yomitan-safari-app/Yomitan Safari/Yomitan Safari.xcodeproj`

In Xcode:

1. Select the `Yomitan Safari` scheme.
2. Set the destination to `My Mac`.
3. In Signing & Capabilities, set the same Developer Team on both `Yomitan Safari` and `Yomitan Safari Extension`.
4. Build and run the app.
5. If needed, you can run without enabling developer mode by signing both targets and using the signed app directly.

## TextHooker (Safari on macOS)

Open the Yomitan toolbar popup and click **Open TextHooker**. The page automatically reads plain text from the macOS clipboard while it is open; there is no paste button or browser clipboard permission prompt. New clipboard entries appear at the bottom in 26px text, and the page scrolls to the newest entry.

Use **Keep entries** to choose how many entries to retain (1–5,000; default 200). The limit and history are saved locally in Safari extension storage, and the oldest entries are removed when the limit is reached. TextHooker polls every half second; Safari may slow polling in background tabs, so very rapid clipboard changes can be missed.

TextHooker automatically adds hiragana above Japanese kanji using your enabled Yomitan dictionaries, including for saved entries. This runs locally and needs no toggle or additional installation. Unknown words remain unchanged; names and words with multiple readings may receive an incorrect reading. History stores the original clipboard text, and dictionary lookup still works on the text below the furigana.

Hold **Shift** over a word to open its dictionary popup. If you chose **F17** in Settings → Scanning → Safari lookup key, press F17 over a word or selected text instead. Scrolling the page hides the lookup popup.

TextHooker requires the built Safari app’s native clipboard bridge, so rebuild and run the Safari app after updating.

## Image viewer (Safari on macOS)

Click **Open image viewer** in the Yomitan toolbar popup, then **Open Folder** to select a local image folder. Images from the selected folder appear vertically in natural filename order; hidden files and subfolders are skipped. Supported extensions are AVIF, BMP, GIF, HEIC, HEIF, JPEG/JPG, PNG, TIFF/TIF, and WebP, subject to Safari’s image decoding support.

Use the arrow keys to move between images. Click **Fit Screen** or press **F** to toggle between fitting each image to the screen and its natural size (limited to the window width). The counter in the top-right corner follows the current image.

The viewer reloads image elements after changing size, resizing the window, or changing browser zoom so Safari can refresh Live Text selection. This is a workaround; Safari may still fail to select text at some sizes.

Images stay local to the viewer tab. Selecting text in the image viewer automatically opens the dictionary popup, including Safari Live Text selections where available; no Shift key is needed. This automatic selection lookup is limited to the image viewer. Other pages keep their Shift/F17 behavior. Scrolling closes the lookup popup.

## Scanning

### Morphman Mode (Safari)

Click **Toggle Morphman Mode** in the toolbar popup to scan all readable text on the current page, including text below the viewport, and highlight Japanese dictionary words that start with kanji and have no matching Anki note. The page shows **characters complete / total characters**, advancing after each batch has been parsed and checked against Anki. Highlights appear progressively. Click the button again to remove them. The mode resets when the page reloads and rescans when page text changes. Scrolling displays the existing highlights without restarting the scan. Ordinary dictionary lookup still works through the highlights.

Keep Anki open with AnkiConnect available. Matching uses the active Yomitan profile's term card models and word fields mapped exactly to `{expression}` or `{furigana-plain}`, across all decks. It checks dictionary forms and dictionary readings in batches, so conjugated text can match a card for its base word. Example sentences are not used as word fields. A message on the page reports connection errors rather than treating every word as missing.

During each scan, repeated Anki expression searches reuse their earlier result, including expressions that were not found. Different models, fields, or furigana values are checked separately. A new scan checks Anki again so newly added cards are recognized.

When the scan completes, a new **Morphman results** tab opens with missing words, readings, and source sentences. Click a row to select it, Shift-click to select a range, or Command-click to select individual rows. Command-A selects all available rows when the table has focus. Click any column heading to sort; click it again to reverse the order. The **Frequencies** column shows values from enabled frequency dictionaries and sorts numerically by the first listed dictionary, with missing values last. Choose a configured card format and click **Add selected to Anki**. Each row reports its confirmed addition or an error; failed rows can be retried. Each expression appears once, using its first sentence context from the page. Cards use the original page URL, title, sentence, word position, and the scanned profile's field templates and tags, including sentence furigana. Confirmed rows are disabled to prevent adding them again from this table. Results are stored locally while the results tab is open and removed when it closes.

This scans webpage text, including TextHooker text. Safari's image Live Text recognition is not exposed as ordinary page text, so images themselves are not scanned. Embedded frame contents are not scanned by the toolbar toggle. Word segmentation follows Yomitan's dictionary parser and may be ambiguous for names or compounds.

- On Safari for macOS, hold Shift over a word to look it up beside the word.
- In Settings → Scanning → Safari lookup key, choose F17 to look up the word under the pointer or selected text with a keypress.
- On Safari for macOS, Live Text in images is supported when you select the text with the mouse.

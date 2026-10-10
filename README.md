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
3. In Signing & Capabilities, set the same Developer Team on both `Yomitan Safari` and `Yomitan Safari Extension`. If done properly, the extension will show without the need to side load in developer settings.
4. Build and run the app.

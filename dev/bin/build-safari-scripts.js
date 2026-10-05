import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoot = path.join(root, 'ext');
const outputRoot = path.resolve(process.argv[2]);

const entryPoints = [
    ['js/app/content-script-main.js', 'js/app/content-script-safari.js'],
    ['js/pages/action-popup-main.js', 'js/pages/action-popup-safari.js'],
    ['sw.js', 'sw-safari.js'],
];

for (const [entryPoint, outputPath] of entryPoints) {
    await esbuild.build({
        entryPoints: [path.join(sourceRoot, entryPoint)],
        outfile: path.join(outputRoot, outputPath),
        bundle: true,
        format: 'iife',
        platform: 'browser',
        target: 'safari17',
        plugins: [{
        name: 'safari-extension-module-urls',
        setup(build) {
            build.onLoad({filter: /\.js$/}, async ({path: sourcePath}) => {
                const source = await readFile(sourcePath, 'utf8');
                if (sourcePath === path.join(sourceRoot, entryPoint) && entryPoint !== 'sw.js') {
                    if (!source.includes('await Application.main(')) {
                        throw new Error(`Safari script entry point has changed: ${entryPoint}`);
                    }
                    return {
                        contents: source.replace('await Application.main(', 'void Application.main('),
                        loader: 'js',
                    };
                }
                if (!source.includes('import.meta.url')) { return null; }
                const extensionPath = '/' + path.relative(sourceRoot, sourcePath).split(path.sep).join('/');
                return {
                    contents: source.replaceAll('import.meta.url', `chrome.runtime.getURL(${JSON.stringify(extensionPath)})`),
                    loader: 'js',
                };
            });
        },
        }],
    });
}

const popupPath = path.join(outputRoot, 'action-popup.html');
const popup = await readFile(popupPath, 'utf8');
const originalScript = '<script src="/js/pages/action-popup-main.js" type="module"></script>';
if (!popup.includes(originalScript)) { throw new Error('Safari action popup script tag has changed'); }
const originalStyle = '<link rel="stylesheet" type="text/css" href="/css/action-popup.css">';
if (!popup.includes(originalStyle)) { throw new Error('Safari action popup stylesheet has changed'); }
await writeFile(
    popupPath,
    popup
        .replace('<html lang="en">', '<html lang="en" class="safari-action-popup">')
        .replace(originalStyle, `${originalStyle}\n    <link rel="stylesheet" type="text/css" href="/css/action-popup-safari.css">`)
        .replace(originalScript, '<script src="/js/pages/action-popup-safari.js" defer></script>'),
);

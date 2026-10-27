import {build} from 'vite';
import {copyFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
await build({configFile:fileURLToPath(new URL('../static-preview/vite.config.mjs',import.meta.url))});
await mkdir(new URL('dist-pages',root),{recursive:true});
await copyFile(new URL('public/favicon.svg',root),new URL('dist-pages/favicon.svg',root));
await writeFile(new URL('dist-pages/.nojekyll',root),'');

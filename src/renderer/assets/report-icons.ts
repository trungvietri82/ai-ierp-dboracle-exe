// Report / brand icons imported as modules.
//
// IMPORTANT: do NOT reference these as absolute public paths like
// `<img src="/icon_AI_square.png">`. That works under the Vite dev server
// (served from web root) but BREAKS in the packaged app, where the renderer
// loads from `file://.../dist/index.html` and a leading-slash URL resolves to
// the filesystem root (`file:///icon_AI_square.png`) — a broken image.
//
// Importing them lets Vite emit content-hashed, *relative* URLs
// (`./assets/icon_AI_square-<hash>.png`) that resolve correctly under file://,
// exactly like the brand logo (see store/selectors.ts).
import aiSquare from './icon_AI_square.png';
import baocaoBI from './baocaoBI.png';
import baocaoTinh from './baocaotinh.jpg';

export { aiSquare, baocaoBI, baocaoTinh };

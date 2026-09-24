// `bb plugin build` bundles imported stylesheets into app.css. TypeScript 6
// and later check side-effect imports, so a `.css` import needs a module to
// resolve to.
declare module "*.css";

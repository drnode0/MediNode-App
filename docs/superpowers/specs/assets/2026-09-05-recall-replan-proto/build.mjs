import { build } from '/Users/tatsukinonaka/MediNode-本体/node_modules/esbuild/lib/main.js'
import fs from 'node:fs'
const SP = process.argv[2]
const r = await build({
  entryPoints: [SP + '/proto/entry.tsx'], bundle: true, write: false, format: 'iife', platform: 'browser',
  jsx: 'automatic', tsconfig: '/Users/tatsukinonaka/MediNode-本体/tsconfig.json', absWorkingDir: '/Users/tatsukinonaka/MediNode-本体', nodePaths: ['/Users/tatsukinonaka/MediNode-本体/node_modules'],
  define: { 'process.env.NODE_ENV': '"production"' }, minify: true, target: 'es2020', logLevel: 'warning',
})
const js = r.outputFiles[0].text
const html = `<title>Recall 隠しコマンドの段</title>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jost:wght@300&family=Noto+Sans+JP:wght@300;400&display=swap">
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={darkMode:'class'}</script>
<style>body{margin:0;background:#F5F7FA;overscroll-behavior:none}html.dark body{background:#0B1524}@keyframes cap{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}.caption{animation:cap .5s ease-out both}button{font:inherit;cursor:pointer;background:transparent;color:inherit}</style>
<div id="root"></div>
<script>${js.replace(/<\/script/g, '<\\/script')}</script>`
fs.writeFileSync(SP + '/recall-lift-stages.html', html)
console.log('bundle', (js.length / 1024).toFixed(0), 'KB')

const { createEngine } = await import(new URL("../packages/engine/dist/index.js", import.meta.url).href);
for (let i = 0; i < 1000; i++) createEngine();
for (let i = 0; i < 40000; i++) createEngine();

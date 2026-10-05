#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const graph = JSON.parse(await fs.readFile(path.join(root, "program/graph.json"), "utf8"));
const errors = [];
const ids = new Set(graph.workOrders.map((w) => w.id));

for (const w of graph.workOrders) {
  for (const dep of w.depends) {
    if (!ids.has(dep)) errors.push(w.id + ": unknown dependency " + dep);
    if (dep === w.id) errors.push(w.id + ": self dependency");
  }
  if (!Array.isArray(w.writeSurface)) errors.push(w.id + ": writeSurface must be an array");
}

const active = graph.workOrders.filter((w) => w.status === "ACTIVE" || w.status === "REVIEW");
if (active.length > graph.maxConcurrentWorkers) {
  errors.push("active worker limit exceeded: " + active.length);
}

for (let i = 0; i < active.length; i++) {
  for (let j = i + 1; j < active.length; j++) {
    const a = new Set(active[i].writeSurface);
    const overlap = active[j].writeSurface.filter((p) => a.has(p));
    if (overlap.length) errors.push("write-surface overlap: " + active[i].id + " / " + active[j].id + " / " + overlap.join(","));
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("program check: PASS (" + graph.workOrders.length + " Work Orders; max " + graph.maxConcurrentWorkers + " workers)");

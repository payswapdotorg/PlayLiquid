#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const graph = JSON.parse(await fs.readFile(path.join(root, "program/graph.json"), "utf8"));
const errors = [];
const ids = new Set(graph.workOrders.map((w) => w.id));
const central = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "architecture-policy.yaml",
  "program/graph.json",
  "spec/PROJECT-STATE.md"
]);

for (const w of graph.workOrders) {
  if (!w.id || !w.branch) errors.push("work order missing id/branch");
  if (!Array.isArray(w.depends)) errors.push(w.id + ": depends must be an array");
  if (!Array.isArray(w.writeSurface) || w.writeSurface.length === 0) errors.push(w.id + ": writeSurface must be non-empty");
  for (const dep of w.depends ?? []) {
    if (!ids.has(dep)) errors.push(w.id + ": unknown dependency " + dep);
    if (dep === w.id) errors.push(w.id + ": self dependency");
  }
  if (w.owner === "worker" && (w.writeSurface ?? []).some((p) => central.has(p))) {
    errors.push(w.id + ": worker owns central surface");
  }
}

const color = new Map();
function visit(id) {
  const state = color.get(id) ?? 0;
  if (state === 1) { errors.push("dependency cycle reaches " + id); return; }
  if (state === 2) return;
  color.set(id, 1);
  const w = graph.workOrders.find((x) => x.id === id);
  for (const dep of w?.depends ?? []) visit(dep);
  color.set(id, 2);
}
for (const w of graph.workOrders) visit(w.id);

const active = graph.workOrders.filter((w) => w.status === "ACTIVE" || w.status === "REVIEW");
if (active.length > graph.maxConcurrentWorkers) {
  errors.push("active worker limit exceeded: " + active.length + " > " + graph.maxConcurrentWorkers);
}

for (let i = 0; i < active.length; i++) {
  for (let j = i + 1; j < active.length; j++) {
    const a = new Set(active[i].writeSurface);
    const overlap = active[j].writeSurface.filter((p) => a.has(p));
    if (overlap.length) errors.push("concurrent write-surface overlap: " + active[i].id + " / " + active[j].id + " / " + overlap.join(","));
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("program check: PASS (" + graph.workOrders.length + " Work Orders; max " + graph.maxConcurrentWorkers + " workers)");

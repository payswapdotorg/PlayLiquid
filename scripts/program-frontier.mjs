#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const graph = JSON.parse(await fs.readFile(path.join(root, "program/graph.json"), "utf8"));
const status = new Map(graph.workOrders.map((w) => [w.id, w.status]));
const ready = graph.workOrders.filter((w) => w.status === "READY" || (w.status === "BLOCKED" && w.depends.every((d) => status.get(d) === "MERGED")));
console.log(ready.length ? ready.map((w) => w.id + " | " + w.owner + " | deps: " + (w.depends.join(",") || "none")).join("\n") : "frontier: EMPTY");

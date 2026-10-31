"use client";

/**
 * Task list state for the creator workspace sidebar — shared with the
 * New Task composer (submitted tasks are prepended with "now").
 */
import { create } from "zustand";

export interface DeskTask {
  id: number;
  title: string;
  time: string;
}

interface DeskTaskState {
  tasks: DeskTask[];
  addTask: (title: string) => void;
}

let nextId = 4;

export const useDeskTasks = create<DeskTaskState>((set) => ({
  // seed rows exactly as in the Interface Reconstruction v2 design
  tasks: [
    { id: 1, title: "I've connected my laptop to thi", time: "5h" },
    { id: 2, title: "Design Spark player UI", time: "1d" },
    { id: 3, title: "Research creator channels", time: "2d" },
  ],
  addTask: (title) =>
    set((s) => ({ tasks: [{ id: nextId++, title, time: "now" }, ...s.tasks] })),
}));

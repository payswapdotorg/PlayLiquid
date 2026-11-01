"use client";

/**
 * Task list state for the creator workspace sidebar. Hydrated from
 * `GET /api/tasks` by the desk shell; tasks submitted through the New Task
 * composer are prepended locally with "now" until the next hydration.
 */
import { create } from "zustand";

export interface DeskTask {
  id: string | number;
  title: string;
  time: string;
  /** set when the task produced a game — entry opens it in the Game Builder */
  gameId?: string | null;
  status?: string;
}

interface DeskTaskState {
  tasks: DeskTask[];
  /** replace the whole list (server hydration) */
  hydrate: (tasks: DeskTask[]) => void;
  /** prepend a freshly created task */
  addTask: (task: DeskTask) => void;
}

export const useDeskTasks = create<DeskTaskState>((set) => ({
  tasks: [],
  hydrate: (tasks) => set({ tasks }),
  addTask: (task) => set((s) => ({ tasks: [task, ...s.tasks] })),
}));

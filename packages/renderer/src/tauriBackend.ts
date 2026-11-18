/**
 * mindAgentics - Tauri v2 Backend Adapter
 */
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { IPC_CHANNELS as C, assertPayloadWithinLimit } from '@mindagentics/shared';
import type { UserProfile, OrchestratorStats, UserBadge } from '@mindagentics/shared';

// Safe Tauri invocation wrapper
export async function tauriInvoke<T = any>(command: string, ...args: any[]): Promise<T> {
  const payload = args.length === 0 ? undefined : args.length === 1 ? args[0] : args;
  if (payload !== undefined) {
    try {
      assertPayloadWithinLimit(command, payload);
    } catch (e) {
      return Promise.reject(e);
    }
  }
  if (!isTauri()) {
    if ((import.meta as any).env?.DEV) {
      console.warn('[tauriBackend] Non-Tauri environment: skipped invoke for', command);
    }
    return Promise.resolve(null as any);
  }
  if (command.includes(':')) {
    return invoke<T>('ipc_dispatch', { channel: command, args });
  }
  return invoke<T>(command, payload);
}

// Safe Tauri event listener wrapper
export function tauriListen<T = any>(event: string, handler: (payload: T) => void): () => void {
  let unlistenFn: (() => void) | null = null;
  let active = true;

  if (isTauri()) {
    listen<T>(event, (evt) => {
      if (active) handler(evt.payload);
    }).then((unlisten) => {
      if (!active) {
        unlisten();
      } else {
        unlistenFn = unlisten;
      }
    }).catch((err) => {
      console.warn('[tauriBackend] Failed to listen to event:', event, err);
    });
  }

  return () => {
    active = false;
    if (unlistenFn) {
      unlistenFn();
      unlistenFn = null;
    }
  };
}

function subscribe(channel: string, handler: (...args: any[]) => void) {
  return tauriListen(channel, handler);
}

function subscribeSignal(channel: string, handler: () => void) {
  return tauriListen(channel, handler);
}

let preferenceSubscriberCount = 0;
function subscribePreferences(handler: (payload: any) => void) {
  const unsubscribe = subscribe(C.preferencesOnChanged, handler);
  if (preferenceSubscriberCount === 0) tauriInvoke(C.preferencesSubscribe);
  preferenceSubscriberCount += 1;
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    unsubscribe();
    preferenceSubscriberCount -= 1;
    if (preferenceSubscriberCount === 0) tauriInvoke(C.preferencesUnsubscribe);
  };
}

export const tauriBackend = {
app: {
    info() {
      return tauriInvoke(C.appInfo);
    },
    diagnosticReport() {
      return tauriInvoke(C.appDiagnosticReport);
    },
    saveDiagnosticReport() {
      return tauriInvoke(C.appSaveDiagnosticReport);
    },
    setLocale(locale: string) {
      return tauriInvoke(C.appSetLocale, locale);
    },
    localDirectorySuggestions(partialPath: string, limit?: number) {
      return tauriInvoke(C.appLocalDirectorySuggestions, partialPath, limit);
    },
    directoryState(workspaceId: string, environment: any, path: string) {
      return tauriInvoke(C.appDirectoryState, workspaceId, environment, path);
    },
    createDirectory(workspaceId: string, environment: any, path: string) {
      return tauriInvoke(C.appCreateDirectory, workspaceId, environment, path);
    },
    pickDirectory() {
      return tauriInvoke(C.appPickDirectory);
    },
    pickReference(options?: { target?: 'file' | 'folder' | 'directory' | 'all'; title?: string; path?: string }) {
      return tauriInvoke(C.appPickReference, options);
    },
    quit() {
      return tauriInvoke(C.appQuit);
    },
    hideToTray() {
      return tauriInvoke(C.appHideToTray);
    },
    listIdes() {
      return tauriInvoke(C.appListIdes);
    },
    openInIde(workspaceId: string, ideId: string) {
      return tauriInvoke(C.appOpenInIde, workspaceId, ideId);
    },
    openExternal(url: string) {
      return tauriInvoke(C.appOpenExternal, url);
    },
    openPath(path: string) {
      return tauriInvoke(C.appOpenPath, path);
    },
    showEmojiPanel() {
      return tauriInvoke(C.appShowEmojiPanel);
    },
    // Both are `send`, not `invoke`: the caller is a crash reporter running in a
    // page that may be seconds from death, so it must not await anything and
    // must not create a promise nobody is left alive to reject.
    rendererBooted() {
      tauriInvoke(C.appRendererBooted);
    },
    reportRendererFault(fault: any) {
      tauriInvoke(C.appRendererFault, fault);
    },
    onShutdown(handler: (...args: any[]) => void) {
      return subscribe(C.appShutdown, handler);
    },
    // `send`, not `invoke`: this runs from a paint callback during teardown and
    // must not create a promise nobody will be alive to settle.
    shutdownPainted() {
      tauriInvoke(C.appShutdownPainted);
    }
  },
  windowControls: {
    state() {
      return tauriInvoke(C.windowControlsState);
    },
    minimize() {
      return tauriInvoke(C.windowControlsMinimize);
    },
    toggleMaximize() {
      return tauriInvoke(C.windowControlsToggleMaximize);
    },
    close() {
      return tauriInvoke(C.windowControlsClose);
    },
    onChanged(handler: (payload: any) => void) {
      return subscribe(C.windowControlsOnChanged, handler);
    }
  },
  appState: {
    get() {
      return tauriInvoke(C.appStateGet);
    },
    setOnboardingCompleted(completed: boolean) {
      return tauriInvoke(C.appStateSetOnboardingCompleted, completed);
    },
    setHasSeenFloorOnboarding(seen: boolean) {
      return tauriInvoke(C.appStateSetHasSeenFloorOnboarding, seen);
    }
  },
  canvas: {
    sync(data: any) {
      tauriInvoke('mindagentics:canvas:sync', data);
    },
    onNodePlaced(handler: (payload: any) => void) {
      return subscribe('mindagentics:canvas:nodePlaced', handler);
    },
    onNodeDeleted(handler: (payload: any) => void) {
      return subscribe('mindagentics:canvas:nodeDeleted', handler);
    },
    onCableTieCreated(handler: (payload: any) => void) {
      return subscribe('mindagentics:canvas:cableTieCreated', handler);
    },
    onCableTieDeleted(handler: (payload: any) => void) {
      return subscribe('mindagentics:canvas:cableTieDeleted', handler);
    }
  },
  updates: {
    state() {
      return tauriInvoke(C.updatesState);
    },
    check() {
      return tauriInvoke(C.updatesCheck);
    },
    onProgress(handler: (payload: any) => void) {
      return subscribe(C.updatesOnProgress, handler);
    },
    restartAndInstall() {
      return tauriInvoke(C.updatesRestartAndInstall);
    }
  },
  preferences: {
    get() {
      return tauriInvoke(C.preferencesGet);
    },
    set(patch: any) {
      return tauriInvoke(C.preferencesSet, patch);
    },
    onChanged(handler: (payload: any) => void) {
      return subscribePreferences(handler);
    }
  },
  partitura: {
    list() {
      return tauriInvoke(C.partituraList);
    },
    async save(partitura: any) {
      const result = await tauriInvoke(C.partituraSave, partitura);
      if (!result.ok) return Promise.reject(result.failure);
      return result.partitura;
    },
    delete(id: string) {
      return tauriInvoke(C.partituraDelete, id);
    },
    async exportOne(id: string) {
      const result = await tauriInvoke(C.partituraExportOne, id);
      if (!result.ok) return Promise.reject(result.failure);
      return result.exported;
    },
    async exportAll() {
      const result = await tauriInvoke(C.partituraExportAll);
      if (!result.ok) return Promise.reject(result.failure);
      return result.exported;
    },
    pickFiles() {
      return tauriInvoke(C.partituraPickFiles);
    },
    readFiles(files: Array<File | { path?: string; name?: string }>) {
      const paths = files.map((file) => (file as any)?.path || file?.name || '');
      if (paths.some((path: string) => path === "")) {
        return Promise.resolve({ ok: false, failure: { kind: "unreadableFile" } });
      }
      return tauriInvoke(C.partituraReadFiles, paths);
    },
    readOpenedFiles() {
      return tauriInvoke(C.partituraReadOpenedFiles);
    },
    onChanged(handler: () => void) {
      return subscribeSignal(C.partituraChanged, handler);
    },
    onOpenRequested(handler: () => void) {
      return subscribeSignal(C.partituraOpenRequested, handler);
    }
  },
  workspace: {
    list() {
      return tauriInvoke(C.workspaceList);
    },
    create(input: any) {
      return tauriInvoke(C.workspaceCreate, input);
    },
    patch(id: string, patch: any) {
      return tauriInvoke(C.workspacePatch, id, patch);
    },
    delete(id: string) {
      return tauriInvoke(C.workspaceDelete, id);
    },
    duplicate(id: string) {
      return tauriInvoke(C.workspaceDuplicate, id);
    },
    export(id: string) {
      return tauriInvoke(C.workspaceExport, id);
    },
    prepareImport(file?: File | { path?: string; name?: string }) {
      if (file === void 0) return tauriInvoke(C.workspaceImport);
      const path = (file as any)?.path || file?.name || '';
      if (path === "") return Promise.resolve(null);
      return tauriInvoke(C.workspaceImport, [path]);
    },
    prepareOpenedImport() {
      return tauriInvoke(C.workspaceImportOpened);
    },
    completeImport(sourcePath: string, destination: string) {
      return tauriInvoke(C.workspaceImportComplete, sourcePath, destination);
    },
    onOpenRequested(handler: () => void) {
      return subscribeSignal(C.workspaceOpenRequested, handler);
    },
    unload(id: string, scope: any) {
      return tauriInvoke(C.workspaceUnload, id, scope);
    },
    getActiveId() {
      return tauriInvoke(C.workspaceGetActiveId);
    },
    setFloorStatus(workspaceId: string, floorId: string, status: any) {
      return tauriInvoke(C.workspaceSetFloorStatus, workspaceId, floorId, status);
    },
    reorderFloor(workspaceId: string, floorId: string, topDownIndex: number) {
      return tauriInvoke(C.workspaceReorderFloor, workspaceId, floorId, topDownIndex);
    },
    reveal(id: string) {
      return tauriInvoke(C.workspaceReveal, id);
    },
    switch(id: string) {
      return tauriInvoke(C.workspaceSwitch, id);
    },
    setPreferredIde(id: string, ideId: string) {
      return tauriInvoke(C.workspaceSetPreferredIde, id, ideId);
    },
    onChanged(handler: (payload: any) => void) {
      return subscribe(C.workspaceOnChanged, handler);
    },
    onDeleted(handler: (payload: any) => void) {
      return subscribe(C.workspaceOnDeleted, handler);
    },
    undo(id: string) {
      return tauriInvoke(C.workspaceUndo, id);
    },
    beginUndoGroup() {
      return tauriInvoke(C.workspaceBeginUndoGroup);
    },
    endUndoGroup() {
      return tauriInvoke(C.workspaceEndUndoGroup);
    },
    onLevelsUnloaded(handler: (payload: any) => void) {
      return subscribe(C.workspaceOnLevelsUnloaded, handler);
    },
    redo(id: string) {
      return tauriInvoke(C.workspaceRedo, id);
    },
    configFiles: {
      status(id: string) {
        return tauriInvoke(C.workspaceConfigFilesStatus, id);
      },
      read(id: string, kind: any) {
        return tauriInvoke(C.workspaceConfigFilesRead, id, kind);
      },
      write(id: string, kind: any, text: string) {
        return tauriInvoke(C.workspaceConfigFilesWrite, id, kind, text);
      },
      remove(id: string, kind: any) {
        return tauriInvoke(C.workspaceConfigFilesRemove, id, kind);
      },
      sync(id: string, winner: any, expect: any) {
        return tauriInvoke(C.workspaceConfigFilesSync, id, winner, expect);
      }
    }
  },
  floor: {
    createKind: (workspaceId: string, input: any) => tauriInvoke(C.floorCreateKind, workspaceId, input),
    canCopyIndependently: (workspaceId: string) => tauriInvoke(C.floorCanCopy, workspaceId),
    isolationAvailable() {
      return tauriInvoke(C.floorIsolationAvailable);
    },
    create(workspaceId: string, input: any) {
      return tauriInvoke(C.floorCreate, workspaceId, input);
    },
    reviewSource: (workspaceId: string) => tauriInvoke(C.floorReviewSource, workspaceId),
    reviewNumber: (workspaceId: string, text: string) => tauriInvoke(C.floorReviewNumber, workspaceId, text),
    reviewList: (workspaceId: string, query: string) => tauriInvoke(C.floorReviewList, workspaceId, query),
    reviewFloorName: (workspaceId: string, number: number | string, title: string) => tauriInvoke(C.floorReviewName, workspaceId, number, title),
    createReview: (workspaceId: string, input: any, requestId?: string) => tauriInvoke(C.floorReviewCreate, workspaceId, input, requestId),
    createIsolated(workspaceId: string, input: any, requestId?: string) {
      return tauriInvoke(C.floorCreateIsolated, workspaceId, input, requestId);
    },
    listBranches(workspaceId: string) {
      return tauriInvoke(C.floorListBranches, workspaceId);
    },
    cancelIsolated(requestId: string) {
      return tauriInvoke(C.floorCancelIsolated, requestId);
    },
    onSeedProgress(handler: (payload: any) => void) {
      return subscribe(C.floorSeedProgress, handler);
    },
    rename(workspaceId: string, floorId: string, name: string) {
      return tauriInvoke(C.floorRename, workspaceId, floorId, name);
    },
    switch(workspaceId: string, floorId: string, outgoingCamera?: any, outgoingDock?: any) {
      return tauriInvoke(
        C.floorSwitch,
        workspaceId,
        floorId,
        outgoingCamera,
        outgoingDock
      );
    },
    delete(workspaceId: string, floorId: string, removeBranch?: boolean, options?: any) {
      return tauriInvoke(
        C.floorDelete,
        workspaceId,
        floorId,
        removeBranch === true,
        options ?? null
      );
    },
    removeBranch(workspaceId: string, branch: string, force?: boolean) {
      return tauriInvoke(C.floorRemoveBranch, workspaceId, branch, force);
    },
    landingPreflight(workspaceId: string, floorId: string) {
      return tauriInvoke(C.floorLandingPreflight, workspaceId, floorId);
    },
    landingPreview(workspaceId: string, floorId: string, target: any) {
      return tauriInvoke(C.floorLandingPreview, workspaceId, floorId, target);
    },
    landingFileDiff(workspaceId: string, floorId: string, target: any, path: string, oldPath?: string | null, conflict?: any) {
      return tauriInvoke(
        C.floorLandingFileDiff,
        workspaceId,
        floorId,
        target,
        path,
        oldPath,
        conflict
      );
    },
    land(workspaceId: string, floorId: string, target: any) {
      return tauriInvoke(C.floorLand, workspaceId, floorId, target);
    },
    landingRemoveBranch(workspaceId: string, branch: string, target: any) {
      return tauriInvoke(C.floorLandingRemoveBranch, workspaceId, branch, target);
    },
    onLanding(handler: (payload: any) => void) {
      return subscribe(C.floorOnLanding, handler);
    },
    onRemovingChanged(handler: (payload: any) => void) {
      return subscribe(C.floorOnRemovingChanged, handler);
    },
    removing() {
      return tauriInvoke(C.floorRemoving);
    },
    testLanding(workspaceId: string, floorId: string) {
      return tauriInvoke(C.floorTestLanding, workspaceId, floorId);
    }
  },
  floorSnapshot: {
    capture(workspaceId: string, rect: any, maxWidth?: number) {
      return tauriInvoke(C.floorSnapshotCapture, workspaceId, rect, maxWidth);
    }
  },
  floorHooks: {
    get(workspaceId: string) {
      return tauriInvoke(C.floorHooksGet, workspaceId);
    },
    replace(workspaceId: string, hooks: any) {
      return tauriInvoke(C.floorHooksReplace, workspaceId, hooks);
    },
    run(workspaceId: string, floorId: string, commandId: string) {
      return tauriInvoke(C.floorHooksRun, workspaceId, floorId, commandId);
    },
    stop(commandId: string) {
      return tauriInvoke(C.floorHooksStop, commandId);
    },
    runSection(workspaceId: string, floorId: string, section: any) {
      return tauriInvoke(C.floorHooksRunSection, workspaceId, floorId, section);
    },
    clearResult(commandId: string) {
      return tauriInvoke(C.floorHooksClearResult, commandId);
    },
    clearAllResults(workspaceId: string) {
      return tauriInvoke(C.floorHooksClearAllResults, workspaceId);
    },
    runs() {
      return tauriInvoke(C.floorHooksRuns);
    },
    onRunsChanged(handler: (payload: any) => void) {
      return subscribe(C.floorHooksOnRunsChanged, handler);
    },
    readOutput(commandId: string) {
      return tauriInvoke(C.floorHooksReadOutput, commandId);
    },
    onOutput(handler: (payload: any) => void) {
      return subscribe(C.floorHooksOnOutput, handler);
    },
    write(commandId: string, data: string) {
      return tauriInvoke(C.floorHooksWrite, commandId, data);
    },
    resize(commandId: string, cols: number, rows: number) {
      return tauriInvoke(C.floorHooksResize, commandId, cols, rows);
    }
  },
  node: {
    create(workspaceId: string, node: any) {
      return tauriInvoke(C.nodeCreate, workspaceId, node);
    },
    patch(workspaceId: string, nodeId: string, patch: any) {
      return tauriInvoke(C.nodePatch, workspaceId, nodeId, patch);
    },
    patchFrames(workspaceId: string, patches: any) {
      return tauriInvoke(C.nodePatchFrames, workspaceId, patches);
    },
    delete(workspaceId: string, nodeId: string) {
      return tauriInvoke(C.nodeDelete, workspaceId, nodeId);
    },
    deleteMany(workspaceId: string, nodeIds: string[]) {
      return tauriInvoke(C.nodeDeleteMany, workspaceId, nodeIds);
    },
    unload(workspaceId: string, nodeIds: string[]) {
      return tauriInvoke(C.nodeUnload, workspaceId, nodeIds);
    },
    setNodesRedacted(workspaceId: string, nodeIds: string[], isRedacted: boolean) {
      return tauriInvoke(C.nodeSetRedacted, workspaceId, nodeIds, isRedacted);
    }
  },
  group: {
    create(workspaceId: string, nodeIds: string[]) {
      return tauriInvoke(C.groupCreate, workspaceId, nodeIds);
    },
    ungroup(workspaceId: string, nodeIds: string[]) {
      return tauriInvoke(C.groupUngroup, workspaceId, nodeIds);
    },
    rename(workspaceId: string, groupId: string, name: string) {
      return tauriInvoke(C.groupRename, workspaceId, groupId, name);
    },
    setColor(workspaceId: string, groupId: string, colorHex: string) {
      return tauriInvoke(C.groupSetColor, workspaceId, groupId, colorHex);
    }
  },
  // Fichários. ONE call per operation and ONE undo step each: filing a note is
  // four edits (membership, rope promotion, frame tuck, uniform colour) that mac
  // runs inside a single undoable mutation, so the transaction lives in main
  // rather than as a sequence of `node.patch` calls from the renderer.
  noteStack: {
    /** From loose notes, in canvas reading order. Null when nothing was fileable. */
    create(workspaceId: string, noteNodeIds: string[], name: string, defaultName: string) {
      return tauriInvoke(C.noteStackCreate, workspaceId, noteNodeIds, name, defaultName);
    },
    /** The mixed-selection verb: notes create one, a selected fichário receives, further ones merge in. */
    fileSelection(workspaceId: string, nodeIds: string[], defaultName: string) {
      return tauriInvoke(C.noteStackFileSelection, workspaceId, nodeIds, defaultName);
    },
    addNotes(workspaceId: string, stackNodeId: string, noteNodeIds: string[]) {
      return tauriInvoke(C.noteStackAddNotes, workspaceId, stackNodeId, noteNodeIds);
    },
    /**
     * Inserts a page the caller has already built, so the `.md` naming stays in
     * the note-file layer while the insert, the front flip, the tuck and the
     * uniform stamp remain one undo step. Returns the stored node.
     */
    addPage(workspaceId: string, stackNodeId: string, pageNode: any, afterNoteNodeId?: string) {
      return tauriInvoke(C.noteStackAddPage, workspaceId, stackNodeId, pageNode, afterNoteNodeId);
    },
    /** One page back onto the canvas. Reports whether an unnamed stack dissolved behind it. */
    spill(workspaceId: string, stackNodeId: string, noteNodeId: string, origin: any) {
      return tauriInvoke(C.noteStackSpill, workspaceId, stackNodeId, noteNodeId, origin);
    },
    unstack(workspaceId: string, stackNodeId: string) {
      return tauriInvoke(C.noteStackUnstack, workspaceId, stackNodeId);
    },
    /** The "Keep Notes" branch of the delete prompt: the folder goes, the pages fan out. */
    deleteKeepingNotes(workspaceId: string, stackNodeId: string) {
      return tauriInvoke(C.noteStackDeleteKeepingNotes, workspaceId, stackNodeId);
    },
    moveMember(workspaceId: string, stackNodeId: string, fromIndex: number, toIndex: number) {
      return tauriInvoke(C.noteStackMoveMember, workspaceId, stackNodeId, fromIndex, toIndex);
    },
    setFront(workspaceId: string, stackNodeId: string, noteNodeId: string) {
      return tauriInvoke(C.noteStackSetFront, workspaceId, stackNodeId, noteNodeId);
    },
    rename(workspaceId: string, stackNodeId: string, name: string) {
      return tauriInvoke(C.noteStackRename, workspaceId, stackNodeId, name);
    },
    clearCustomName(workspaceId: string, stackNodeId: string) {
      return tauriInvoke(C.noteStackClearCustomName, workspaceId, stackNodeId);
    },
    /** The drop-to-file commit. The note never moves to the release point. */
    fileDroppedNote(workspaceId: string, noteNodeId: string, stackNodeId: string) {
      return tauriInvoke(C.noteStackFileDroppedNote, workspaceId, noteNodeId, stackNodeId);
    },
    /** Lane to lane, without touching the canvas in between. Does not inherit the source's ropes. */
    moveBetween(workspaceId: string, fromStackNodeId: string, toStackNodeId: string, noteNodeId: string) {
      return tauriInvoke(
        C.noteStackMoveBetween,
        workspaceId,
        fromStackNodeId,
        toStackNodeId,
        noteNodeId
      );
    },
    toggleUniformColor(workspaceId: string, stackNodeId: string) {
      return tauriInvoke(C.noteStackToggleUniformColor, workspaceId, stackNodeId);
    },
    /**
     * THE single write path for a note's colour. A note inside a Uniform Color
     * fichário retunes the whole stack in the same undo step, so every colour
     * control routes here rather than through `node.patch`.
     */
    setNoteColor(workspaceId: string, noteNodeId: string, color: any, customColor?: string) {
      return tauriInvoke(C.noteStackSetNoteColor, workspaceId, noteNodeId, color, customColor);
    },
    setEngaged(nodeIds: string[]) {
      tauriInvoke(C.noteStackSetEngaged, nodeIds);
    }
  },
  band: {
    create(workspaceId: string, nodeIds: string[], name: string, defaultName: string, focusedNodeId?: string) {
      return tauriInvoke(C.bandCreate, workspaceId, nodeIds, name, defaultName, focusedNodeId);
    },
    addTerminals(workspaceId: string, bandNodeId: string, memberNodeIds: string[], focusedNodeId?: string) {
      return tauriInvoke(C.bandAddTerminals, workspaceId, bandNodeId, memberNodeIds, focusedNodeId);
    },
    removeMember(workspaceId: string, bandNodeId: string, memberNodeId: string, origin: any) {
      return tauriInvoke(C.bandRemoveMember, workspaceId, bandNodeId, memberNodeId, origin);
    },
    moveMemberBetween(workspaceId: string, fromBandNodeId: string, toBandNodeId: string, memberNodeId: string) {
      return tauriInvoke(C.bandMoveMemberBetween, workspaceId, fromBandNodeId, toBandNodeId, memberNodeId);
    },
    dissolve(workspaceId: string, bandNodeId: string) {
      return tauriInvoke(C.bandDissolve, workspaceId, bandNodeId);
    },
    moveMember(workspaceId: string, bandNodeId: string, memberNodeId: string, move: any) {
      return tauriInvoke(C.bandMoveMember, workspaceId, bandNodeId, memberNodeId, move);
    },
    setOrder(workspaceId: string, bandNodeId: string, memberNodeIds: string[]) {
      return tauriInvoke(C.bandSetOrder, workspaceId, bandNodeId, memberNodeIds);
    },
    select(workspaceId: string, bandNodeId: string, memberNodeId: string) {
      return tauriInvoke(C.bandSelect, workspaceId, bandNodeId, memberNodeId);
    },
    update(workspaceId: string, bandNodeId: string, patch: any, recordsUndo?: boolean) {
      return tauriInvoke(C.bandUpdate, workspaceId, bandNodeId, patch, recordsUndo);
    },
    rename(workspaceId: string, bandNodeId: string, name: string) {
      return tauriInvoke(C.bandRename, workspaceId, bandNodeId, name);
    },
    setSidebarWidth(workspaceId: string, bandNodeId: string, width: number) {
      return tauriInvoke(C.bandSetSidebarWidth, workspaceId, bandNodeId, width);
    },
    addNewMember(workspaceId: string, bandNodeId: string, node: any) {
      return tauriInvoke(C.bandAddNewMember, workspaceId, bandNodeId, node);
    },
    onAsksInFlight(handler: (payload: any) => void) {
      return subscribe(C.bandAsksInFlight, handler);
    }
  },
  agent: {
    assignRole(terminalId: string, roleId: string) {
      return tauriInvoke(C.agentAssignRole, terminalId, roleId);
    },
    listWslDistros() {
      return tauriInvoke(C.agentListWslDistros);
    },
    listShells() {
      return tauriInvoke(C.agentListShells);
    },
    locateLocalTmux() {
      return tauriInvoke(C.agentLocateLocalTmux);
    },
    discoverRoles(input: any) {
      return tauriInvoke(C.agentDiscoverRoles, input);
    },
    validateWslDirectory(distro: string, path: string, user?: string) {
      return tauriInvoke(C.agentValidateWslDirectory, distro, path, user);
    },
    directorySuggestions(workspaceId: string, connection: any, partialPath: string, limit?: number) {
      return tauriInvoke(C.agentDirectorySuggestions, workspaceId, connection, partialPath, limit);
    },
    listDockerContainers(workspaceId: string, context: any) {
      return tauriInvoke(C.agentListDockerContainers, workspaceId, context);
    },
    testDockerConnection(workspaceId: string, config: any) {
      return tauriInvoke(C.agentTestDockerConnection, workspaceId, config);
    },
    listSandboxes(workspaceId: string, workspacePath: string) {
      return tauriInvoke(C.agentListSandboxes, workspaceId, workspacePath);
    },
    listSandboxAgents(workspaceId: string) {
      return tauriInvoke(C.agentListSandboxAgents, workspaceId);
    },
    createSandbox(workspaceId: string, request: any) {
      return tauriInvoke(C.agentCreateSandbox, workspaceId, request);
    },
    testSandboxConnection(workspaceId: string, config: any) {
      return tauriInvoke(C.agentTestSandboxConnection, workspaceId, config);
    }
  },
  drawing: {
    recognize(workspaceId: string, points: any) {
      return tauriInvoke(C.drawingRecognize, workspaceId, points);
    },
    create(workspaceId: string, drawing: any) {
      return tauriInvoke(C.drawingCreate, workspaceId, drawing);
    },
    patch(workspaceId: string, drawingId: string, patch: any) {
      return tauriInvoke(C.drawingPatch, workspaceId, drawingId, patch);
    },
    delete(workspaceId: string, drawingId: string) {
      return tauriInvoke(C.drawingDelete, workspaceId, drawingId);
    },
    group(workspaceId: string, drawingIds: string[]) {
      return tauriInvoke(C.drawingGroup, workspaceId, drawingIds);
    },
    ungroup(workspaceId: string, drawingIds: string[]) {
      return tauriInvoke(C.drawingUngroup, workspaceId, drawingIds);
    }
  },
  terminal: {
    detectAgents() {
      return tauriInvoke('mindagentics:terminal:detectAgents');
    },
    getAgentLimits() {
      return tauriInvoke('mindagentics:terminal:getAgentLimits');
    },
    getAgentModels(presetId: string) {
      return tauriInvoke('mindagentics:terminal:getAgentModels', presetId);
    },
    setOrchestratorMode(terminalId: string, orchestratorMode: boolean) {
      return tauriInvoke('mindagentics:terminal:setOrchestratorMode', terminalId, orchestratorMode);
    },
    setMaestroMode(terminalId: string, maestroMode: boolean) {
      return tauriInvoke('mindagentics:terminal:setMaestroMode', terminalId, maestroMode);
    },
    spawn(input: any) {
      return tauriInvoke(C.terminalSpawn, input);
    },
    write(terminalId: string, data: string | Uint8Array) {
      tauriInvoke(C.terminalWrite, terminalId, data);
      return Promise.resolve();
    },
    deliverPrompt(terminalId: string, text: string) {
      return tauriInvoke(C.terminalDeliverPrompt, terminalId, text);
    },
    dims(terminalId: string) {
      return tauriInvoke(C.terminalDims, terminalId);
    },
    resize(terminalId: string, cols: number, rows: number, options?: any) {
      return tauriInvoke(C.terminalResize, terminalId, cols, rows, options);
    },
    resolvePath(query: string) {
      return tauriInvoke(C.terminalResolvePath, query);
    },
    kill(terminalId: string) {
      return tauriInvoke(C.terminalKill, terminalId);
    },
    restart(terminalId: string) {
      return tauriInvoke(C.terminalRestart, terminalId);
    },
    reconfigure(arg1: any, arg2?: any) {
      return tauriInvoke(C.terminalReconfigure, arg1, arg2);
    },
    attach(terminalId: string) {
      return tauriInvoke(C.terminalAttach, terminalId);
    },
    getScrollback(terminalId: string) {
      return tauriInvoke(C.terminalGetScrollback, terminalId);
    },
    markSeen(terminalId: string) {
      tauriInvoke(C.terminalMarkSeen, terminalId);
    },
    discardResume(workspaceId: string, nodeId: string) {
      return tauriInvoke(C.terminalDiscardResume, workspaceId, nodeId);
    },
    setFocused(terminalId: string) {
      tauriInvoke(C.terminalSetFocused, terminalId);
    },
    onData(handler: (terminalId: string, data: string | Uint8Array) => void) {
      return subscribe(C.terminalOnData, handler);
    },
    onExit(handler: (terminalId: string, code: number) => void) {
      return subscribe(C.terminalOnExit, handler);
    },
    onStatus(handler: (terminalId: string, status: any) => void) {
      return subscribe(C.terminalOnStatus, handler);
    },
    onActivity(handler: (terminalId: string, activity: any) => void) {
      return subscribe(C.terminalActivity, handler);
    },
    memory() {
      return tauriInvoke(C.terminalMemory);
    },
    onMemory(handler: (payload: any) => void) {
      return subscribe(C.terminalOnMemory, handler);
    },
    processList(terminalId: string) {
      return tauriInvoke(C.terminalProcessList, terminalId);
    },
    stopProcess(terminalId: string, pid: number, startTime?: number) {
      return tauriInvoke(C.terminalProcessStop, terminalId, pid, startTime);
    },
    tmuxSession(terminalId: string) {
      return tauriInvoke(C.terminalTmuxSession, terminalId);
    },
    endTmuxSession(terminalId: string) {
      return tauriInvoke(C.terminalEndTmuxSession, terminalId);
    },
    remoteSessionProcesses(terminalId: string) {
      return tauriInvoke(C.terminalRemoteSessionProcesses, terminalId);
    },
    stopRemoteSessionProcess(terminalId: string, pid: number) {
      return tauriInvoke(C.terminalStopRemoteSessionProcess, terminalId, pid);
    },
    roleInstallFailures() {
      return tauriInvoke(C.terminalRoleInstallFailures);
    },
    onRoleInstallFailures(handler: (payload: any) => void) {
      return subscribe(C.terminalOnRoleInstallFailures, handler);
    },
    onFocusRequested(handler: (payload: any) => void) {
      return subscribe(C.terminalFocusRequested, handler);
    },
    onGeometryPinned(handler: (payload: any) => void) {
      return subscribe(C.terminalOnGeometryPinned, handler);
    },
    publishLiveColors(terminals: any) {
      return tauriInvoke(C.terminalPublishLiveColors, terminals);
    }
  },
  note: {
    read(workspaceId: string, nodeId: string) {
      return tauriInvoke(C.noteRead, workspaceId, nodeId);
    },
    write(workspaceId: string, nodeId: string, text: string) {
      return tauriInvoke(C.noteWrite, workspaceId, nodeId, text);
    },
    edit(workspaceId: string, nodeId: string, oldText: string, newText: string) {
      return tauriInvoke(C.noteEdit, workspaceId, nodeId, oldText, newText);
    },
    rename(workspaceId: string, nodeId: string, newFileName: string) {
      return tauriInvoke(C.noteRename, workspaceId, nodeId, newFileName);
    },
    reveal(workspaceId: string, nodeId: string) {
      return tauriInvoke(C.noteReveal, workspaceId, nodeId);
    },
    moveToExternal(workspaceId: string, nodeId: string) {
      return tauriInvoke(C.noteMoveToExternal, workspaceId, nodeId);
    },
    moveToManaged(workspaceId: string, nodeId: string) {
      return tauriInvoke(C.noteMoveToManaged, workspaceId, nodeId);
    },
    createFromFile(workspaceId: string, node: any, sourcePath: string) {
      return tauriInvoke(C.noteCreateFromFile, workspaceId, node, sourcePath);
    },
    createFromRemoteFile(workspaceId: string, node: any, connection: any, path: string, floorId?: string) {
      return tauriInvoke(
        C.noteCreateFromRemoteFile,
        workspaceId,
        node,
        connection,
        path,
        floorId
      );
    },
    refreshFromRemoteFile(workspaceId: string, nodeId: string) {
      return tauriInvoke(C.noteRefreshFromRemoteFile, workspaceId, nodeId);
    },
    onChange(handler: (payload: any) => void) {
      return subscribe(C.noteOnChange, handler);
    },
    attachImage(workspaceId: string, image: { dataBase64: string; ext: string }) {
      return tauriInvoke(C.noteAttachImage, workspaceId, image.dataBase64, image.ext);
    },
    notesDir(workspaceId: string) {
      return tauriInvoke(C.noteNotesDir, workspaceId);
    },
    mediaDir(workspaceId: string) {
      return tauriInvoke(C.noteMediaDir, workspaceId);
    }
  },
  fileTree: {
    list(nodeId: string, directoryPath: string) {
      return tauriInvoke(C.fileTreeList, nodeId, directoryPath);
    },
    watch(nodeId: string, directoryPath: string) {
      return tauriInvoke(C.fileTreeWatch, nodeId, directoryPath);
    },
    unwatch(nodeId: string) {
      return tauriInvoke(C.fileTreeUnwatch, nodeId);
    },
    attachCheckout(path: string) {
      return tauriInvoke(C.fileTreeAttachCheckout, path);
    },
    onDidChange(handler: (payload: any) => void) {
      return subscribe(C.fileTreeOnDidChange, handler);
    },
    reveal(nodeId: string) {
      return tauriInvoke(C.fileTreeReveal, nodeId);
    },
    gitState(nodeId: string) {
      return tauriInvoke(C.fileTreeGitState, nodeId);
    },
    gitAction(nodeId: string, action: any) {
      return tauriInvoke(C.fileTreeGitAction, nodeId, action);
    },
    gitChanges(nodeId: string) {
      return tauriInvoke(C.fileTreeGitChanges, nodeId);
    },
    gitCancel(nodeId: string) {
      return tauriInvoke(C.fileTreeGitCancel, nodeId);
    },
    gitIndexLock(nodeId: string) {
      return tauriInvoke(C.fileTreeGitIndexLock, nodeId);
    },
    searchContents(nodeId: string, query: string, showHidden?: boolean) {
      return tauriInvoke(C.fileTreeSearchContents, nodeId, query, showHidden);
    },
    searchFilenames(nodeId: string) {
      return tauriInvoke(C.fileTreeSearchFilenames, nodeId);
    },
    cancelSearch(nodeId: string) {
      return tauriInvoke(C.fileTreeCancelSearch, nodeId);
    },
    onSearchResults(handler: (payload: any) => void) {
      return subscribe(C.fileTreeOnSearchResults, handler);
    },
    gitDiffFiles(nodeId: string, scope: any) {
      return tauriInvoke(C.fileTreeGitDiffFiles, nodeId, scope);
    },
    gitFileDiff(nodeId: string, scope: any, path: string, oldPath?: string | null) {
      return tauriInvoke(C.fileTreeGitFileDiff, nodeId, scope, path, oldPath ?? null);
    },
    gitHistory(nodeId: string, limit?: number) {
      return tauriInvoke(C.fileTreeGitHistory, nodeId, limit);
    },
    gitCommitBody(nodeId: string, hash: string) {
      return tauriInvoke(C.fileTreeGitCommitBody, nodeId, hash);
    },
    gitBranches(nodeId: string) {
      return tauriInvoke(C.fileTreeGitBranches, nodeId);
    },
    gitStashes(nodeId: string) {
      return tauriInvoke(C.fileTreeGitStashes, nodeId);
    },
    gitMergePreview(nodeId: string, source: string, target: string) {
      return tauriInvoke(C.fileTreeGitMergePreview, nodeId, source, target);
    },
    readFile(nodeId: string, path: string) {
      return tauriInvoke(C.fileTreeReadFile, nodeId, path);
    },
    writeFile(nodeId: string, path: string, text: string) {
      return tauriInvoke(C.fileTreeWriteFile, nodeId, path, text);
    },
    probeMedia(nodeId: string, path: string) {
      return tauriInvoke(C.fileTreeProbeMedia, nodeId, path);
    },
    onFileChanged(handler: (payload: any) => void) {
      return subscribe(C.fileTreeOnFileChanged, handler);
    },
    copyPath(nodeId: string, path: string) {
      return tauriInvoke(C.fileTreeCopyPath, nodeId, path);
    },
    revealFile(nodeId: string, path: string) {
      return tauriInvoke(C.fileTreeRevealFile, nodeId, path);
    },
    onGitActionProgress(handler: (payload: any) => void) {
      return subscribe(C.fileTreeOnGitActionProgress, handler);
    },
    onGitState(handler: (payload: any) => void) {
      return subscribe(C.fileTreeOnGitState, handler);
    },
    watchState(nodeId: string) {
      return tauriInvoke(C.fileTreeWatchState, nodeId);
    },
    retryWatch(nodeId: string) {
      return tauriInvoke(C.fileTreeRetryWatch, nodeId);
    },
    onWatchState(handler: (payload: any) => void) {
      return subscribe(
        C.fileTreeOnWatchState,
        handler
      );
    },
    fileOperation(nodeId: string, operation: any) {
      return tauriInvoke(C.fileTreeFileOperation, nodeId, operation);
    },
    fileClipboard() {
      return tauriInvoke(C.fileTreeFileClipboard);
    }
  },
  files: {
    storeAttachment(workspaceId: string, input: any) {
      return tauriInvoke(C.filesStoreAttachment, workspaceId, input);
    },
    openAttachment(workspaceId: string, nodeId: string) {
      return tauriInvoke(C.filesOpenAttachment, workspaceId, nodeId);
    },
    revealAttachment(workspaceId: string, nodeId: string) {
      return tauriInvoke(C.filesRevealAttachment, workspaceId, nodeId);
    },
    revealPath(path: string) {
      return tauriInvoke(C.filesRevealPath, path);
    },
    linkPaths(paths: string[]) {
      return tauriInvoke(C.filesLinkPaths, paths);
    },
    resolveLocalPath(path: string, bases?: string[]) {
      return tauriInvoke(C.filesResolveLocalPath, path, bases);
    },
    stagePastedImage(dataBase64: string, ext: string) {
      return tauriInvoke(C.filesStagePastedImage, dataBase64, ext);
    },
    clipboardFilePaths() {
      return tauriInvoke(C.filesClipboardFilePaths);
    }
  },
  clipboard: {
    // Plain `invoke`: this answers a boolean, and a copy the user just clicked
    // must not reject mid-gesture.
    writeImage(png: any) {
      return tauriInvoke(C.clipboardWriteImage, png);
    }
  },
  connection: {
    createTerminalConnection(workspaceId: string, terminalIdA: string, terminalIdB: string, fromWorkspaceId?: string) {
      return tauriInvoke(
        C.connectionCreateTerminal,
        workspaceId,
        terminalIdA,
        terminalIdB,
        fromWorkspaceId
      );
    },
    createNoteConnection(workspaceId: string, terminalId: string, noteNodeId: string) {
      return tauriInvoke(C.connectionCreateNote, workspaceId, terminalId, noteNodeId);
    },
    turnFileIntoNote(workspaceId: string, sourceNodeId: string, fileNodeId: string) {
      return tauriInvoke(C.connectionTurnFileIntoNote, workspaceId, sourceNodeId, fileNodeId);
    },
    createNoteToNoteConnection(workspaceId: string, noteNodeIdA: string, noteNodeIdB: string) {
      return tauriInvoke(
        C.connectionCreateNoteToNote,
        workspaceId,
        noteNodeIdA,
        noteNodeIdB
      );
    },
    createPortalConnection(workspaceId: string, terminalId: string, portalNodeId: string) {
      return tauriInvoke(C.connectionCreatePortal, workspaceId, terminalId, portalNodeId);
    },
    createPortalToPortalConnection(workspaceId: string, portalNodeIdA: string, portalNodeIdB: string) {
      return tauriInvoke(
        C.connectionCreatePortalToPortal,
        workspaceId,
        portalNodeIdA,
        portalNodeIdB
      );
    },
    createCrossFloorConnection(workspaceId: string, sourceTerminalId: string, targetTerminalId: string) {
      return tauriInvoke(
        C.connectionCreateCrossFloor,
        workspaceId,
        sourceTerminalId,
        targetTerminalId
      );
    },
    connectNodes(workspaceId: string, fromNodeId: string, toNodeId: string, fromWorkspaceId?: string) {
      return tauriInvoke(C.connectionConnectNodes, workspaceId, fromNodeId, toNodeId, fromWorkspaceId);
    },
    updateRopePoints(workspaceId: string, connectionId: string, ropePoints: any) {
      return tauriInvoke(C.connectionUpdateRopePoints, workspaceId, connectionId, ropePoints);
    },
    updateRopePointsMany(workspaceId: string, snapshot: any) {
      return tauriInvoke(C.connectionUpdateRopePointsMany, workspaceId, snapshot);
    },
    delete(workspaceId: string, connectionId: string) {
      return tauriInvoke(C.connectionDelete, workspaceId, connectionId);
    },
    deleteMany(workspaceId: string, connectionIds: string[]) {
      return tauriInvoke(C.connectionDeleteMany, workspaceId, connectionIds);
    },
    disconnectNodes(workspaceId: string, fromNodeId: string, toNodeId: string) {
      return tauriInvoke(C.connectionDisconnectNodes, workspaceId, fromNodeId, toNodeId);
    },
    removeAllFor(workspaceId: string, nodeId: string) {
      return tauriInvoke(C.connectionRemoveAllFor, workspaceId, nodeId);
    },
    onTransferActive(handler: (payload: any) => void) {
      return subscribe(C.connectionTransferActive, handler);
    }
  },
  cableTie: {
    create(workspaceId: string, tie: any) {
      return tauriInvoke(C.cableTieCreate, workspaceId, tie);
    },
    move(workspaceId: string, tieId: string, position: any) {
      return tauriInvoke(C.cableTieMove, workspaceId, tieId, position);
    },
    delete(workspaceId: string, tieId: string) {
      return tauriInvoke(C.cableTieDelete, workspaceId, tieId);
    },
    prune(workspaceId: string) {
      return tauriInvoke(C.cableTiePrune, workspaceId);
    }
  },
  portal: {
    register(portalId: string, webContentsId: number) {
      return tauriInvoke(C.portalRegister, portalId, webContentsId);
    },
    unregister(portalId: string) {
      return tauriInvoke(C.portalUnregister, portalId);
    },
    resolveSource(path: string) {
      return tauriInvoke(C.portalResolveSource, path);
    },
    directoryIndex(directory: string) {
      return tauriInvoke(C.portalDirectoryIndex, directory);
    },
    watchFile(portalId: string, file: string) {
      return tauriInvoke(C.portalWatchFile, portalId, file);
    },
    unwatchFile(portalId: string) {
      return tauriInvoke(C.portalUnwatchFile, portalId);
    },
    onFileChanged(handler: (payload: any) => void) {
      return subscribe(C.portalFileChanged, handler);
    },
    onWakeRequested(handler: (payload: any) => void) {
      return subscribe(C.portalWake, handler);
    }
  },
  // A key crosses addApiKey and replaceKey; nothing here logs an argument.
  accounts: {
    view() {
      return tauriInvoke(C.accountsView);
    },
    add(name: string, cli: string, connection: any, host?: string) {
      return tauriInvoke(C.accountsAdd, name, cli, connection, host);
    },
    addApiKey(name: string, cli: string, key: string, endpoint: string, connection: any) {
      return tauriInvoke(C.accountsAddApiKey, name, cli, key, endpoint, connection);
    },
    replaceKey(accountId: string, key: string) {
      return tauriInvoke(C.accountsReplaceKey, accountId, key);
    },
    setEndpoint(accountId: string, endpoint: string) {
      return tauriInvoke(C.accountsSetEndpoint, accountId, endpoint);
    },
    signOut(accountId: string) {
      return tauriInvoke(C.accountsSignOut, accountId);
    },
    rename(accountId: string, cli: string, name: string) {
      return tauriInvoke(C.accountsRename, accountId, cli, name);
    },
    remove(accountId: string) {
      return tauriInvoke(C.accountsRemove, accountId);
    },
    moveTerminalsToDefault(accountId: string) {
      return tauriInvoke(C.accountsMoveToDefault, accountId);
    },
    watchSignIn(accountId: string, terminalId: string) {
      return tauriInvoke(C.accountsWatchSignIn, accountId, terminalId);
    },
    watchSignOut(accountId: string, terminalId: string) {
      return tauriInvoke(C.accountsWatchSignOut, accountId, terminalId);
    },
    refresh() {
      return tauriInvoke(C.accountsRefresh);
    },
    refreshPlace(connection: any) {
      return tauriInvoke(C.accountsRefreshPlace, connection);
    },
    signOutAll() {
      return tauriInvoke(C.accountsSignOutAll);
    },
    keepsSessionAlive(terminalId: string) {
      return tauriInvoke(C.accountsKeepsSessionAlive, terminalId);
    },
    setTerminalAccount(workspaceId: string, terminalId: string, accountId: string, restartNow?: boolean) {
      return tauriInvoke(C.accountsSetTerminal, workspaceId, terminalId, accountId, restartNow);
    },
    describe(request: any) {
      return tauriInvoke(C.accountsDescribe, request);
    },
    onChanged(handler: (payload: any) => void) {
      return subscribe(C.accountsOnChanged, handler);
    },
    onSignedIn(handler: (payload: any) => void) {
      return subscribe(C.accountsOnSignedIn, handler);
    },
    providers() {
      return tauriInvoke(C.accountsProviders);
    },
    setProvidersViewer(viewerId: string, isShowing: boolean) {
      tauriInvoke(C.accountsSetProvidersViewer, viewerId, isShowing);
    },
    onProvidersChanged(handler: (payload: any) => void) {
      return subscribe(C.accountsOnProvidersChanged, handler);
    },
    approveProvider(providerId: string, digest: string) {
      return tauriInvoke(C.accountsApproveProvider, providerId, digest);
    },
    restoreBuiltInProviders() {
      return tauriInvoke(C.accountsRestoreBuiltInProviders);
    },
    restoreProvider(providerId: string, expectedDigest: string) {
      return tauriInvoke(C.accountsRestoreProvider, providerId, expectedDigest);
    },
    revealProvidersFolder() {
      return tauriInvoke(C.accountsRevealProvidersFolder);
    },
    revealProviderFile(providerId: string) {
      return tauriInvoke(C.accountsRevealProviderFile, providerId);
    }
  },
  // Portal Design. Plain `invoke` on all four: this surface answers null for
  // every unhappy path — dead daemon, hidden guest, malformed reply — and the
  // renderer degrades to the plain padded crop rather than handling a rejection
  // mid-gesture.
  portalDesign: {
    capture(portalId: string) {
      return tauriInvoke(C.portalDesignCapture, portalId);
    },
    resolveScript(workspaceId: string, stroke: any, imageSize: any) {
      return tauriInvoke(C.portalDesignResolveScript, workspaceId, stroke, imageSize);
    },
    region(workspaceId: string, strokeBounds: any, candidates: any, displaySize: any) {
      return tauriInvoke(
        C.portalDesignRegion,
        workspaceId,
        strokeBounds,
        candidates,
        displaySize
      );
    },
    pick(workspaceId: string, point: any, candidates: any) {
      return tauriInvoke(C.portalDesignPick, workspaceId, point, candidates);
    }
  },
  device: {
    contract(workspaceId: string) {
      return tauriInvoke(C.deviceContract, workspaceId);
    },
    discover(workspaceId: string) {
      return tauriInvoke(C.deviceDiscover, workspaceId);
    },
    automation(request: any) {
      return tauriInvoke(C.deviceAutomation, request);
    },
    onFrameCaptureRequested(handler: (payload: any) => void) {
      return subscribe(C.deviceFrameCaptureRequest, handler);
    },
    completeFrameCapture(requestId: string, result: any) {
      return tauriInvoke(C.deviceFrameCaptureResult, requestId, result);
    },
    publishSessions(sessions: any) {
      return tauriInvoke(C.deviceSessionsPublish, sessions);
    }
  },
  interAgent: {
    listPeers(terminalId: string) {
      return tauriInvoke(C.interAgentListPeers, terminalId);
    }
  },
  sidebarLayout: {
    get() {
      return tauriInvoke(C.sidebarLayoutGet);
    },
    set(layout: any) {
      return tauriInvoke(C.sidebarLayoutSet, layout);
    },
    onChanged(handler: (payload: any) => void) {
      return subscribe(C.sidebarLayoutOnChanged, handler);
    }
  },
  data: {
    storageLocation() {
      return tauriInvoke(C.dataStorageLocation);
    },
    revealStorageLocation() {
      return tauriInvoke(C.dataRevealStorageLocation);
    },
    revealBackupsLocation() {
      return tauriInvoke(C.dataRevealBackupsLocation);
    },
    moveStorage() {
      return tauriInvoke(C.dataMoveStorage);
    },
    usage() {
      return tauriInvoke(C.dataUsage);
    },
    deleteAll() {
      return tauriInvoke(C.dataDeleteAll);
    },
    listBackups() {
      return tauriInvoke(C.dataListBackups);
    },
    lastBackupAt() {
      return tauriInvoke(C.dataLastBackupAt);
    },
    lastSaveAt() {
      return tauriInvoke(C.dataLastSaveAt);
    },
    backupNow() {
      return tauriInvoke(C.dataBackupNow);
    },
    deleteBackup(path: string) {
      return tauriInvoke(C.dataDeleteBackup, path);
    },
    exportBackup() {
      return tauriInvoke(C.dataExportBackup);
    },
    pickBackupToImport() {
      return tauriInvoke(C.dataPickBackupToImport);
    },
    importBackup(path: string, kind: any) {
      return tauriInvoke(C.dataImportBackup, path, kind);
    },
    clearGlobalPortalStorage() {
      return tauriInvoke(C.dataClearGlobalPortalStorage);
    },
    onStoreReloaded(handler: (payload: any) => void) {
      return subscribe(C.dataOnStoreReloaded, handler);
    }
  },
  palette: {
    rank(workspaceId: string, query: string, candidates: any[]) {
      return tauriInvoke(C.paletteRank, workspaceId, query, candidates);
    }
  },
  prompter: {
    serialize(workspaceId: string, segments: any[]) {
      return tauriInvoke(C.prompterSerialize, workspaceId, segments);
    },
    deliver(terminalId: string, prompt: string, segments: any[]) {
      return tauriInvoke(C.prompterDeliver, terminalId, prompt, segments);
    },
    materialize(terminalId: string, prompt: string, segments: any[], files: any[]) {
      return tauriInvoke(C.prompterMaterialize, terminalId, prompt, segments, files);
    },
    mentionTargets(terminalId: string) {
      return tauriInvoke(C.prompterMentionTargets, terminalId);
    },
    fileIndex(terminalId: string) {
      return tauriInvoke(C.prompterFileIndex, terminalId);
    },
    cancelFileIndex(terminalId: string) {
      return tauriInvoke(C.prompterCancelFileIndex, terminalId);
    },
    fileIcon(path: string) {
      return tauriInvoke(C.prompterFileIcon, path);
    }
  },
  agentUsage: {
    getState() {
      return tauriInvoke(C.agentUsageGetState);
    },
    refresh(providerID: string) {
      return tauriInvoke(C.agentUsageRefresh, providerID);
    },
    refreshAll() {
      return tauriInvoke(C.agentUsageRefreshAll);
    },
    restoreDefaults(targets: any) {
      return tauriInvoke(C.agentUsageRestoreDefaults, targets);
    },
    revealProvidersFolder() {
      return tauriInvoke(C.agentUsageRevealProvidersFolder);
    },
    setViewer(viewerId: string, isShowing: boolean) {
      tauriInvoke(C.agentUsageSetViewer, viewerId, isShowing);
    },
    onStateChanged(listener: (payload: any) => void) {
      return subscribe(C.agentUsageOnStateChanged, listener);
    }
  },
  gitHosts: {
    configure() {
      return tauriInvoke(C.gitHostsConfigure);
    },
    restoreDefault(id: string, expectedDigest: string) {
      return tauriInvoke(C.gitHostsRestoreDefault, id, expectedDigest);
    },
    restoreMissingDefaults() {
      return tauriInvoke(C.gitHostsRestoreMissingDefaults);
    },
    checkAccount(providerId: string) {
      return tauriInvoke(C.gitHostsCheckAccount, providerId);
    },
    revealProvidersFolder() {
      return tauriInvoke(C.gitHostsRevealProvidersFolder);
    }
  },
  pullRequests: {
    imagePrefix: (workspaceId: string, floorId: string) => tauriInvoke(C.pullRequestsImagePrefix, workspaceId, floorId),
    keepImage: (workspaceId: string, floorId: string, dataBase64: string, format: string) => tauriInvoke(C.pullRequestsKeepImage, workspaceId, floorId, dataBase64, format),
    imagesExist: (workspaceId: string, floorId: string) => tauriInvoke(C.pullRequestsImagesExist, workspaceId, floorId),
    showImages: (workspaceId: string, floorId: string) => tauriInvoke(C.pullRequestsShowImages, workspaceId, floorId),
    closeImages: (workspaceId: string, floorId: string) => tauriInvoke(C.pullRequestsCloseImages, workspaceId, floorId),
    imagesDismissed: (workspaceId: string, floorId: string, recordId: string) => tauriInvoke(C.pullRequestsImagesDismissed, workspaceId, floorId, recordId),
    getState() {
      return tauriInvoke(C.pullRequestsGetState);
    },
    onStateChanged(listener: (payload: any) => void) {
      return subscribe(C.pullRequestsOnStateChanged, listener);
    },
    onOpenSheet(listener: (payload: any) => void) {
      return subscribe(C.pullRequestsOnOpenSheet, listener);
    },
    setPresented(floor: any) {
      tauriInvoke(C.pullRequestsSetPresented, floor);
    },
    prepare(workspaceId: string, floorId: string, base?: string) {
      return tauriInvoke(C.pullRequestsPrepare, workspaceId, floorId, base);
    },
    account(workspaceId: string, floorId: string, base?: string) {
      return tauriInvoke(C.pullRequestsAccount, workspaceId, floorId, base);
    },
    checkoutIsRemote(workspaceId: string, floorId: string) {
      return tauriInvoke(C.pullRequestsCheckoutIsRemote, workspaceId, floorId);
    },
    lookForExisting(workspaceId: string, floorId: string) {
      return tauriInvoke(C.pullRequestsLookForExisting, workspaceId, floorId);
    },
    open(workspaceId: string, floorId: string, request: any) {
      return tauriInvoke(C.pullRequestsOpen, workspaceId, floorId, request);
    },
    openOnWebsite(workspaceId: string, floorId: string, request: any) {
      return tauriInvoke(C.pullRequestsOpenOnWebsite, workspaceId, floorId, request);
    },
    check(workspaceId: string, floorId: string) {
      return tauriInvoke(C.pullRequestsCheck, workspaceId, floorId);
    },
    markSeen(workspaceId: string, floorId: string) {
      return tauriInvoke(C.pullRequestsMarkSeen, workspaceId, floorId);
    },
    push(workspaceId: string, floorId: string, recordId: string) {
      return tauriInvoke(C.pullRequestsPush, workspaceId, floorId, recordId);
    },
    merge(workspaceId: string, floorId: string, recordId: string, method: any) {
      return tauriInvoke(C.pullRequestsMerge, workspaceId, floorId, recordId, method);
    },
    forget(workspaceId: string, floorId: string, recordId: string) {
      return tauriInvoke(C.pullRequestsForget, workspaceId, floorId, recordId);
    },
    removeMerged(workspaceId: string, floorId: string, recordId: string, confirmExtraWork?: boolean) {
      return tauriInvoke(C.pullRequestsRemoveMerged, workspaceId, floorId, recordId, confirmExtraWork);
    },
    handOff(workspaceId: string, floorId: string, request: any) {
      return tauriInvoke(C.pullRequestsHandOff, workspaceId, floorId, request);
    },
    folders: {
      openFromTree: (workspaceId: string, nodeId: string) => tauriInvoke(C.pullRequestFoldersOpen, workspaceId, nodeId),
      branches: (folderId: string) => tauriInvoke(C.pullRequestFoldersBranches, folderId),
      prepare: (folderId: string, base?: string) => tauriInvoke(C.pullRequestFoldersPrepare, folderId, base),
      account: (folderId: string, base?: string) => tauriInvoke(C.pullRequestFoldersAccount, folderId, base),
      diff: (folderId: string, base?: string) => tauriInvoke(C.pullRequestFoldersDiff, folderId, base),
      fileDiff: (folderId: string, base: string, path: string, oldPath?: string | null) => tauriInvoke(C.pullRequestFoldersFileDiff, folderId, base, path, oldPath),
      open: (folderId: string, request: any) => tauriInvoke(C.pullRequestFoldersOpenPullRequest, folderId, request),
      openOnWebsite: (folderId: string, request: any) => tauriInvoke(C.pullRequestFoldersOpenOnWebsite, folderId, request),
      imagePrefix: (folderId: string) => tauriInvoke(C.pullRequestFoldersImagePrefix, folderId),
      keepImage: (folderId: string, dataBase64: string, format: string) => tauriInvoke(C.pullRequestFoldersKeepImage, folderId, dataBase64, format),
      imagesExist: (folderId: string) => tauriInvoke(C.pullRequestFoldersImagesExist, folderId),
      showImages: (folderId: string) => tauriInvoke(C.pullRequestFoldersShowImages, folderId),
      close: (folderId: string) => tauriInvoke(C.pullRequestFoldersClose, folderId)
    }
  },
  chat: {
    conversation(terminalId: string, slot: any) {
      return tauriInvoke(C.chatConversation, terminalId, slot);
    },
    loadOlderHistory(terminalId: string, conversationId: string) {
      return tauriInvoke(C.chatLoadOlderHistory, terminalId, conversationId);
    },
    loadHistoryBackTo(terminalId: string, conversationId: string, entryId: string) {
      return tauriInvoke(C.chatLoadHistoryBackTo, terminalId, conversationId, entryId);
    },
    searchHistory(terminalId: string, conversationId: string, query: string, requestId?: string) {
      return tauriInvoke(C.chatSearchHistory, terminalId, conversationId, query, requestId);
    },
    cancelSearchHistory(requestId: string) {
      return tauriInvoke(C.chatCancelSearchHistory, requestId);
    },
    threads(terminalId: string) {
      return tauriInvoke(C.chatThreads, terminalId);
    },
    enter(terminalId: string) {
      return tauriInvoke(C.chatEnter, terminalId);
    },
    exit(terminalId: string) {
      return tauriInvoke(C.chatExit, terminalId);
    },
    setShowsShellWindowDuringTurns(terminalId: string, shows: boolean) {
      return tauriInvoke(C.chatSetShowsShellWindowDuringTurns, terminalId, shows);
    },
    send(terminalId: string, segments: any[], text: string, entryId?: string) {
      return tauriInvoke(C.chatSend, terminalId, segments, text, entryId);
    },
    interrupt(terminalId: string) {
      return tauriInvoke(C.chatInterrupt, terminalId);
    },
    acknowledgeAttention(terminalId: string) {
      return tauriInvoke(C.chatAcknowledgeAttention, terminalId);
    },
    markRead(terminalId: string) {
      return tauriInvoke(C.chatMarkRead, terminalId);
    },
    switchThread(terminalId: string, slot: any) {
      return tauriInvoke(C.chatSwitchThread, terminalId, slot);
    },
    clearThread(terminalId: string, slot: any) {
      return tauriInvoke(C.chatClearThread, terminalId, slot);
    },
    deleteEntry(terminalId: string, entryId: string) {
      return tauriInvoke(C.chatDeleteEntry, terminalId, entryId);
    },
    deleteAttachment(terminalId: string, attachmentId: string) {
      return tauriInvoke(C.chatDeleteAttachment, terminalId, attachmentId);
    },
    onConversationEvent(handler: (payload: any) => void) {
      return subscribe(C.chatOnConversationEvent, handler);
    },
    attachmentFacts(path: string) {
      return tauriInvoke(C.chatAttachmentFacts, path);
    },
    openAttachment(path: string) {
      return tauriInvoke(C.chatOpenAttachment, path);
    },
    startAttachmentDrag(path: string) {
      tauriInvoke(C.chatStartAttachmentDrag, path);
    },
    askNames(terminalId: string) {
      return tauriInvoke(C.chatAskNames, terminalId);
    },
    captureChatArchives(terminalIds: string[]) {
      return tauriInvoke(C.chatCaptureArchives, terminalIds);
    },
    copyChats(copies: any, archives: any) {
      return tauriInvoke(C.chatCopyChats, copies, archives);
    },
    discardCopiedChats(conversationIds: string[]) {
      return tauriInvoke(C.chatDiscardCopiedChats, conversationIds);
    },
    sendComposedPrompt(terminalId: string, text: string, content: any) {
      return tauriInvoke(C.chatSendComposedPrompt, terminalId, text, content);
    },
    searchConversations(query: string, limit?: number, labels?: string[]) {
      return tauriInvoke(C.chatSearchConversations, query, limit, labels);
    },
    releaseConversationSearch() {
      return tauriInvoke(C.chatReleaseConversationSearch);
    }
  },
  pathForFile(file: File | { path?: string; name?: string }) {
    try {
      return (file as any)?.path || file?.name || '';
    } catch {
      return "";
    }
  },
  codex: {
    /**
     * The terminal sheets' warning: core's answer for whether this command
     * launches the Codex TUI without its `--no-daemon` flag. Strictly
     * boolean: false is also a non-Codex command or a core that cannot
     * answer, and the call never rejects.
     */
    isMissingFlag(command: string, target: any) {
      return tauriInvoke(C.codexIsMissingFlag, command, target);
    }
  },
  routines: {
    list() {
      return tauriInvoke(C.routineList);
    },
    create(input: any) {
      return tauriInvoke(C.routineCreate, input);
    },
    update(id: string, patch: any) {
      return tauriInvoke(C.routineUpdate, id, patch);
    },
    delete(id: string) {
      return tauriInvoke(C.routineDelete, id);
    },
    setEnabled(id: string, enabled: boolean) {
      return tauriInvoke(C.routineSetEnabled, id, enabled);
    },
    runNow(id: string) {
      return tauriInvoke(C.routineRunNow, id);
    },
    onChanged(handler: (payload: any) => void) {
      return subscribe(C.routineOnChanged, handler);
    },
    history() {
      return tauriInvoke(C.routineHistory);
    },
    historyRemove(id: string) {
      return tauriInvoke(C.routineHistoryRemove, id);
    },
    historyClear() {
      return tauriInvoke(C.routineHistoryClear);
    },
    onHistoryChanged(handler: (payload: any) => void) {
      return subscribe(C.routineOnHistoryChanged, handler);
    }
  },
  remote: {
    getState() {
      return tauriInvoke(C.remoteGetState);
    },
    onStateChanged(handler: (payload: any) => void) {
      return subscribe(C.remoteOnStateChanged, handler);
    },
    beginPairingWindow() {
      return tauriInvoke(C.remoteBeginPairingWindow);
    },
    endPairingWindow() {
      return tauriInvoke(C.remoteEndPairingWindow);
    },
    setEnabled(enabled: boolean) {
      return tauriInvoke(C.remoteSetEnabled, enabled);
    },
    setPort(port: number) {
      return tauriInvoke(C.remoteSetPort, port);
    },
    setTailnetOnly(tailnetOnly: boolean) {
      return tauriInvoke(C.remoteSetTailnetOnly, tailnetOnly);
    },
    setPassword(password: string) {
      return tauriInvoke(C.remoteSetPassword, password);
    },
    revokeDevice(id: string) {
      return tauriInvoke(C.remoteRevokeDevice, id);
    },
    setDeviceRole(id: string, role: string) {
      return tauriInvoke(C.remoteSetDeviceRole, id, role);
    },
    renameDevice(id: string, name: string) {
      return tauriInvoke(C.remoteRenameDevice, id, name);
    },
    onPresence(handler: (payload: any) => void) {
      const unsubscribe = subscribe(C.remoteOnPresence, handler);
      tauriInvoke(C.remotePresenceResend);
      return unsubscribe;
    },
    onCameraFrame(handler: (payload: any) => void) {
      return subscribe(C.remoteOnCameraFrame, handler);
    },
    onPartituraPreviewRequested(handler: (payload: any) => void) {
      return subscribe(C.remotePartituraPreviewRequest, handler);
    },
    completePartituraPreview(requestId: string, result: any) {
      return tauriInvoke(C.remotePartituraPreviewResult, requestId, result);
    },
    onPortalReloadRequested(handler: (payload: any) => void) {
      return subscribe(C.remotePortalReloadRequest, handler);
    },
    completePortalReload(requestId: string, result: any) {
      return tauriInvoke(C.remotePortalReloadResult, requestId, result);
    }
  },
  snapNode(context: any) {
    return tauriInvoke(C.snapNode, context);
  },
  tidyNode(request: any) {
    return tauriInvoke(C.tidyNode, request);
  },
  onNodePlaced(handler: (payload: any) => void) {
    return subscribe('mindagentics:canvas:nodePlaced', handler);
  },
  onNodeDeleted(handler: (payload: any) => void) {
    return subscribe('mindagentics:canvas:nodeDeleted', handler);
  },
  onCableTieCreated(handler: (payload: any) => void) {
    return subscribe('mindagentics:canvas:cableTieCreated', handler);
  },
  onCableTieDeleted(handler: (payload: any) => void) {
    return subscribe('mindagentics:canvas:cableTieDeleted', handler);
  },
  graphify: {
    buildGraph(params: any) {
      return tauriInvoke('mindagentics:graphify:build', params);
    },
    checkGraph(dir: string) {
      return tauriInvoke('mindagentics:graphify:check', dir);
    },
    query(dir: string, question: string, dfs?: boolean) {
      return tauriInvoke('mindagentics:graphify:query', dir, question, dfs);
    },
    explain(dir: string, symbol: string, all?: boolean) {
      return tauriInvoke('mindagentics:graphify:explain', dir, symbol, all);
    },
    path(dir: string, from: string, to: string, undirected?: boolean) {
      return tauriInvoke('mindagentics:graphify:path', dir, from, to, undirected);
    },
    getStatus() {
      return tauriInvoke('mindagentics:graphify:status');
    },
    install() {
      return tauriInvoke('mindagentics:graphify:install');
    },
    onProgress(handler: (data: { message: string }) => void) {
      const subscription = (data: any) => handler(data);
      const unlisten = tauriListen('mindagentics:graphify:progress', subscription);
      return () => {
        if (typeof unlisten === "function") unlisten();
      };
    }
  },
  profile: {
    get(): Promise<UserProfile> {
      return tauriInvoke(C.profileGet);
    },
    update(patch: Partial<UserProfile>): Promise<UserProfile> {
      return tauriInvoke(C.profileUpdate, patch);
    },
    awardXp(xp: number, statKey?: keyof OrchestratorStats): Promise<{ profile: UserProfile; leveledUp: boolean; unlockedBadges: UserBadge[] }> {
      return tauriInvoke(C.profileAwardXp, xp, statKey);
    }
  }
};

// Re-export as default and alias
export const api = tauriBackend;
export default tauriBackend;

if (typeof window !== 'undefined' && isTauri()) {
  (window as any).mindAgentics = tauriBackend;
  (window as any).api = tauriBackend;
}

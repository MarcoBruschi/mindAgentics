// @ts-nocheck
/**
 * mindAgentics - Tauri v2 Backend Adapter
 * Full 1:1 API Parity with preload/src/index.ts
 */
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { IPC_CHANNELS as C, assertPayloadWithinLimit, sanitizeForPtyLine } from '@mindagentics/shared';
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

const LICENSE_EXPIRED = "licenseExpired";
function licenseFailureKind(error: any): string | null {
  if (typeof error === "object" && error !== null && Reflect.get(error, "kind") === LICENSE_EXPIRED) {
    return LICENSE_EXPIRED;
  }
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.includes(LICENSE_EXPIRED) ? LICENSE_EXPIRED : null;
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

function invokeLicenseCommand(channel: string, ...args: any[]) {
  return tauriInvoke(channel, ...args).then((result: any) => {
    if (!result || !result.ok) return Promise.reject(result?.error);
    return result;
  });
}

function invokeWithLicenseFailure(channel: string, ...args: any[]) {
  return tauriInvoke(channel, ...args).catch((error: any) => {
    const kind = licenseFailureKind(error);
    if (!kind) throw error;
    return Promise.reject({ kind });
  });
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
    setLocale(locale) {
      return tauriInvoke(C.appSetLocale, locale);
    },
    localDirectorySuggestions(partialPath, limit) {
      return tauriInvoke(C.appLocalDirectorySuggestions, partialPath, limit);
    },
    directoryState(workspaceId, environment, path) {
      return tauriInvoke(C.appDirectoryState, workspaceId, environment, path);
    },
    createDirectory(workspaceId, environment, path) {
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
    openInIde(workspaceId, ideId) {
      return tauriInvoke(C.appOpenInIde, workspaceId, ideId);
    },
    openExternal(url) {
      return tauriInvoke(C.appOpenExternal, url);
    },
    openPath(path) {
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
    reportRendererFault(fault) {
      tauriInvoke(C.appRendererFault, fault);
    },
    onShutdown(handler) {
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
    onChanged(handler) {
      return subscribe(C.windowControlsOnChanged, handler);
    }
  },
  appState: {
    get() {
      return tauriInvoke(C.appStateGet);
    },
    setOnboardingCompleted(completed) {
      return tauriInvoke(C.appStateSetOnboardingCompleted, completed);
    },
    setHasSeenFloorOnboarding(seen) {
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
    onProgress(handler) {
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
    set(patch) {
      return tauriInvoke(C.preferencesSet, patch);
    },
    onChanged(handler) {
      return subscribePreferences(handler);
    }
  },
  partitura: {
    list() {
      return tauriInvoke(C.partituraList);
    },
    async save(partitura) {
      const result = await tauriInvoke(C.partituraSave, partitura);
      if (!result.ok) return Promise.reject(result.failure);
      return result.partitura;
    },
    delete(id) {
      return tauriInvoke(C.partituraDelete, id);
    },
    async exportOne(id) {
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
    readFiles(files) {
      const paths = files.map((file) => (file as any)?.path || file?.name || '');
      if (paths.some((path) => path === "")) {
        return Promise.resolve({ ok: false, failure: { kind: "unreadableFile" } });
      }
      return tauriInvoke(C.partituraReadFiles, paths);
    },
    readOpenedFiles() {
      return tauriInvoke(C.partituraReadOpenedFiles);
    },
    onChanged(handler) {
      return subscribeSignal(C.partituraChanged, handler);
    },
    onOpenRequested(handler) {
      return subscribeSignal(C.partituraOpenRequested, handler);
    }
  },
  workspace: {
    list() {
      return tauriInvoke(C.workspaceList);
    },
    create(input) {
      return invokeWithLicenseFailure(C.workspaceCreate, input);
    },
    patch(id, patch) {
      return tauriInvoke(C.workspacePatch, id, patch);
    },
    delete(id) {
      return tauriInvoke(C.workspaceDelete, id);
    },
    duplicate(id) {
      return tauriInvoke(C.workspaceDuplicate, id);
    },
    export(id) {
      return tauriInvoke(C.workspaceExport, id);
    },
    prepareImport(file) {
      if (file === void 0) return tauriInvoke(C.workspaceImport);
      const path = (file as any)?.path || file?.name || '';
      if (path === "") return Promise.resolve(null);
      return tauriInvoke(C.workspaceImport, [path]);
    },
    prepareOpenedImport() {
      return tauriInvoke(C.workspaceImportOpened);
    },
    completeImport(sourcePath, destination) {
      return tauriInvoke(C.workspaceImportComplete, sourcePath, destination);
    },
    onOpenRequested(handler) {
      return subscribeSignal(C.workspaceOpenRequested, handler);
    },
    unload(id, scope) {
      return tauriInvoke(C.workspaceUnload, id, scope);
    },
    getActiveId() {
      return tauriInvoke(C.workspaceGetActiveId);
    },
    setFloorStatus(workspaceId, floorId, status) {
      return tauriInvoke(C.workspaceSetFloorStatus, workspaceId, floorId, status);
    },
    reorderFloor(workspaceId, floorId, topDownIndex) {
      return tauriInvoke(C.workspaceReorderFloor, workspaceId, floorId, topDownIndex);
    },
    reveal(id) {
      return tauriInvoke(C.workspaceReveal, id);
    },
    switch(id) {
      return tauriInvoke(C.workspaceSwitch, id);
    },
    setPreferredIde(id, ideId) {
      return tauriInvoke(C.workspaceSetPreferredIde, id, ideId);
    },
    onChanged(handler) {
      return subscribe(C.workspaceOnChanged, handler);
    },
    onDeleted(handler) {
      return subscribe(C.workspaceOnDeleted, handler);
    },
    undo(id) {
      return tauriInvoke(C.workspaceUndo, id);
    },
    beginUndoGroup() {
      return tauriInvoke(C.workspaceBeginUndoGroup);
    },
    endUndoGroup() {
      return tauriInvoke(C.workspaceEndUndoGroup);
    },
    onLevelsUnloaded(handler) {
      return subscribe(C.workspaceOnLevelsUnloaded, handler);
    },
    redo(id) {
      return tauriInvoke(C.workspaceRedo, id);
    },
    configFiles: {
      status(id) {
        return tauriInvoke(C.workspaceConfigFilesStatus, id);
      },
      read(id, kind) {
        return tauriInvoke(C.workspaceConfigFilesRead, id, kind);
      },
      write(id, kind, text) {
        return tauriInvoke(C.workspaceConfigFilesWrite, id, kind, text);
      },
      remove(id, kind) {
        return tauriInvoke(C.workspaceConfigFilesRemove, id, kind);
      },
      sync(id, winner, expect) {
        return tauriInvoke(C.workspaceConfigFilesSync, id, winner, expect);
      }
    }
  },
  floor: {
    createKind: (workspaceId, input) => tauriInvoke(C.floorCreateKind, workspaceId, input),
    canCopyIndependently: (workspaceId) => tauriInvoke(C.floorCanCopy, workspaceId),
    isolationAvailable() {
      return tauriInvoke(C.floorIsolationAvailable);
    },
    create(workspaceId, input) {
      return tauriInvoke(C.floorCreate, workspaceId, input);
    },
    reviewSource: (workspaceId) => tauriInvoke(C.floorReviewSource, workspaceId),
    reviewNumber: (workspaceId, text) => tauriInvoke(C.floorReviewNumber, workspaceId, text),
    reviewList: (workspaceId, query) => tauriInvoke(C.floorReviewList, workspaceId, query),
    reviewFloorName: (workspaceId, number, title) => tauriInvoke(C.floorReviewName, workspaceId, number, title),
    createReview: (workspaceId, input, requestId) => tauriInvoke(C.floorReviewCreate, workspaceId, input, requestId),
    createIsolated(workspaceId, input, requestId) {
      return tauriInvoke(C.floorCreateIsolated, workspaceId, input, requestId);
    },
    listBranches(workspaceId) {
      return tauriInvoke(C.floorListBranches, workspaceId);
    },
    cancelIsolated(requestId) {
      return tauriInvoke(C.floorCancelIsolated, requestId);
    },
    onSeedProgress(handler) {
      return subscribe(C.floorSeedProgress, handler);
    },
    rename(workspaceId, floorId, name) {
      return tauriInvoke(C.floorRename, workspaceId, floorId, name);
    },
    switch(workspaceId, floorId, outgoingCamera, outgoingDock) {
      return tauriInvoke(
        C.floorSwitch,
        workspaceId,
        floorId,
        outgoingCamera,
        outgoingDock
      );
    },
    delete(workspaceId, floorId, removeBranch, options) {
      return tauriInvoke(
        C.floorDelete,
        workspaceId,
        floorId,
        removeBranch === true,
        options ?? null
      );
    },
    removeBranch(workspaceId, branch, force) {
      return tauriInvoke(C.floorRemoveBranch, workspaceId, branch, force);
    },
    landingPreflight(workspaceId, floorId) {
      return tauriInvoke(C.floorLandingPreflight, workspaceId, floorId);
    },
    landingPreview(workspaceId, floorId, target) {
      return tauriInvoke(C.floorLandingPreview, workspaceId, floorId, target);
    },
    landingFileDiff(workspaceId, floorId, target, path, oldPath, conflict) {
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
    land(workspaceId, floorId, target) {
      return tauriInvoke(C.floorLand, workspaceId, floorId, target);
    },
    landingRemoveBranch(workspaceId, branch, target) {
      return tauriInvoke(C.floorLandingRemoveBranch, workspaceId, branch, target);
    },
    onLanding(handler) {
      return subscribe(C.floorOnLanding, handler);
    },
    onRemovingChanged(handler) {
      return subscribe(C.floorOnRemovingChanged, handler);
    },
    removing() {
      return tauriInvoke(C.floorRemoving);
    },
    testLanding(workspaceId, floorId) {
      return tauriInvoke(C.floorTestLanding, workspaceId, floorId);
    }
  },
  floorSnapshot: {
    capture(workspaceId, rect, maxWidth) {
      return tauriInvoke(C.floorSnapshotCapture, workspaceId, rect, maxWidth);
    }
  },
  floorHooks: {
    get(workspaceId) {
      return tauriInvoke(C.floorHooksGet, workspaceId);
    },
    replace(workspaceId, hooks) {
      return tauriInvoke(C.floorHooksReplace, workspaceId, hooks);
    },
    run(workspaceId, floorId, commandId) {
      return tauriInvoke(C.floorHooksRun, workspaceId, floorId, commandId);
    },
    stop(commandId) {
      return tauriInvoke(C.floorHooksStop, commandId);
    },
    runSection(workspaceId, floorId, section) {
      return tauriInvoke(C.floorHooksRunSection, workspaceId, floorId, section);
    },
    clearResult(commandId) {
      return tauriInvoke(C.floorHooksClearResult, commandId);
    },
    clearAllResults(workspaceId) {
      return tauriInvoke(C.floorHooksClearAllResults, workspaceId);
    },
    runs() {
      return tauriInvoke(C.floorHooksRuns);
    },
    onRunsChanged(handler) {
      return subscribe(C.floorHooksOnRunsChanged, handler);
    },
    readOutput(commandId) {
      return tauriInvoke(C.floorHooksReadOutput, commandId);
    },
    onOutput(handler) {
      return subscribe(C.floorHooksOnOutput, handler);
    },
    write(commandId, data) {
      return tauriInvoke(C.floorHooksWrite, commandId, data);
    },
    resize(commandId, cols, rows) {
      return tauriInvoke(C.floorHooksResize, commandId, cols, rows);
    }
  },
  node: {
    create(workspaceId, node) {
      return tauriInvoke(C.nodeCreate, workspaceId, node);
    },
    patch(workspaceId, nodeId, patch) {
      return tauriInvoke(C.nodePatch, workspaceId, nodeId, patch);
    },
    patchFrames(workspaceId, patches) {
      return tauriInvoke(C.nodePatchFrames, workspaceId, patches);
    },
    delete(workspaceId, nodeId) {
      return tauriInvoke(C.nodeDelete, workspaceId, nodeId);
    },
    deleteMany(workspaceId, nodeIds) {
      return tauriInvoke(C.nodeDeleteMany, workspaceId, nodeIds);
    },
    unload(workspaceId, nodeIds) {
      return tauriInvoke(C.nodeUnload, workspaceId, nodeIds);
    },
    setNodesRedacted(workspaceId, nodeIds, isRedacted) {
      return tauriInvoke(C.nodeSetRedacted, workspaceId, nodeIds, isRedacted);
    }
  },
  group: {
    create(workspaceId, nodeIds) {
      return tauriInvoke(C.groupCreate, workspaceId, nodeIds);
    },
    ungroup(workspaceId, nodeIds) {
      return tauriInvoke(C.groupUngroup, workspaceId, nodeIds);
    },
    rename(workspaceId, groupId, name) {
      return tauriInvoke(C.groupRename, workspaceId, groupId, name);
    },
    setColor(workspaceId, groupId, colorHex) {
      return tauriInvoke(C.groupSetColor, workspaceId, groupId, colorHex);
    }
  },
  // Fichários. ONE call per operation and ONE undo step each: filing a note is
  // four edits (membership, rope promotion, frame tuck, uniform colour) that mac
  // runs inside a single undoable mutation, so the transaction lives in main
  // rather than as a sequence of `node.patch` calls from the renderer.
  noteStack: {
    /** From loose notes, in canvas reading order. Null when nothing was fileable. */
    create(workspaceId, noteNodeIds, name, defaultName) {
      return tauriInvoke(C.noteStackCreate, workspaceId, noteNodeIds, name, defaultName);
    },
    /** The mixed-selection verb: notes create one, a selected fichário receives, further ones merge in. */
    fileSelection(workspaceId, nodeIds, defaultName) {
      return tauriInvoke(C.noteStackFileSelection, workspaceId, nodeIds, defaultName);
    },
    addNotes(workspaceId, stackNodeId, noteNodeIds) {
      return tauriInvoke(C.noteStackAddNotes, workspaceId, stackNodeId, noteNodeIds);
    },
    /**
     * Inserts a page the caller has already built, so the `.md` naming stays in
     * the note-file layer while the insert, the front flip, the tuck and the
     * uniform stamp remain one undo step. Returns the stored node.
     */
    addPage(workspaceId, stackNodeId, pageNode, afterNoteNodeId) {
      return tauriInvoke(C.noteStackAddPage, workspaceId, stackNodeId, pageNode, afterNoteNodeId);
    },
    /** One page back onto the canvas. Reports whether an unnamed stack dissolved behind it. */
    spill(workspaceId, stackNodeId, noteNodeId, origin) {
      return tauriInvoke(C.noteStackSpill, workspaceId, stackNodeId, noteNodeId, origin);
    },
    unstack(workspaceId, stackNodeId) {
      return tauriInvoke(C.noteStackUnstack, workspaceId, stackNodeId);
    },
    /** The "Keep Notes" branch of the delete prompt: the folder goes, the pages fan out. */
    deleteKeepingNotes(workspaceId, stackNodeId) {
      return tauriInvoke(C.noteStackDeleteKeepingNotes, workspaceId, stackNodeId);
    },
    moveMember(workspaceId, stackNodeId, fromIndex, toIndex) {
      return tauriInvoke(C.noteStackMoveMember, workspaceId, stackNodeId, fromIndex, toIndex);
    },
    setFront(workspaceId, stackNodeId, noteNodeId) {
      return tauriInvoke(C.noteStackSetFront, workspaceId, stackNodeId, noteNodeId);
    },
    rename(workspaceId, stackNodeId, name) {
      return tauriInvoke(C.noteStackRename, workspaceId, stackNodeId, name);
    },
    clearCustomName(workspaceId, stackNodeId) {
      return tauriInvoke(C.noteStackClearCustomName, workspaceId, stackNodeId);
    },
    /** The drop-to-file commit. The note never moves to the release point. */
    fileDroppedNote(workspaceId, noteNodeId, stackNodeId) {
      return tauriInvoke(C.noteStackFileDroppedNote, workspaceId, noteNodeId, stackNodeId);
    },
    /** Lane to lane, without touching the canvas in between. Does not inherit the source's ropes. */
    moveBetween(workspaceId, fromStackNodeId, toStackNodeId, noteNodeId) {
      return tauriInvoke(
        C.noteStackMoveBetween,
        workspaceId,
        fromStackNodeId,
        toStackNodeId,
        noteNodeId
      );
    },
    toggleUniformColor(workspaceId, stackNodeId) {
      return tauriInvoke(C.noteStackToggleUniformColor, workspaceId, stackNodeId);
    },
    /**
     * THE single write path for a note's colour. A note inside a Uniform Color
     * fichário retunes the whole stack in the same undo step, so every colour
     * control routes here rather than through `node.patch`.
     */
    setNoteColor(workspaceId, noteNodeId, color, customColor) {
      return tauriInvoke(C.noteStackSetNoteColor, workspaceId, noteNodeId, color, customColor);
    },
    setEngaged(nodeIds) {
      tauriInvoke(C.noteStackSetEngaged, nodeIds);
    }
  },
  band: {
    create(workspaceId, nodeIds, name, defaultName, focusedNodeId) {
      return tauriInvoke(C.bandCreate, workspaceId, nodeIds, name, defaultName, focusedNodeId);
    },
    addTerminals(workspaceId, bandNodeId, memberNodeIds, focusedNodeId) {
      return tauriInvoke(C.bandAddTerminals, workspaceId, bandNodeId, memberNodeIds, focusedNodeId);
    },
    removeMember(workspaceId, bandNodeId, memberNodeId, origin) {
      return tauriInvoke(C.bandRemoveMember, workspaceId, bandNodeId, memberNodeId, origin);
    },
    moveMemberBetween(workspaceId, fromBandNodeId, toBandNodeId, memberNodeId) {
      return tauriInvoke(C.bandMoveMemberBetween, workspaceId, fromBandNodeId, toBandNodeId, memberNodeId);
    },
    dissolve(workspaceId, bandNodeId) {
      return tauriInvoke(C.bandDissolve, workspaceId, bandNodeId);
    },
    moveMember(workspaceId, bandNodeId, memberNodeId, move) {
      return tauriInvoke(C.bandMoveMember, workspaceId, bandNodeId, memberNodeId, move);
    },
    setOrder(workspaceId, bandNodeId, memberNodeIds) {
      return tauriInvoke(C.bandSetOrder, workspaceId, bandNodeId, memberNodeIds);
    },
    select(workspaceId, bandNodeId, memberNodeId) {
      return tauriInvoke(C.bandSelect, workspaceId, bandNodeId, memberNodeId);
    },
    update(workspaceId, bandNodeId, patch, recordsUndo) {
      return tauriInvoke(C.bandUpdate, workspaceId, bandNodeId, patch, recordsUndo);
    },
    rename(workspaceId, bandNodeId, name) {
      return tauriInvoke(C.bandRename, workspaceId, bandNodeId, name);
    },
    setSidebarWidth(workspaceId, bandNodeId, width) {
      return tauriInvoke(C.bandSetSidebarWidth, workspaceId, bandNodeId, width);
    },
    addNewMember(workspaceId, bandNodeId, node) {
      return tauriInvoke(C.bandAddNewMember, workspaceId, bandNodeId, node);
    },
    onAsksInFlight(handler) {
      return subscribe(C.bandAsksInFlight, handler);
    }
  },
  agent: {
    assignRole(terminalId, roleId) {
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
    discoverRoles(input) {
      return tauriInvoke(C.agentDiscoverRoles, input);
    },
    validateWslDirectory(distro, path, user) {
      return tauriInvoke(C.agentValidateWslDirectory, distro, path, user);
    },
    directorySuggestions(workspaceId, connection, partialPath, limit) {
      return tauriInvoke(C.agentDirectorySuggestions, workspaceId, connection, partialPath, limit);
    },
    listDockerContainers(workspaceId, context) {
      return tauriInvoke(C.agentListDockerContainers, workspaceId, context);
    },
    testDockerConnection(workspaceId, config) {
      return tauriInvoke(C.agentTestDockerConnection, workspaceId, config);
    },
    listSandboxes(workspaceId, workspacePath) {
      return tauriInvoke(C.agentListSandboxes, workspaceId, workspacePath);
    },
    listSandboxAgents(workspaceId) {
      return tauriInvoke(C.agentListSandboxAgents, workspaceId);
    },
    createSandbox(workspaceId, request) {
      return tauriInvoke(C.agentCreateSandbox, workspaceId, request);
    },
    testSandboxConnection(workspaceId, config) {
      return tauriInvoke(C.agentTestSandboxConnection, workspaceId, config);
    }
  },
  drawing: {
    recognize(workspaceId, points) {
      return invokeWithLicenseFailure(C.drawingRecognize, workspaceId, points);
    },
    create(workspaceId, drawing) {
      return tauriInvoke(C.drawingCreate, workspaceId, drawing);
    },
    patch(workspaceId, drawingId, patch) {
      return tauriInvoke(C.drawingPatch, workspaceId, drawingId, patch);
    },
    delete(workspaceId, drawingId) {
      return tauriInvoke(C.drawingDelete, workspaceId, drawingId);
    },
    group(workspaceId, drawingIds) {
      return tauriInvoke(C.drawingGroup, workspaceId, drawingIds);
    },
    ungroup(workspaceId, drawingIds) {
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
    getAgentModels(presetId) {
      return tauriInvoke('mindagentics:terminal:getAgentModels', presetId);
    },
    setOrchestratorMode(terminalId, orchestratorMode) {
      return tauriInvoke('mindagentics:terminal:setOrchestratorMode', terminalId, orchestratorMode);
    },
    setMaestroMode(terminalId, maestroMode) {
      return tauriInvoke('mindagentics:terminal:setMaestroMode', terminalId, maestroMode);
    },
    spawn(input) {
      return tauriInvoke(C.terminalSpawn, input);
    },
    write(terminalId, data) {
      tauriInvoke(C.terminalWrite, terminalId, data);
      return Promise.resolve();
    },
    deliverPrompt(terminalId, text) {
      return tauriInvoke(C.terminalDeliverPrompt, terminalId, text);
    },
    dims(terminalId) {
      return tauriInvoke(C.terminalDims, terminalId);
    },
    resize(terminalId, cols, rows, options) {
      return tauriInvoke(C.terminalResize, terminalId, cols, rows, options);
    },
    resolvePath(query) {
      return tauriInvoke(C.terminalResolvePath, query);
    },
    kill(terminalId) {
      return tauriInvoke(C.terminalKill, terminalId);
    },
    restart(terminalId) {
      return tauriInvoke(C.terminalRestart, terminalId);
    },
    reconfigure(arg1: any, arg2?: any) {
      return tauriInvoke(C.terminalReconfigure, arg1, arg2);
    },
    attach(terminalId) {
      return tauriInvoke(C.terminalAttach, terminalId);
    },
    getScrollback(terminalId) {
      return tauriInvoke(C.terminalGetScrollback, terminalId);
    },
    markSeen(terminalId) {
      tauriInvoke(C.terminalMarkSeen, terminalId);
    },
    discardResume(workspaceId, nodeId) {
      return tauriInvoke(C.terminalDiscardResume, workspaceId, nodeId);
    },
    setFocused(terminalId) {
      tauriInvoke(C.terminalSetFocused, terminalId);
    },
    onData(handler) {
      return subscribe(C.terminalOnData, handler);
    },
    onExit(handler) {
      return subscribe(C.terminalOnExit, handler);
    },
    onStatus(handler) {
      return subscribe(C.terminalOnStatus, handler);
    },
    onActivity(handler) {
      return subscribe(C.terminalActivity, handler);
    },
    memory() {
      return tauriInvoke(C.terminalMemory);
    },
    onMemory(handler) {
      return subscribe(C.terminalOnMemory, handler);
    },
    processList(terminalId) {
      return tauriInvoke(C.terminalProcessList, terminalId);
    },
    stopProcess(terminalId, pid, startTime) {
      return tauriInvoke(C.terminalProcessStop, terminalId, pid, startTime);
    },
    tmuxSession(terminalId) {
      return tauriInvoke(C.terminalTmuxSession, terminalId);
    },
    endTmuxSession(terminalId) {
      return tauriInvoke(C.terminalEndTmuxSession, terminalId);
    },
    remoteSessionProcesses(terminalId) {
      return tauriInvoke(C.terminalRemoteSessionProcesses, terminalId);
    },
    stopRemoteSessionProcess(terminalId, pid) {
      return tauriInvoke(C.terminalStopRemoteSessionProcess, terminalId, pid);
    },
    roleInstallFailures() {
      return tauriInvoke(C.terminalRoleInstallFailures);
    },
    onRoleInstallFailures(handler) {
      return subscribe(C.terminalOnRoleInstallFailures, handler);
    },
    onFocusRequested(handler) {
      return subscribe(C.terminalFocusRequested, handler);
    },
    onGeometryPinned(handler) {
      return subscribe(C.terminalOnGeometryPinned, handler);
    },
    publishLiveColors(terminals) {
      return tauriInvoke(C.terminalPublishLiveColors, terminals);
    }
  },
  note: {
    read(workspaceId, nodeId) {
      return tauriInvoke(C.noteRead, workspaceId, nodeId);
    },
    write(workspaceId, nodeId, text) {
      return tauriInvoke(C.noteWrite, workspaceId, nodeId, text);
    },
    edit(workspaceId, nodeId, oldText, newText) {
      return tauriInvoke(C.noteEdit, workspaceId, nodeId, oldText, newText);
    },
    rename(workspaceId, nodeId, newFileName) {
      return tauriInvoke(C.noteRename, workspaceId, nodeId, newFileName);
    },
    reveal(workspaceId, nodeId) {
      return tauriInvoke(C.noteReveal, workspaceId, nodeId);
    },
    moveToExternal(workspaceId, nodeId) {
      return tauriInvoke(C.noteMoveToExternal, workspaceId, nodeId);
    },
    moveToManaged(workspaceId, nodeId) {
      return tauriInvoke(C.noteMoveToManaged, workspaceId, nodeId);
    },
    createFromFile(workspaceId, node, sourcePath) {
      return tauriInvoke(C.noteCreateFromFile, workspaceId, node, sourcePath);
    },
    createFromRemoteFile(workspaceId, node, connection, path, floorId) {
      return tauriInvoke(
        C.noteCreateFromRemoteFile,
        workspaceId,
        node,
        connection,
        path,
        floorId
      );
    },
    refreshFromRemoteFile(workspaceId, nodeId) {
      return tauriInvoke(C.noteRefreshFromRemoteFile, workspaceId, nodeId);
    },
    onChange(handler) {
      return subscribe(C.noteOnChange, handler);
    },
    attachImage(workspaceId, image) {
      return tauriInvoke(C.noteAttachImage, workspaceId, image.dataBase64, image.ext);
    },
    notesDir(workspaceId) {
      return tauriInvoke(C.noteNotesDir, workspaceId);
    },
    mediaDir(workspaceId) {
      return tauriInvoke(C.noteMediaDir, workspaceId);
    }
  },
  fileTree: {
    list(nodeId, directoryPath) {
      return tauriInvoke(C.fileTreeList, nodeId, directoryPath);
    },
    watch(nodeId, directoryPath) {
      return tauriInvoke(C.fileTreeWatch, nodeId, directoryPath);
    },
    unwatch(nodeId) {
      return tauriInvoke(C.fileTreeUnwatch, nodeId);
    },
    attachCheckout(path) {
      return tauriInvoke(C.fileTreeAttachCheckout, path);
    },
    onDidChange(handler) {
      return subscribe(C.fileTreeOnDidChange, handler);
    },
    reveal(nodeId) {
      return tauriInvoke(C.fileTreeReveal, nodeId);
    },
    gitState(nodeId) {
      return tauriInvoke(C.fileTreeGitState, nodeId);
    },
    gitAction(nodeId, action) {
      return tauriInvoke(C.fileTreeGitAction, nodeId, action);
    },
    gitChanges(nodeId) {
      return tauriInvoke(C.fileTreeGitChanges, nodeId);
    },
    gitCancel(nodeId) {
      return tauriInvoke(C.fileTreeGitCancel, nodeId);
    },
    gitIndexLock(nodeId) {
      return tauriInvoke(C.fileTreeGitIndexLock, nodeId);
    },
    searchContents(nodeId, query, showHidden) {
      return tauriInvoke(C.fileTreeSearchContents, nodeId, query, showHidden);
    },
    searchFilenames(nodeId) {
      return tauriInvoke(C.fileTreeSearchFilenames, nodeId);
    },
    cancelSearch(nodeId) {
      return tauriInvoke(C.fileTreeCancelSearch, nodeId);
    },
    onSearchResults(handler) {
      return subscribe(C.fileTreeOnSearchResults, handler);
    },
    gitDiffFiles(nodeId, scope) {
      return tauriInvoke(C.fileTreeGitDiffFiles, nodeId, scope);
    },
    gitFileDiff(nodeId, scope, path, oldPath) {
      return tauriInvoke(C.fileTreeGitFileDiff, nodeId, scope, path, oldPath ?? null);
    },
    gitHistory(nodeId, limit) {
      return tauriInvoke(C.fileTreeGitHistory, nodeId, limit);
    },
    gitCommitBody(nodeId, hash) {
      return tauriInvoke(C.fileTreeGitCommitBody, nodeId, hash);
    },
    gitBranches(nodeId) {
      return tauriInvoke(C.fileTreeGitBranches, nodeId);
    },
    gitStashes(nodeId) {
      return tauriInvoke(C.fileTreeGitStashes, nodeId);
    },
    gitMergePreview(nodeId, source, target) {
      return tauriInvoke(C.fileTreeGitMergePreview, nodeId, source, target);
    },
    readFile(nodeId, path) {
      return tauriInvoke(C.fileTreeReadFile, nodeId, path);
    },
    writeFile(nodeId, path, text) {
      return tauriInvoke(C.fileTreeWriteFile, nodeId, path, text);
    },
    probeMedia(nodeId, path) {
      return tauriInvoke(C.fileTreeProbeMedia, nodeId, path);
    },
    onFileChanged(handler) {
      return subscribe(C.fileTreeOnFileChanged, handler);
    },
    copyPath(nodeId, path) {
      return tauriInvoke(C.fileTreeCopyPath, nodeId, path);
    },
    revealFile(nodeId, path) {
      return tauriInvoke(C.fileTreeRevealFile, nodeId, path);
    },
    onGitActionProgress(handler) {
      return subscribe(C.fileTreeOnGitActionProgress, handler);
    },
    onGitState(handler) {
      return subscribe(C.fileTreeOnGitState, handler);
    },
    watchState(nodeId) {
      return tauriInvoke(C.fileTreeWatchState, nodeId);
    },
    retryWatch(nodeId) {
      return tauriInvoke(C.fileTreeRetryWatch, nodeId);
    },
    onWatchState(handler) {
      return subscribe(
        C.fileTreeOnWatchState,
        handler
      );
    },
    fileOperation(nodeId, operation) {
      return tauriInvoke(C.fileTreeFileOperation, nodeId, operation);
    },
    fileClipboard() {
      return tauriInvoke(C.fileTreeFileClipboard);
    }
  },
  files: {
    storeAttachment(workspaceId, input) {
      return tauriInvoke(C.filesStoreAttachment, workspaceId, input);
    },
    openAttachment(workspaceId, nodeId) {
      return tauriInvoke(C.filesOpenAttachment, workspaceId, nodeId);
    },
    revealAttachment(workspaceId, nodeId) {
      return tauriInvoke(C.filesRevealAttachment, workspaceId, nodeId);
    },
    revealPath(path) {
      return tauriInvoke(C.filesRevealPath, path);
    },
    linkPaths(paths) {
      return tauriInvoke(C.filesLinkPaths, paths);
    },
    resolveLocalPath(path, bases) {
      return tauriInvoke(C.filesResolveLocalPath, path, bases);
    },
    stagePastedImage(dataBase64, ext) {
      return tauriInvoke(C.filesStagePastedImage, dataBase64, ext);
    },
    clipboardFilePaths() {
      return tauriInvoke(C.filesClipboardFilePaths);
    }
  },
  clipboard: {
    // Plain `invoke`, not the licence-failure wrapper: this answers a boolean,
    // and a copy the user just clicked must not reject mid-gesture.
    writeImage(png) {
      return tauriInvoke(C.clipboardWriteImage, png);
    }
  },
  connection: {
    createTerminalConnection(workspaceId, terminalIdA, terminalIdB, fromWorkspaceId) {
      return tauriInvoke(
        C.connectionCreateTerminal,
        workspaceId,
        terminalIdA,
        terminalIdB,
        fromWorkspaceId
      );
    },
    createNoteConnection(workspaceId, terminalId, noteNodeId) {
      return tauriInvoke(C.connectionCreateNote, workspaceId, terminalId, noteNodeId);
    },
    turnFileIntoNote(workspaceId, sourceNodeId, fileNodeId) {
      return tauriInvoke(C.connectionTurnFileIntoNote, workspaceId, sourceNodeId, fileNodeId);
    },
    createNoteToNoteConnection(workspaceId, noteNodeIdA, noteNodeIdB) {
      return tauriInvoke(
        C.connectionCreateNoteToNote,
        workspaceId,
        noteNodeIdA,
        noteNodeIdB
      );
    },
    createPortalConnection(workspaceId, terminalId, portalNodeId) {
      return tauriInvoke(C.connectionCreatePortal, workspaceId, terminalId, portalNodeId);
    },
    createPortalToPortalConnection(workspaceId, portalNodeIdA, portalNodeIdB) {
      return tauriInvoke(
        C.connectionCreatePortalToPortal,
        workspaceId,
        portalNodeIdA,
        portalNodeIdB
      );
    },
    createCrossFloorConnection(workspaceId, sourceTerminalId, targetTerminalId) {
      return tauriInvoke(
        C.connectionCreateCrossFloor,
        workspaceId,
        sourceTerminalId,
        targetTerminalId
      );
    },
    connectNodes(workspaceId, fromNodeId, toNodeId, fromWorkspaceId) {
      return tauriInvoke(C.connectionConnectNodes, workspaceId, fromNodeId, toNodeId, fromWorkspaceId);
    },
    updateRopePoints(workspaceId, connectionId, ropePoints) {
      return tauriInvoke(C.connectionUpdateRopePoints, workspaceId, connectionId, ropePoints);
    },
    updateRopePointsMany(workspaceId, snapshot) {
      return tauriInvoke(C.connectionUpdateRopePointsMany, workspaceId, snapshot);
    },
    delete(workspaceId, connectionId) {
      return tauriInvoke(C.connectionDelete, workspaceId, connectionId);
    },
    deleteMany(workspaceId, connectionIds) {
      return tauriInvoke(C.connectionDeleteMany, workspaceId, connectionIds);
    },
    disconnectNodes(workspaceId, fromNodeId, toNodeId) {
      return tauriInvoke(C.connectionDisconnectNodes, workspaceId, fromNodeId, toNodeId);
    },
    removeAllFor(workspaceId, nodeId) {
      return tauriInvoke(C.connectionRemoveAllFor, workspaceId, nodeId);
    },
    onTransferActive(handler) {
      return subscribe(C.connectionTransferActive, handler);
    }
  },
  cableTie: {
    create(workspaceId, tie) {
      return tauriInvoke(C.cableTieCreate, workspaceId, tie);
    },
    move(workspaceId, tieId, position) {
      return tauriInvoke(C.cableTieMove, workspaceId, tieId, position);
    },
    delete(workspaceId, tieId) {
      return tauriInvoke(C.cableTieDelete, workspaceId, tieId);
    },
    prune(workspaceId) {
      return tauriInvoke(C.cableTiePrune, workspaceId);
    }
  },
  portal: {
    register(portalId, webContentsId) {
      return tauriInvoke(C.portalRegister, portalId, webContentsId);
    },
    unregister(portalId) {
      return tauriInvoke(C.portalUnregister, portalId);
    },
    resolveSource(path) {
      return tauriInvoke(C.portalResolveSource, path);
    },
    directoryIndex(directory) {
      return tauriInvoke(C.portalDirectoryIndex, directory);
    },
    watchFile(portalId, file) {
      return tauriInvoke(C.portalWatchFile, portalId, file);
    },
    unwatchFile(portalId) {
      return tauriInvoke(C.portalUnwatchFile, portalId);
    },
    onFileChanged(handler) {
      return subscribe(C.portalFileChanged, handler);
    },
    onWakeRequested(handler) {
      return subscribe(C.portalWake, handler);
    }
  },
  // A key crosses addApiKey and replaceKey; nothing here logs an argument.
  accounts: {
    view() {
      return tauriInvoke(C.accountsView);
    },
    add(name, cli, connection, host) {
      return tauriInvoke(C.accountsAdd, name, cli, connection, host);
    },
    addApiKey(name, cli, key, endpoint, connection) {
      return tauriInvoke(C.accountsAddApiKey, name, cli, key, endpoint, connection);
    },
    replaceKey(accountId, key) {
      return tauriInvoke(C.accountsReplaceKey, accountId, key);
    },
    setEndpoint(accountId, endpoint) {
      return tauriInvoke(C.accountsSetEndpoint, accountId, endpoint);
    },
    signOut(accountId) {
      return tauriInvoke(C.accountsSignOut, accountId);
    },
    rename(accountId, cli, name) {
      return tauriInvoke(C.accountsRename, accountId, cli, name);
    },
    remove(accountId) {
      return tauriInvoke(C.accountsRemove, accountId);
    },
    moveTerminalsToDefault(accountId) {
      return tauriInvoke(C.accountsMoveToDefault, accountId);
    },
    watchSignIn(accountId, terminalId) {
      return tauriInvoke(C.accountsWatchSignIn, accountId, terminalId);
    },
    watchSignOut(accountId, terminalId) {
      return tauriInvoke(C.accountsWatchSignOut, accountId, terminalId);
    },
    refresh() {
      return tauriInvoke(C.accountsRefresh);
    },
    refreshPlace(connection) {
      return tauriInvoke(C.accountsRefreshPlace, connection);
    },
    signOutAll() {
      return tauriInvoke(C.accountsSignOutAll);
    },
    keepsSessionAlive(terminalId) {
      return tauriInvoke(C.accountsKeepsSessionAlive, terminalId);
    },
    setTerminalAccount(workspaceId, terminalId, accountId, restartNow) {
      return tauriInvoke(C.accountsSetTerminal, workspaceId, terminalId, accountId, restartNow);
    },
    describe(request) {
      return tauriInvoke(C.accountsDescribe, request);
    },
    onChanged(handler) {
      return subscribe(C.accountsOnChanged, handler);
    },
    onSignedIn(handler) {
      return subscribe(C.accountsOnSignedIn, handler);
    },
    providers() {
      return tauriInvoke(C.accountsProviders);
    },
    setProvidersViewer(viewerId, isShowing) {
      tauriInvoke(C.accountsSetProvidersViewer, viewerId, isShowing);
    },
    onProvidersChanged(handler) {
      return subscribe(C.accountsOnProvidersChanged, handler);
    },
    approveProvider(providerId, digest) {
      return tauriInvoke(C.accountsApproveProvider, providerId, digest);
    },
    restoreBuiltInProviders() {
      return tauriInvoke(C.accountsRestoreBuiltInProviders);
    },
    restoreProvider(providerId, expectedDigest) {
      return tauriInvoke(C.accountsRestoreProvider, providerId, expectedDigest);
    },
    revealProvidersFolder() {
      return tauriInvoke(C.accountsRevealProvidersFolder);
    },
    revealProviderFile(providerId) {
      return tauriInvoke(C.accountsRevealProviderFile, providerId);
    }
  },
  // Portal Design. Plain `invoke` on all four, never invokeWithLicenseFailure:
  // this surface answers null for every unhappy path — dead daemon, hidden
  // guest, malformed reply, license denial — and the renderer degrades to the
  // plain padded crop rather than handling a rejection mid-gesture.
  portalDesign: {
    capture(portalId) {
      return tauriInvoke(C.portalDesignCapture, portalId);
    },
    resolveScript(workspaceId, stroke, imageSize) {
      return tauriInvoke(C.portalDesignResolveScript, workspaceId, stroke, imageSize);
    },
    region(workspaceId, strokeBounds, candidates, displaySize) {
      return tauriInvoke(
        C.portalDesignRegion,
        workspaceId,
        strokeBounds,
        candidates,
        displaySize
      );
    },
    pick(workspaceId, point, candidates) {
      return tauriInvoke(C.portalDesignPick, workspaceId, point, candidates);
    }
  },
  device: {
    contract(workspaceId) {
      return tauriInvoke(C.deviceContract, workspaceId);
    },
    discover(workspaceId) {
      return tauriInvoke(C.deviceDiscover, workspaceId);
    },
    automation(request) {
      return tauriInvoke(C.deviceAutomation, request);
    },
    onFrameCaptureRequested(handler) {
      return subscribe(C.deviceFrameCaptureRequest, handler);
    },
    completeFrameCapture(requestId, result) {
      return tauriInvoke(C.deviceFrameCaptureResult, requestId, result);
    },
    publishSessions(sessions) {
      return tauriInvoke(C.deviceSessionsPublish, sessions);
    }
  },
  interAgent: {
    listPeers(terminalId) {
      return tauriInvoke(C.interAgentListPeers, terminalId);
    }
  },
  sidebarLayout: {
    get() {
      return tauriInvoke(C.sidebarLayoutGet);
    },
    set(layout) {
      return tauriInvoke(C.sidebarLayoutSet, layout);
    },
    onChanged(handler) {
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
    deleteBackup(path) {
      return tauriInvoke(C.dataDeleteBackup, path);
    },
    exportBackup() {
      return tauriInvoke(C.dataExportBackup);
    },
    pickBackupToImport() {
      return tauriInvoke(C.dataPickBackupToImport);
    },
    importBackup(path, kind) {
      return tauriInvoke(C.dataImportBackup, path, kind);
    },
    clearGlobalPortalStorage() {
      return tauriInvoke(C.dataClearGlobalPortalStorage);
    },
    onStoreReloaded(handler) {
      return subscribe(C.dataOnStoreReloaded, handler);
    }
  },
  palette: {
    rank(workspaceId, query, candidates) {
      return tauriInvoke(C.paletteRank, workspaceId, query, candidates);
    }
  },
  prompter: {
    serialize(workspaceId, segments) {
      return tauriInvoke(C.prompterSerialize, workspaceId, segments);
    },
    deliver(terminalId, prompt, segments) {
      return tauriInvoke(C.prompterDeliver, terminalId, prompt, segments);
    },
    materialize(terminalId, prompt, segments, files) {
      return tauriInvoke(C.prompterMaterialize, terminalId, prompt, segments, files);
    },
    mentionTargets(terminalId) {
      return tauriInvoke(C.prompterMentionTargets, terminalId);
    },
    fileIndex(terminalId) {
      return tauriInvoke(C.prompterFileIndex, terminalId);
    },
    cancelFileIndex(terminalId) {
      return tauriInvoke(C.prompterCancelFileIndex, terminalId);
    },
    fileIcon(path) {
      return tauriInvoke(C.prompterFileIcon, path);
    }
  },
  agentUsage: {
    getState() {
      return tauriInvoke(C.agentUsageGetState);
    },
    refresh(providerID) {
      return tauriInvoke(C.agentUsageRefresh, providerID);
    },
    refreshAll() {
      return tauriInvoke(C.agentUsageRefreshAll);
    },
    restoreDefaults(targets) {
      return tauriInvoke(C.agentUsageRestoreDefaults, targets);
    },
    revealProvidersFolder() {
      return tauriInvoke(C.agentUsageRevealProvidersFolder);
    },
    setViewer(viewerId, isShowing) {
      tauriInvoke(C.agentUsageSetViewer, viewerId, isShowing);
    },
    onStateChanged(listener) {
      return subscribe(C.agentUsageOnStateChanged, listener);
    }
  },
  gitHosts: {
    configure() {
      return tauriInvoke(C.gitHostsConfigure);
    },
    restoreDefault(id, expectedDigest) {
      return tauriInvoke(C.gitHostsRestoreDefault, id, expectedDigest);
    },
    restoreMissingDefaults() {
      return tauriInvoke(C.gitHostsRestoreMissingDefaults);
    },
    checkAccount(providerId) {
      return tauriInvoke(C.gitHostsCheckAccount, providerId);
    },
    revealProvidersFolder() {
      return tauriInvoke(C.gitHostsRevealProvidersFolder);
    }
  },
  pullRequests: {
    imagePrefix: (workspaceId, floorId) => tauriInvoke(C.pullRequestsImagePrefix, workspaceId, floorId),
    keepImage: (workspaceId, floorId, dataBase64, format) => tauriInvoke(C.pullRequestsKeepImage, workspaceId, floorId, dataBase64, format),
    imagesExist: (workspaceId, floorId) => tauriInvoke(C.pullRequestsImagesExist, workspaceId, floorId),
    showImages: (workspaceId, floorId) => tauriInvoke(C.pullRequestsShowImages, workspaceId, floorId),
    closeImages: (workspaceId, floorId) => tauriInvoke(C.pullRequestsCloseImages, workspaceId, floorId),
    imagesDismissed: (workspaceId, floorId, recordId) => tauriInvoke(C.pullRequestsImagesDismissed, workspaceId, floorId, recordId),
    getState() {
      return tauriInvoke(C.pullRequestsGetState);
    },
    onStateChanged(listener) {
      return subscribe(C.pullRequestsOnStateChanged, listener);
    },
    onOpenSheet(listener) {
      return subscribe(C.pullRequestsOnOpenSheet, listener);
    },
    setPresented(floor) {
      tauriInvoke(C.pullRequestsSetPresented, floor);
    },
    prepare(workspaceId, floorId, base) {
      return tauriInvoke(C.pullRequestsPrepare, workspaceId, floorId, base);
    },
    account(workspaceId, floorId, base) {
      return tauriInvoke(C.pullRequestsAccount, workspaceId, floorId, base);
    },
    checkoutIsRemote(workspaceId, floorId) {
      return tauriInvoke(C.pullRequestsCheckoutIsRemote, workspaceId, floorId);
    },
    lookForExisting(workspaceId, floorId) {
      return tauriInvoke(C.pullRequestsLookForExisting, workspaceId, floorId);
    },
    open(workspaceId, floorId, request) {
      return tauriInvoke(C.pullRequestsOpen, workspaceId, floorId, request);
    },
    openOnWebsite(workspaceId, floorId, request) {
      return tauriInvoke(C.pullRequestsOpenOnWebsite, workspaceId, floorId, request);
    },
    check(workspaceId, floorId) {
      return tauriInvoke(C.pullRequestsCheck, workspaceId, floorId);
    },
    markSeen(workspaceId, floorId) {
      return tauriInvoke(C.pullRequestsMarkSeen, workspaceId, floorId);
    },
    push(workspaceId, floorId, recordId) {
      return tauriInvoke(C.pullRequestsPush, workspaceId, floorId, recordId);
    },
    merge(workspaceId, floorId, recordId, method) {
      return tauriInvoke(C.pullRequestsMerge, workspaceId, floorId, recordId, method);
    },
    forget(workspaceId, floorId, recordId) {
      return tauriInvoke(C.pullRequestsForget, workspaceId, floorId, recordId);
    },
    removeMerged(workspaceId, floorId, recordId, confirmExtraWork) {
      return tauriInvoke(C.pullRequestsRemoveMerged, workspaceId, floorId, recordId, confirmExtraWork);
    },
    handOff(workspaceId, floorId, request) {
      return tauriInvoke(C.pullRequestsHandOff, workspaceId, floorId, request);
    },
    folders: {
      openFromTree: (workspaceId, nodeId) => tauriInvoke(C.pullRequestFoldersOpen, workspaceId, nodeId),
      branches: (folderId) => tauriInvoke(C.pullRequestFoldersBranches, folderId),
      prepare: (folderId, base) => tauriInvoke(C.pullRequestFoldersPrepare, folderId, base),
      account: (folderId, base) => tauriInvoke(C.pullRequestFoldersAccount, folderId, base),
      diff: (folderId, base) => tauriInvoke(C.pullRequestFoldersDiff, folderId, base),
      fileDiff: (folderId, base, path, oldPath) => tauriInvoke(C.pullRequestFoldersFileDiff, folderId, base, path, oldPath),
      open: (folderId, request) => tauriInvoke(C.pullRequestFoldersOpenPullRequest, folderId, request),
      openOnWebsite: (folderId, request) => tauriInvoke(C.pullRequestFoldersOpenOnWebsite, folderId, request),
      imagePrefix: (folderId) => tauriInvoke(C.pullRequestFoldersImagePrefix, folderId),
      keepImage: (folderId, dataBase64, format) => tauriInvoke(C.pullRequestFoldersKeepImage, folderId, dataBase64, format),
      imagesExist: (folderId) => tauriInvoke(C.pullRequestFoldersImagesExist, folderId),
      showImages: (folderId) => tauriInvoke(C.pullRequestFoldersShowImages, folderId),
      close: (folderId) => tauriInvoke(C.pullRequestFoldersClose, folderId)
    }
  },
  chat: {
    conversation(terminalId, slot) {
      return tauriInvoke(C.chatConversation, terminalId, slot);
    },
    loadOlderHistory(terminalId, conversationId) {
      return tauriInvoke(C.chatLoadOlderHistory, terminalId, conversationId);
    },
    loadHistoryBackTo(terminalId, conversationId, entryId) {
      return tauriInvoke(C.chatLoadHistoryBackTo, terminalId, conversationId, entryId);
    },
    searchHistory(terminalId, conversationId, query, requestId) {
      return tauriInvoke(C.chatSearchHistory, terminalId, conversationId, query, requestId);
    },
    cancelSearchHistory(requestId) {
      return tauriInvoke(C.chatCancelSearchHistory, requestId);
    },
    threads(terminalId) {
      return tauriInvoke(C.chatThreads, terminalId);
    },
    enter(terminalId) {
      return tauriInvoke(C.chatEnter, terminalId);
    },
    exit(terminalId) {
      return tauriInvoke(C.chatExit, terminalId);
    },
    setShowsShellWindowDuringTurns(terminalId, shows) {
      return tauriInvoke(C.chatSetShowsShellWindowDuringTurns, terminalId, shows);
    },
    send(terminalId, segments, text, entryId) {
      return tauriInvoke(C.chatSend, terminalId, segments, text, entryId);
    },
    interrupt(terminalId) {
      return tauriInvoke(C.chatInterrupt, terminalId);
    },
    acknowledgeAttention(terminalId) {
      return tauriInvoke(C.chatAcknowledgeAttention, terminalId);
    },
    markRead(terminalId) {
      return tauriInvoke(C.chatMarkRead, terminalId);
    },
    switchThread(terminalId, slot) {
      return tauriInvoke(C.chatSwitchThread, terminalId, slot);
    },
    clearThread(terminalId, slot) {
      return tauriInvoke(C.chatClearThread, terminalId, slot);
    },
    deleteEntry(terminalId, entryId) {
      return tauriInvoke(C.chatDeleteEntry, terminalId, entryId);
    },
    deleteAttachment(terminalId, attachmentId) {
      return tauriInvoke(C.chatDeleteAttachment, terminalId, attachmentId);
    },
    onConversationEvent(handler) {
      return subscribe(C.chatOnConversationEvent, handler);
    },
    attachmentFacts(path) {
      return tauriInvoke(C.chatAttachmentFacts, path);
    },
    openAttachment(path) {
      return tauriInvoke(C.chatOpenAttachment, path);
    },
    startAttachmentDrag(path) {
      tauriInvoke(C.chatStartAttachmentDrag, path);
    },
    askNames(terminalId) {
      return tauriInvoke(C.chatAskNames, terminalId);
    },
    captureChatArchives(terminalIds) {
      return tauriInvoke(C.chatCaptureArchives, terminalIds);
    },
    copyChats(copies, archives) {
      return tauriInvoke(C.chatCopyChats, copies, archives);
    },
    discardCopiedChats(conversationIds) {
      return tauriInvoke(C.chatDiscardCopiedChats, conversationIds);
    },
    sendComposedPrompt(terminalId, text, content) {
      return tauriInvoke(C.chatSendComposedPrompt, terminalId, text, content);
    },
    searchConversations(query, limit, labels) {
      return tauriInvoke(C.chatSearchConversations, query, limit, labels);
    },
    releaseConversationSearch() {
      return tauriInvoke(C.chatReleaseConversationSearch);
    }
  },
  pathForFile(file) {
    try {
      return (file as any)?.path || file?.name || '';
    } catch {
      return "";
    }
  },
  license: {
    get() {
      return tauriInvoke(C.licenseGet);
    },
    activate(key) {
      return invokeLicenseCommand(C.licenseActivate, key);
    },
    deactivate() {
      return invokeLicenseCommand(C.licenseDeactivate);
    },
    selectFreeWorkspace(workspaceId) {
      return invokeLicenseCommand(C.licenseSelectFreeWorkspace, workspaceId);
    },
    clearFreeWorkspaceSelection() {
      return invokeLicenseCommand(C.licenseClearFreeWorkspace);
    },
    onChanged(handler) {
      return subscribe(C.licenseOnChanged, handler);
    },
    setDevOverride(status) {
      return tauriInvoke(C.licenseSetDevOverride, status);
    }
  },
  codex: {
    /**
     * The terminal sheets' warning: core's answer for whether this command
     * launches the Codex TUI without its `--no-daemon` flag. Strictly
     * boolean: false is also a non-Codex command or a core that cannot
     * answer, and the call never rejects.
     */
    isMissingFlag(command, target) {
      return tauriInvoke(C.codexIsMissingFlag, command, target);
    }
  },
  routines: {
    list() {
      return tauriInvoke(C.routineList);
    },
    create(input) {
      return tauriInvoke(C.routineCreate, input);
    },
    update(id, patch) {
      return tauriInvoke(C.routineUpdate, id, patch);
    },
    delete(id) {
      return tauriInvoke(C.routineDelete, id);
    },
    setEnabled(id, enabled) {
      return tauriInvoke(C.routineSetEnabled, id, enabled);
    },
    runNow(id) {
      return tauriInvoke(C.routineRunNow, id);
    },
    onChanged(handler) {
      return subscribe(C.routineOnChanged, handler);
    },
    history() {
      return tauriInvoke(C.routineHistory);
    },
    historyRemove(id) {
      return tauriInvoke(C.routineHistoryRemove, id);
    },
    historyClear() {
      return tauriInvoke(C.routineHistoryClear);
    },
    onHistoryChanged(handler) {
      return subscribe(C.routineOnHistoryChanged, handler);
    }
  },
  remote: {
    getState() {
      return tauriInvoke(C.remoteGetState);
    },
    onStateChanged(handler) {
      return subscribe(C.remoteOnStateChanged, handler);
    },
    beginPairingWindow() {
      return tauriInvoke(C.remoteBeginPairingWindow);
    },
    endPairingWindow() {
      return tauriInvoke(C.remoteEndPairingWindow);
    },
    setEnabled(enabled) {
      return tauriInvoke(C.remoteSetEnabled, enabled);
    },
    setPort(port) {
      return tauriInvoke(C.remoteSetPort, port);
    },
    setTailnetOnly(tailnetOnly) {
      return tauriInvoke(C.remoteSetTailnetOnly, tailnetOnly);
    },
    setPassword(password) {
      return tauriInvoke(C.remoteSetPassword, password);
    },
    revokeDevice(id) {
      return tauriInvoke(C.remoteRevokeDevice, id);
    },
    setDeviceRole(id, role) {
      return tauriInvoke(C.remoteSetDeviceRole, id, role);
    },
    renameDevice(id, name) {
      return tauriInvoke(C.remoteRenameDevice, id, name);
    },
    onPresence(handler) {
      const unsubscribe = subscribe(C.remoteOnPresence, handler);
      tauriInvoke(C.remotePresenceResend);
      return unsubscribe;
    },
    onCameraFrame(handler) {
      return subscribe(C.remoteOnCameraFrame, handler);
    },
    onPartituraPreviewRequested(handler) {
      return subscribe(C.remotePartituraPreviewRequest, handler);
    },
    completePartituraPreview(requestId, result) {
      return tauriInvoke(C.remotePartituraPreviewResult, requestId, result);
    },
    onPortalReloadRequested(handler) {
      return subscribe(C.remotePortalReloadRequest, handler);
    },
    completePortalReload(requestId, result) {
      return tauriInvoke(C.remotePortalReloadResult, requestId, result);
    }
  },
  snapNode(context) {
    return invokeWithLicenseFailure(C.snapNode, context);
  },
  tidyNode(request) {
    return invokeWithLicenseFailure(C.tidyNode, request);
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
